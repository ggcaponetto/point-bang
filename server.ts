/**
 * Lightgun POC server: serves the phone page, receives aim over WebSocket,
 * moves the PC cursor with absolute positioning.
 *
 * The CLI in `lib/cli` is what drives this in practice:
 *
 * ```
 * point-bang serve --mode adb    # USB tunnel flow — phone opens http://localhost:8443
 * point-bang serve --mode wifi   # same-WiFi flow — prints the URLs to open
 * ```
 *
 * Emergency stop: Ctrl+C in the terminal.
 *
 * @module
 */

import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import { normalizeUrlPath, contentTypeFor } from "./lib/static.ts";
import { diskAssets, type AssetSource } from "./lib/assets.ts";
import { loadTls } from "./lib/certs.ts";
import { lanIPv4 } from "./lib/net.ts";
import { parseMessage } from "./lib/protocol.ts";
import { createCursorLoop, type MouseLike } from "./lib/cursor.ts";
import { AimPredictor } from "./lib/predict.ts";
import { JitterWindow, formatJitter } from "./lib/jitter.ts";
import { createMouse, createKeyboard } from "./lib/input.ts";
import {
  hasDisplay,
  createVirtualMouse,
  createVirtualKeyboard,
  DEFAULT_SCREEN,
} from "./lib/virtual.ts";
import {
  loadButtonConfig,
  parseButtonConfig,
  createButtonExecutor,
  type KeyboardLike,
} from "./lib/buttons.ts";
import {
  parseCombo,
  createComboProbe,
  watchCombo,
  type ComboProbe,
  type HotkeyWatcher,
} from "./lib/hotkey.ts";
import { loadKoffi } from "./lib/native.ts";
import { VERSION } from "./lib/version.ts";

const ROOT = path.dirname(fileURLToPath(import.meta.url));

/**
 * How the server presents itself:
 * - `adb` — USB tunnel dev flow: http only, no WiFi noise in the logs.
 * - `wifi` — same-network flow: https+wss when certs exist, otherwise prints
 *   the Chrome-flag (Option A) URLs. No USB instructions.
 * - `all` — both (plain `npm start`, the never-break default).
 */
export type ServerMode = "adb" | "wifi" | "all";

/**
 * Where aim ends up:
 * - `native` — the real cursor, via libnut.
 * - `none` — virtual devices that print the cursor position instead (headless
 *   boxes, containers, SSH; also handy for watching what the phone sends).
 * - `auto` — `native` when a display exists, `none` otherwise. Never reaching
 *   the addon without a display is the point: it aborts the process there.
 */
export type InputMode = "auto" | "native" | "none";

/** Options for {@link startServer}; every device/port is injectable for tests. */
export interface ServerOptions {
  mode?: ServerMode;
  port?: number;
  httpsPort?: number;
  certsDir?: string;
  publicDir?: string;
  /** Overrides `publicDir` — how the single executable serves embedded files. */
  assets?: AssetSource;
  mouse?: MouseLike;
  keyboard?: KeyboardLike;
  buttonsFile?: string;
  /** PC key combo toggling tracking pause; `"off"` disables. Default `shift+space`. */
  pauseCombo?: string;
  /** Injected combo probe for tests — replaces the real key-state FFI. */
  pauseProbe?: ComboProbe;
  log?: (line: string) => void;
  statsIntervalMs?: number;
  predictMs?: number; // extrapolation lookahead; 0 (default) = off, newest sample only
  input?: InputMode;
  /** Screen assumed in virtual-input mode, where none can be measured. */
  screen?: { w: number; h: number };
  platform?: string;
  env?: Record<string, string | undefined>;
}

/** A started server: bound ports plus a full-teardown `close()`. */
export interface RunningServer {
  httpPort: number;
  httpsPort: number | null;
  close(): Promise<void>;
}

/**
 * Boots the whole PC side: static file serving, WebSocket intake, aim
 * prediction, the 2ms cursor loop, button execution and jitter stats.
 */
export async function startServer(opts: ServerOptions = {}): Promise<RunningServer> {
  const log = opts.log ?? console.log;
  const mode = opts.mode ?? "all";
  const publicDir = opts.publicDir ?? path.join(ROOT, "public");
  const assets = opts.assets ?? diskAssets(publicDir);

  // ---------- input devices (real or virtual) ----------
  // Decided before anything is opened: on a display-less Linux box, touching
  // the native addon kills the process outright, so `auto` must route around
  // it rather than try and recover.
  const input = opts.input ?? "auto";
  const display = hasDisplay(opts.platform ?? process.platform, opts.env ?? process.env);
  const virtual = input === "none" || (input === "auto" && !display);
  if (virtual) {
    const size = opts.screen ?? DEFAULT_SCREEN;
    log(
      input === "none"
        ? "input: VIRTUAL (--input none) — aim is printed, the cursor is not moved"
        : "input: VIRTUAL — no DISPLAY (headless); aim is printed, the cursor is not moved",
    );
    log(`input: assuming a ${size.w}x${size.h} screen (--screen WxH to change)`);
  } else if (!display) {
    // Explicit --input native without a display: their call, but say what is
    // about to happen, because the crash message itself explains nothing.
    log("input: WARNING — no DISPLAY set; the native addon will abort the process");
  }
  const virtualDeps = { log, size: opts.screen ?? DEFAULT_SCREEN };
  const mouse = opts.mouse ?? (virtual ? createVirtualMouse(virtualDeps) : await createMouse());

  // ---------- static file server (index.html only, no framework needed) ----------
  const handler = (req: http.IncomingMessage, res: http.ServerResponse): void => {
    const normalized = normalizeUrlPath(req.url ?? "/");
    if (normalized === null) {
      res.writeHead(403);
      res.end();
      return;
    }
    // Assets are addressed by bare name ("index.html"), not by URL path.
    const name = normalized.replace(/^\/+/, "");
    assets.read(name).then((data) => {
      if (!data) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      res.writeHead(200, { "Content-Type": contentTypeFor(name) });
      res.end(data);
    });
  };
  const httpServer = http.createServer(handler);

  const tls = mode === "adb" ? null : loadTls(opts.certsDir ?? path.join(ROOT, "certs"));
  const httpsServer = tls ? https.createServer(tls, handler) : null;

  // ---------- cursor control ----------
  const size = await mouse.screenSize();
  log(`Screen: ${size.w}x${size.h}`);
  const predictor = new AimPredictor(opts.predictMs ?? 0);
  const cursor = createCursorLoop(
    mouse,
    () => size,
    () => predictor.predict(Date.now()),
    (e) => console.error("mouse:", e.message),
  );

  // ---------- buttons (protocol v2) ----------
  const keyboard =
    opts.keyboard ?? (virtual ? createVirtualKeyboard(virtualDeps) : await createKeyboard());
  // Same buttons.json both sides read: an explicit file wins, otherwise it
  // comes from wherever the phone page itself comes from (disk or SEA blob).
  const btnCfg = opts.buttonsFile
    ? loadButtonConfig(opts.buttonsFile)
    : parseButtonConfig((await assets.read("buttons.json"))?.toString("utf8") ?? "");
  for (const p of btnCfg.problems) log(`buttons: ${p}`);
  log(`buttons: ${btnCfg.actions.size} action(s) mapped`);
  const pressButton = createButtonExecutor(btnCfg.actions, mouse, keyboard);

  // ---------- pause hotkey (use the real mouse without disconnecting) ----------
  // While paused, aim and button-downs are dropped at the socket; button-ups
  // still pass so nothing held on the phone stays stuck down forever.
  let paused = false;
  let hotkey: HotkeyWatcher | null = null;
  const pauseCombo = opts.pauseCombo ?? "shift+space";
  const togglePause = (): void => {
    paused = !paused;
    // aim collected before the pause must not flick the cursor on resume
    if (paused) predictor.reset();
    log(
      paused ? `tracking PAUSED — the mouse is yours (${pauseCombo} resumes)` : "tracking resumed",
    );
  };
  if (pauseCombo !== "off") {
    const keys = parseCombo(pauseCombo);
    let probe = opts.pauseProbe ?? null;
    let reason: string | null = null;
    if (!keys) {
      probe = null;
      reason = `unrecognized combo "${pauseCombo}" (expected e.g. shift+space)`;
    } else if (!probe) {
      try {
        const r = createComboProbe(keys, {
          ffi: await loadKoffi(VERSION),
          platform: opts.platform,
          env: opts.env,
        });
        probe = r.probe;
        reason = r.reason;
      } catch (e) {
        reason = (e as Error).message;
      }
    }
    if (probe) {
      hotkey = watchCombo(probe, togglePause, 25, (e) =>
        log(`pause hotkey: stopped — ${e.message}`),
      );
      log(`pause hotkey: ${pauseCombo} toggles tracking (the game still receives the combo)`);
    } else {
      log(`pause hotkey: unavailable — ${reason}`);
    }
  }

  // ---------- latency / jitter stats ----------
  const statsMs = opts.statsIntervalMs ?? 2000;
  const jitter = new JitterWindow();
  const statsTimer = setInterval(() => {
    const s = jitter.summarize();
    if (s) log(formatJitter(s, statsMs / 1000));
  }, statsMs);

  // ---------- websocket ----------
  const onConnection = (ws: WebSocket, req: http.IncomingMessage): void => {
    log(`phone connected: ${req.socket.remoteAddress}`);
    ws.on("message", async (raw: Buffer) => {
      const d = parseMessage(raw);
      if (!d) return;
      switch (d.type) {
        case "aim": {
          if (paused) break;
          const arrived = Date.now();
          predictor.add(d.u, d.v, arrived);
          if (typeof d.t === "number") jitter.add(arrived - d.t);
          break;
        }
        case "fire":
          if (paused) break;
          try {
            await mouse.click();
          } catch (e) {
            console.error((e as Error).message);
          }
          break;
        case "calib":
          log(
            `calib ${d.stage} #${d.i ?? ""}: ` +
              (d.x !== undefined
                ? `(${d.x.toFixed(3)}, ${d.y!.toFixed(3)}, ${d.z!.toFixed(3)})`
                : ""),
          );
          break;
        case "state":
          log(`tracking: ${d.tracking}`);
          // stale velocity must not keep extrapolating while tracking is lost
          if (d.tracking === "lost") predictor.reset();
          break;
        case "button":
          // while paused, presses are dropped but releases go through — a
          // button held across the pause must not stay stuck down
          if (paused && d.down) break;
          try {
            if (!(await pressButton(d.id, d.down))) log(`button ${d.id}: no action mapped`);
          } catch (e) {
            console.error((e as Error).message);
          }
          break;
      }
    });
    ws.on("close", () => log("phone disconnected"));
  };
  const wss = new WebSocketServer({ server: httpServer });
  wss.on("connection", onConnection);
  const wssTls = httpsServer ? new WebSocketServer({ server: httpsServer }) : null;
  wssTls?.on("connection", onConnection);

  // ---------- listen ----------
  const listen = (srv: http.Server | https.Server, port: number): Promise<number> =>
    new Promise((resolve, reject) => {
      srv.once("error", reject);
      srv.listen(port, "0.0.0.0", () => {
        resolve((srv.address() as { port: number }).port);
      });
    });

  const httpPort = await listen(httpServer, opts.port ?? 8443);
  log(`http+ws on :${httpPort}`);
  if (mode !== "wifi")
    log(
      `USB:  adb reverse tcp:${httpPort} tcp:${httpPort}  then open http://localhost:${httpPort} on the phone`,
    );

  let httpsPort: number | null = null;
  if (httpsServer) {
    httpsPort = await listen(httpsServer, opts.httpsPort ?? 8444);
    log(`https+wss on :${httpsPort}`);
    for (const ip of lanIPv4()) log(`WiFi: open https://${ip.address}:${httpsPort} on the phone`);
  } else if (mode === "wifi") {
    log(`WiFi: no certs/cert.pem+key.pem — https off. Option A (no certs): on the phone`);
    log(`WiFi: enable chrome://flags/#unsafe-treat-insecure-origin-as-secure and add one of:`);
    for (const ip of lanIPv4())
      log(`WiFi:   http://${ip.address}:${httpPort}${ip.wifi ? "   <-- your WiFi" : ""}`);
  } else if (mode === "all") {
    log(`WiFi: no certs/cert.pem+key.pem found — HTTPS off (see README "Run it over WiFi")`);
  }

  const close = (): Promise<void> => {
    cursor.stop();
    hotkey?.stop();
    clearInterval(statsTimer);
    for (const c of wss.clients) c.terminate();
    if (wssTls) for (const c of wssTls.clients) c.terminate();
    const closeSrv = (s: http.Server | https.Server | null): Promise<void> =>
      new Promise((r) => (s ? s.close(() => r()) : r()));
    return Promise.all([closeSrv(httpServer), closeSrv(httpsServer)]).then(() => {});
  };

  return { httpPort, httpsPort, close };
}

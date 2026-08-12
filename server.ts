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
import {
  detectMonitors,
  selectMonitor,
  type MonitorChoice,
  type MonitorsReport,
} from "./lib/monitors.ts";
import { loadTls } from "./lib/certs.ts";
import { lanIPv4 } from "./lib/net.ts";
import { parseMessage, type ClientMsg } from "./lib/protocol.ts";
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
import { createRtcHub, type PeerLike } from "./lib/rtc.ts";
import { corsHeaders } from "./lib/cors.ts";
import { createKeyGate, generateKey, type KeyGate } from "./lib/auth.ts";
import { phonePageUrl, qrLines, DEFAULT_PAGE_URL } from "./lib/qr.ts";

const ROOT = path.dirname(fileURLToPath(import.meta.url));

/** SDP offers are a few KB; anything bigger is not a phone calibrating. */
const MAX_OFFER_BYTES = 64 * 1024;
const TOO_BIG = Symbol("body too large");

const readBody = (
  req: http.IncomingMessage,
  max: number,
): Promise<string | typeof TOO_BIG | null> =>
  new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > max) {
        // Drain, don't destroy: killing the socket would eat the 413.
        req.removeAllListeners("data");
        req.resume();
        resolve(TOO_BIG);
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", () => resolve(null));
  });

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
  /** Where aim lands: one monitor, all of them, or the primary (default). */
  monitor?: MonitorChoice;
  /** Injected monitor detection for tests — replaces FFI/xrandr probing. */
  monitorProbe?: () => Promise<MonitorsReport>;
  log?: (line: string) => void;
  statsIntervalMs?: number;
  predictMs?: number; // extrapolation lookahead; 0 (default) = off, newest sample only
  input?: InputMode;
  /** Screen assumed in virtual-input mode, where none can be measured. */
  screen?: { w: number; h: number };
  platform?: string;
  env?: Record<string, string | undefined>;
  /** Page the setup QR points at; also seeds the CORS allowlist. */
  pageUrl?: string;
  /** Print the setup QR on startup (non-adb modes). Default true. */
  qr?: boolean;
  /** Origins allowed to signal cross-origin. Default: the `pageUrl` origin. */
  pageOrigins?: string[];
  /** Injected WebRTC peer factory for tests — replaces real werift. */
  rtc?: { createPeer?: () => PeerLike };
  /**
   * Session key network clients must present (WS `?key=`, `/rtc/offer` body).
   * Undefined = generate one per run; null = gate off (trusted LAN).
   */
  key?: string | null;
  /**
   * Whether loopback connections skip the key (default true — the adb/USB
   * flow). MUST be false when a tunnel forwards the internet to loopback.
   */
  keyLoopbackExempt?: boolean;
}

/** A started server: bound ports plus a full-teardown `close()`. */
export interface RunningServer {
  httpPort: number;
  httpsPort: number | null;
  /** The session key in force, for callers printing URLs (tunnel). */
  key: string | null;
  close(): Promise<void>;
}

type Log = (line: string) => void;

// ---------- input devices (real or virtual) ----------
// Decided before anything is opened: on a display-less Linux box, touching
// the native addon kills the process outright, so `auto` must route around
// it rather than try and recover.
async function setupInput(
  opts: ServerOptions,
  log: Log,
): Promise<{ mouse: MouseLike; keyboard: KeyboardLike; virtual: boolean }> {
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
  const keyboard =
    opts.keyboard ?? (virtual ? createVirtualKeyboard(virtualDeps) : await createKeyboard());
  return { mouse, keyboard, virtual };
}

// ---------- monitor selection (where aim lands) ----------
/**
 * Resolves the pixel rect aim maps into. No `monitor` option (embedded use,
 * tests) means the pre-flag behavior: the primary screen at (0,0), no
 * probing. With a choice, detection runs (or the injected probe); a default
 * `primary` that cannot be resolved degrades back to the screen, while an
 * unsatisfiable explicit `all`/index throws out of startup (see
 * {@link selectMonitor}). Virtual input is one synthetic monitor, so
 * `primary`, `all` and index 1 work and higher indices fail loudly.
 */
async function resolveTargetRect(
  opts: ServerOptions,
  mouse: MouseLike,
  virtual: boolean,
  log: Log,
): Promise<{ x: number; y: number; w: number; h: number; label: string }> {
  const screenRect = async (): Promise<{
    x: number;
    y: number;
    w: number;
    h: number;
    label: string;
  }> => {
    const s = await mouse.screenSize();
    return { x: 0, y: 0, w: s.w, h: s.h, label: "screen" };
  };
  const choice = opts.monitor;
  if (!choice) return screenRect();
  const report: MonitorsReport = virtual
    ? {
        monitors: [
          { x: 0, y: 0, ...(opts.screen ?? DEFAULT_SCREEN), primary: true, label: "virtual" },
        ],
        reason: null,
      }
    : await (opts.monitorProbe ?? detectMonitors)();
  const picked = selectMonitor(report, choice);
  if (picked) return picked;
  log(`monitor: detection unavailable (${report.reason}) — using the primary screen`);
  return screenRect();
}

// ---------- buttons (protocol v2) ----------
// Same buttons.json both sides read: an explicit file wins, otherwise it
// comes from wherever the phone page itself comes from (disk or SEA blob).
async function loadButtons(
  opts: ServerOptions,
  assets: AssetSource,
  mouse: MouseLike,
  keyboard: KeyboardLike,
  log: Log,
): Promise<(id: string, down: boolean) => Promise<boolean>> {
  const btnCfg = opts.buttonsFile
    ? loadButtonConfig(opts.buttonsFile)
    : parseButtonConfig((await assets.read("buttons.json"))?.toString("utf8") ?? "");
  for (const p of btnCfg.problems) log(`buttons: ${p}`);
  log(`buttons: ${btnCfg.actions.size} action(s) mapped`);
  return createButtonExecutor(btnCfg.actions, mouse, keyboard);
}

// ---------- pause hotkey (use the real mouse without disconnecting) ----------
async function setupPauseHotkey(
  pauseCombo: string,
  opts: ServerOptions,
  log: Log,
  onToggle: () => void,
): Promise<HotkeyWatcher | null> {
  if (pauseCombo === "off") return null;
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
  if (!probe) {
    log(`pause hotkey: unavailable — ${reason}`);
    return null;
  }
  log(`pause hotkey: ${pauseCombo} toggles tracking (the game still receives the combo)`);
  return watchCombo(probe, onToggle, 25, (e) => log(`pause hotkey: stopped — ${e.message}`));
}

// ---------- protocol intake (shared by every transport) ----------
interface IntakeDeps {
  isPaused(): boolean;
  predictor: AimPredictor;
  jitter: JitterWindow;
  mouse: MouseLike;
  pressButton(id: string, down: boolean): Promise<boolean>;
  log: Log;
}

function createMessageHandler(d: IntakeDeps): (m: ClientMsg) => Promise<void> {
  const onAim = (m: Extract<ClientMsg, { type: "aim" }>): void => {
    if (d.isPaused()) return;
    const arrived = Date.now();
    d.predictor.add(m.u, m.v, arrived);
    if (typeof m.t === "number") d.jitter.add(arrived - m.t);
  };
  const onFire = async (): Promise<void> => {
    if (d.isPaused()) return;
    try {
      await d.mouse.click();
    } catch (e) {
      console.error((e as Error).message);
    }
  };
  const onCalib = (m: Extract<ClientMsg, { type: "calib" }>): void => {
    const coords =
      m.x !== undefined ? `(${m.x.toFixed(3)}, ${m.y!.toFixed(3)}, ${m.z!.toFixed(3)})` : "";
    d.log(`calib ${m.stage} #${m.i ?? ""}: ${coords}`);
  };
  const onState = (m: Extract<ClientMsg, { type: "state" }>): void => {
    d.log(`tracking: ${m.tracking}`);
    // stale velocity must not keep extrapolating while tracking is lost
    if (m.tracking === "lost") d.predictor.reset();
  };
  const onButton = async (m: Extract<ClientMsg, { type: "button" }>): Promise<void> => {
    // while paused, presses are dropped but releases go through — a
    // button held across the pause must not stay stuck down
    if (d.isPaused() && m.down) return;
    try {
      if (!(await d.pressButton(m.id, m.down))) d.log(`button ${m.id}: no action mapped`);
    } catch (e) {
      console.error((e as Error).message);
    }
  };
  return async (m) => {
    switch (m.type) {
      case "aim":
        onAim(m);
        break;
      case "fire":
        await onFire();
        break;
      case "calib":
        onCalib(m);
        break;
      case "state":
        onState(m);
        break;
      case "button":
        await onButton(m);
        break;
    }
  };
}

// ---------- static files + signaling (index.html only, no framework needed) ----------
interface HttpDeps {
  assets: AssetSource;
  pageOrigins: string[];
  gate: KeyGate;
  log: Log;
  handleOffer(sdp: string): Promise<string>;
}

async function handleRtcOffer(
  d: HttpDeps,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  cors: Record<string, string>,
): Promise<void> {
  const body = await readBody(req, MAX_OFFER_BYTES);
  if (body === TOO_BIG) {
    res.writeHead(413, cors);
    res.end("offer too large");
    return;
  }
  let sdp: unknown;
  let key: unknown;
  try {
    const parsed = JSON.parse(body ?? "") as { sdp?: unknown; key?: unknown };
    sdp = parsed.sdp;
    key = parsed.key;
  } catch {
    sdp = undefined;
  }
  if (!d.gate.allow(req.socket.remoteAddress, typeof key === "string" ? key : undefined)) {
    d.log(`rtc: offer refused (missing/wrong session key) from ${req.socket.remoteAddress}`);
    res.writeHead(403, cors);
    res.end("session key required — scan the QR the server prints");
    return;
  }
  if (typeof sdp !== "string") {
    res.writeHead(400, cors);
    res.end('expected {"sdp":"<offer>"}');
    return;
  }
  try {
    const answer = await d.handleOffer(sdp);
    res.writeHead(200, { "Content-Type": "application/json", ...cors });
    res.end(JSON.stringify({ sdp: answer }));
  } catch (e) {
    res.writeHead(400, cors);
    res.end((e as Error).message);
  }
}

function createHttpHandler(d: HttpDeps): http.RequestListener {
  return (req, res) => {
    const info = { origin: req.headers.origin, host: req.headers.host };
    if (req.method === "OPTIONS") {
      // LNA/CORS preflight; a foreign Origin gets no allow headers, which
      // fails the browser's check without leaking anything.
      const cors = corsHeaders(info, d.pageOrigins, true);
      res.writeHead(cors ? 204 : 403, cors ?? {});
      res.end();
      return;
    }
    const cors = corsHeaders(info, d.pageOrigins, false);
    const normalized = normalizeUrlPath(req.url ?? "/");
    if (normalized === null) {
      res.writeHead(403);
      res.end();
      return;
    }
    if (req.method === "POST" && normalized === "/rtc/offer") {
      // The one state-changing route: a browser context must be the hosted
      // page or same-origin — this socket ends at the mouse and keyboard.
      if (!cors) {
        res.writeHead(403);
        res.end("origin not allowed");
        return;
      }
      void handleRtcOffer(d, req, res, cors);
      return;
    }
    // Assets are addressed by bare name ("index.html"), not by URL path.
    const name = normalized.replace(/^\/+/, "");
    void d.assets.read(name).then((data) => {
      if (!data) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      // CORS on plain GETs too: the hosted page reads buttons.json from here.
      // Spreading null adds nothing — exactly what a same-origin GET needs.
      res.writeHead(200, { "Content-Type": contentTypeFor(name), ...cors });
      res.end(data);
    });
  };
}

// ---------- websocket ----------
function createWsHandler(
  gate: KeyGate,
  intake: (raw: Buffer) => void,
  log: Log,
): (ws: WebSocket, req: http.IncomingMessage) => void {
  return (ws, req) => {
    // The upgrade URL carries `?key=` (the page copies it out of the
    // fragment). 1008 = policy violation; the page shows the close reason.
    // The base is a dummy for parsing only — nothing is fetched from it.
    const presented = new URL(req.url ?? "/", "https://x").searchParams.get("key");
    if (!gate.allow(req.socket.remoteAddress, presented)) {
      log(`ws: connection refused (missing/wrong session key) from ${req.socket.remoteAddress}`);
      ws.close(1008, "session key required — scan the QR the server prints");
      return;
    }
    log(`phone connected: ${req.socket.remoteAddress}`);
    ws.on("message", intake);
    ws.on("close", () => log("phone disconnected"));
  };
}

// ---------- listen + startup report ----------
const listen = (srv: http.Server | https.Server, port: number): Promise<number> =>
  new Promise((resolve, reject) => {
    srv.once("error", reject);
    srv.listen(port, "0.0.0.0", () => {
      resolve((srv.address() as { port: number }).port);
    });
  });

interface ReportCtx {
  mode: ServerMode;
  qr: boolean;
  httpPort: number;
  /** LAN URL fragment carrying the session key ("" when the gate is off). */
  lanFrag: string;
  /** Same for loopback URLs — empty while loopback is exempt. */
  localFrag: string;
  log: Log;
}

// Printed URLs carry the key in the fragment so scanning/typing them just
// works; loopback URLs stay bare while loopback is exempt.
async function printKeyAndUsbLines(c: ReportCtx, key: string | null): Promise<void> {
  if (key) {
    c.log(`key : network clients must present this run's session key (in the QR/URLs below);`);
    c.log(`key : pass --key off to serve unauthenticated on a trusted network`);
  } else {
    c.log(`key : OFF — anyone who can reach this port can move this PC's mouse and keyboard`);
  }
  if (c.mode !== "wifi")
    c.log(
      `USB:  adb reverse tcp:${c.httpPort} tcp:${c.httpPort}  then open http://localhost:${c.httpPort}${c.localFrag} on the phone`,
    );
  if (c.mode === "adb" && c.qr) {
    // localhost resolves ON THE PHONE, through the adb reverse tunnel —
    // scanning just saves typing the URL.
    c.log(`USB:  or scan to open http://localhost:${c.httpPort}${c.localFrag} on the phone:`);
    for (const line of await qrLines(`http://localhost:${c.httpPort}${c.localFrag}`)) c.log(line);
  }
}

function printWifiLines(c: ReportCtx, httpsPort: number | null): void {
  if (httpsPort !== null) {
    for (const ip of lanIPv4())
      c.log(`WiFi: open https://${ip.address}:${httpsPort}${c.lanFrag} on the phone`);
  } else if (c.mode === "wifi") {
    c.log(`WiFi: no certs/cert.pem+key.pem — https off. Option A (no certs): on the phone`);
    c.log(`WiFi: enable chrome://flags/#unsafe-treat-insecure-origin-as-secure and add one of:`);
    for (const ip of lanIPv4()) {
      const marker = ip.wifi ? "   <-- your WiFi" : "";
      c.log(`WiFi:   http://${ip.address}:${c.httpPort}${c.lanFrag}${marker}`);
    }
  } else if (c.mode === "all") {
    c.log(`WiFi: no certs/cert.pem+key.pem found — HTTPS off (see README "Run it over WiFi")`);
  }
}

// ---------- setup QR (the consumer journey: run, scan, tap Allow) ----------
async function printSetupQr(c: ReportCtx, pageUrl: string, key: string | null): Promise<void> {
  if (c.mode === "adb" || !c.qr) return;
  const qrUrl = phonePageUrl(pageUrl, lanIPv4(), c.httpPort, key);
  if (!qrUrl) return;
  c.log(`Phone: scan to play (page loads from ${pageUrl}):`);
  for (const line of await qrLines(qrUrl)) c.log(line);
  c.log(`Phone: or type  ${qrUrl}`);
  c.log("Phone: Chrome asks once to allow local network access — tap Allow.");
}

/**
 * Boots the whole PC side: static file serving, WebSocket intake, aim
 * prediction, the 2ms cursor loop, button execution and jitter stats.
 */
export async function startServer(opts: ServerOptions = {}): Promise<RunningServer> {
  const log = opts.log ?? console.log;
  const mode = opts.mode ?? "all";
  const assets = opts.assets ?? diskAssets(opts.publicDir ?? path.join(ROOT, "public"));

  const { mouse, keyboard, virtual } = await setupInput(opts, log);

  // The session key: CORS only constrains browsers — curl and any device on
  // the LAN send no Origin. Both aim intakes end at the mouse and keyboard,
  // so network clients must present the key from the QR fragment.
  const gate = createKeyGate({
    key: opts.key === undefined ? generateKey() : opts.key,
    loopbackExempt: opts.keyLoopbackExempt ?? true,
  });

  // ---------- cursor control ----------
  const rect = await resolveTargetRect(opts, mouse, virtual, log);
  log(
    opts.monitor
      ? `Screen: ${rect.w}x${rect.h} at (${rect.x},${rect.y}) — ${rect.label}`
      : `Screen: ${rect.w}x${rect.h}`,
  );
  const predictor = new AimPredictor(opts.predictMs ?? 0);
  const cursor = createCursorLoop(
    mouse,
    () => rect,
    () => predictor.predict(Date.now()),
    (e) => console.error("mouse:", e.message),
  );

  const pressButton = await loadButtons(opts, assets, mouse, keyboard, log);

  // While paused, aim and button-downs are dropped at the socket; button-ups
  // still pass so nothing held on the phone stays stuck down forever.
  let paused = false;
  const pauseCombo = opts.pauseCombo ?? "shift+space";
  const togglePause = (): void => {
    paused = !paused;
    // aim collected before the pause must not flick the cursor on resume
    if (paused) predictor.reset();
    log(
      paused ? `tracking PAUSED — the mouse is yours (${pauseCombo} resumes)` : "tracking resumed",
    );
  };
  const hotkey = await setupPauseHotkey(pauseCombo, opts, log, togglePause);

  // ---------- latency / jitter stats ----------
  const statsMs = opts.statsIntervalMs ?? 2000;
  const jitter = new JitterWindow();
  const statsTimer = setInterval(() => {
    const s = jitter.summarize();
    if (s) log(formatJitter(s, statsMs / 1000));
  }, statsMs);

  const handleMessage = createMessageHandler({
    isPaused: () => paused,
    predictor,
    jitter,
    mouse,
    pressButton,
    log,
  });
  const intake = (raw: Buffer | string): void => {
    const d = parseMessage(raw);
    if (d) void handleMessage(d);
  };

  // ---------- webrtc intake (same bytes, same handler as the WS) ----------
  const rtcHub = createRtcHub(intake, { createPeer: opts.rtc?.createPeer, log });

  const pageOrigins = opts.pageOrigins ?? [new URL(opts.pageUrl ?? DEFAULT_PAGE_URL).origin];
  const handler = createHttpHandler({
    assets,
    pageOrigins,
    gate,
    log,
    handleOffer: (sdp) => rtcHub.handleOffer(sdp),
  });
  const httpServer = http.createServer(handler);
  const tls = mode === "adb" ? null : loadTls(opts.certsDir ?? path.join(ROOT, "certs"));
  const httpsServer = tls ? https.createServer(tls, handler) : null;

  const onConnection = createWsHandler(gate, intake, log);
  const wss = new WebSocketServer({ server: httpServer });
  wss.on("connection", onConnection);
  const wssTls = httpsServer ? new WebSocketServer({ server: httpsServer }) : null;
  wssTls?.on("connection", onConnection);

  const httpPort = await listen(httpServer, opts.port ?? 8443);
  log(`http+ws on :${httpPort}`);
  const report: ReportCtx = {
    mode,
    qr: opts.qr !== false,
    httpPort,
    lanFrag: gate.key ? `#key=${gate.key}` : "",
    localFrag: gate.required("127.0.0.1") && gate.key ? `#key=${gate.key}` : "",
    log,
  };
  await printKeyAndUsbLines(report, gate.key);

  let httpsPort: number | null = null;
  if (httpsServer) {
    httpsPort = await listen(httpsServer, opts.httpsPort ?? 8444);
    log(`https+wss on :${httpsPort}`);
  }
  printWifiLines(report, httpsPort);
  await printSetupQr(report, opts.pageUrl ?? DEFAULT_PAGE_URL, gate.key);

  const close = (): Promise<void> => {
    cursor.stop();
    hotkey?.stop();
    clearInterval(statsTimer);
    for (const c of wss.clients) c.terminate();
    if (wssTls) for (const c of wssTls.clients) c.terminate();
    const closeSrv = (s: http.Server | https.Server | null): Promise<void> =>
      new Promise((r) => (s ? s.close(() => r()) : r()));
    return Promise.all([closeSrv(httpServer), closeSrv(httpsServer), rtcHub.close()]).then(
      () => {},
    );
  };

  return { httpPort, httpsPort, key: gate.key, close };
}

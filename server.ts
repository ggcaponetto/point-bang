// Lightgun POC server: serves the phone page, receives aim over WebSocket,
// moves the PC cursor with absolute positioning.
//
//   npm install
//   npm start
//   adb reverse tcp:8443 tcp:8443     (phone connected via USB, USB debugging on)
//   Phone Chrome -> http://localhost:8443
//
// WiFi (no adb): put mkcert certs in certs/ (see README) and open
//   https://<PC-LAN-IP>:8444 on the phone. HTTP on 8443 keeps working.
//
// Emergency stop: Ctrl+C in this terminal.

import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import { safeResolve, contentTypeFor } from "./lib/static.ts";
import { loadTls } from "./lib/certs.ts";
import { lanIPv4 } from "./lib/net.ts";
import { parseMessage } from "./lib/protocol.ts";
import { createCursorLoop, type MouseLike } from "./lib/cursor.ts";
import { AimPredictor } from "./lib/predict.ts";
import { JitterWindow, formatJitter } from "./lib/jitter.ts";
import { createNutMouse, createNutKeyboard } from "./lib/input.ts";
import { loadButtonConfig, createButtonExecutor, type KeyboardLike } from "./lib/buttons.ts";
import { adbReverse } from "./lib/adb.ts";

const ROOT = path.dirname(fileURLToPath(import.meta.url));

// adb  = USB tunnel dev flow: http only, no WiFi noise in the logs.
// wifi = same-network flow: https+wss when certs exist, otherwise prints the
//        Chrome-flag (Option A) URLs. No USB instructions.
// all  = both (plain `npm start`, the never-break default).
export type ServerMode = "adb" | "wifi" | "all";

export function parseMode(argv: string[]): ServerMode {
  const arg = argv.find((a) => a.startsWith("--mode="))?.slice("--mode=".length);
  return arg === "adb" || arg === "wifi" ? arg : "all";
}

export interface ServerOptions {
  mode?: ServerMode;
  port?: number;
  httpsPort?: number;
  certsDir?: string;
  publicDir?: string;
  mouse?: MouseLike;
  keyboard?: KeyboardLike;
  buttonsFile?: string;
  log?: (line: string) => void;
  statsIntervalMs?: number;
  predictMs?: number; // extrapolation lookahead; 0 keeps prediction minimal
}

export interface RunningServer {
  httpPort: number;
  httpsPort: number | null;
  close(): Promise<void>;
}

export async function startServer(opts: ServerOptions = {}): Promise<RunningServer> {
  const log = opts.log ?? console.log;
  const mode = opts.mode ?? "all";
  const publicDir = opts.publicDir ?? path.join(ROOT, "public");
  const mouse = opts.mouse ?? (await createNutMouse());

  // ---------- static file server (index.html only, no framework needed) ----------
  const handler = (req: http.IncomingMessage, res: http.ServerResponse): void => {
    const filePath = safeResolve(publicDir, req.url ?? "/");
    if (!filePath) {
      res.writeHead(403);
      res.end();
      return;
    }
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      res.writeHead(200, { "Content-Type": contentTypeFor(filePath) });
      res.end(data);
    });
  };
  const httpServer = http.createServer(handler);

  const tls = mode === "adb" ? null : loadTls(opts.certsDir ?? path.join(ROOT, "certs"));
  const httpsServer = tls ? https.createServer(tls, handler) : null;

  // ---------- cursor control ----------
  const size = await mouse.screenSize();
  log(`Screen: ${size.w}x${size.h}`);
  const predictor = new AimPredictor(opts.predictMs ?? 20);
  const cursor = createCursorLoop(
    mouse,
    () => size,
    () => predictor.predict(Date.now()),
    (e) => console.error("mouse:", e.message),
  );

  // ---------- buttons (protocol v2) ----------
  const keyboard = opts.keyboard ?? (await createNutKeyboard());
  const btnCfg = loadButtonConfig(opts.buttonsFile ?? path.join(publicDir, "buttons.json"));
  for (const p of btnCfg.problems) log(`buttons: ${p}`);
  log(`buttons: ${btnCfg.actions.size} action(s) mapped`);
  const pressButton = createButtonExecutor(btnCfg.actions, mouse, keyboard);

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
          const arrived = Date.now();
          predictor.add(d.u, d.v, arrived);
          if (typeof d.t === "number") jitter.add(arrived - d.t);
          break;
        }
        case "fire":
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
    clearInterval(statsTimer);
    for (const c of wss.clients) c.terminate();
    if (wssTls) for (const c of wssTls.clients) c.terminate();
    const closeSrv = (s: http.Server | https.Server | null): Promise<void> =>
      new Promise((r) => (s ? s.close(() => r()) : r()));
    return Promise.all([closeSrv(httpServer), closeSrv(httpsServer)]).then(() => {});
  };

  return { httpPort, httpsPort, close };
}

// Auto-start only when run directly (`node server.ts`), not when imported by tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mode = parseMode(process.argv.slice(2));
  const port = process.env.PORT ? +process.env.PORT : undefined;
  const predictMs = process.env.PREDICT_MS ? +process.env.PREDICT_MS : undefined;
  if (mode === "adb") console.log(adbReverse(port ?? 8443).detail);
  startServer({ mode, port, predictMs }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

import { describe, it, expect, afterEach, vi } from "vitest";
import path from "node:path";
import net from "node:net";
import https from "node:https";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { startServer, type RunningServer } from "../server.ts";
import type { MouseLike } from "../lib/cursor.ts";
import { lanIPv4 } from "../lib/net.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HERE, "fixtures");
const PUBLIC = path.join(HERE, "..", "public");

function fakeMouse() {
  const moves: [number, number][] = [];
  const clicks: number[] = [];
  const buttons: string[] = [];
  const mouse: MouseLike = {
    async setPosition(x, y) {
      moves.push([x, y]);
    },
    async click() {
      clicks.push(1);
    },
    async press(b) {
      buttons.push(`press:${b}`);
    },
    async release(b) {
      buttons.push(`release:${b}`);
    },
    async screenSize() {
      return { w: 1920, h: 1080 };
    },
  };
  return { mouse, moves, clicks, buttons };
}

function fakeKeyboard() {
  const keys: string[] = [];
  return {
    keys,
    keyboard: {
      async pressKeys(names: string[]) {
        keys.push(`press:${names.join("+")}`);
      },
      async releaseKeys(names: string[]) {
        keys.push(`release:${names.join("+")}`);
      },
    },
  };
}

const until = async (cond: () => boolean, ms = 2000) => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("condition not met in time");
    await new Promise((r) => setTimeout(r, 5));
  }
};

const wsOpen = (url: string): Promise<WebSocket> =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { rejectUnauthorized: false });
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
  });

let running: RunningServer | null = null;
afterEach(async () => {
  await running?.close();
  running = null;
});

describe("startServer (http only)", () => {
  // pauseCombo "off" everywhere a test does not opt in: the real probe reads
  // the actual keyboard, and a test must never react to keys the developer
  // happens to be holding.
  async function boot() {
    const f = fakeMouse();
    const k = fakeKeyboard();
    const logs: string[] = [];
    running = await startServer({
      port: 0,
      certsDir: path.join(HERE, "no-such-dir"),
      publicDir: PUBLIC,
      mouse: f.mouse,
      keyboard: k.keyboard,
      log: (l) => logs.push(l),
      statsIntervalMs: 50,
      pauseCombo: "off",
    });
    return { ...f, ...k, logs, srv: running };
  }

  it("serves the phone page and math module, 404s the rest", async () => {
    const { srv, logs } = await boot();
    expect(srv.httpsPort).toBeNull();
    expect(logs.join("\n")).toContain("HTTPS off");

    const base = `http://127.0.0.1:${srv.httpPort}`;
    const page = await fetch(base + "/");
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toBe("text/html");
    expect(await page.text()).toContain("Lightgun");

    const js = await fetch(base + "/math.js");
    expect(js.status).toBe(200);
    expect(js.headers.get("content-type")).toBe("text/javascript");

    const cfg = await fetch(base + "/buttons.json?v=2");
    expect(cfg.status).toBe(200);
    expect(cfg.headers.get("content-type")).toBe("application/json");

    expect((await fetch(base + "/nope.js")).status).toBe(404);
    // A malformed percent-escape is refused outright rather than 404'd.
    expect((await fetch(base + "/%zz")).status).toBe(403);
  });

  it("serves the phone page from embedded assets when given an AssetSource", async () => {
    const f = fakeMouse();
    running = await startServer({
      port: 0,
      certsDir: path.join(HERE, "no-such-dir"),
      pauseCombo: "off",
      assets: {
        async read(name) {
          if (name === "index.html") return Buffer.from("<h1>embedded</h1>");
          if (name === "buttons.json")
            return Buffer.from(JSON.stringify({ buttons: [{ id: "x", action: "key:z" }] }));
          return null;
        },
      },
      mouse: f.mouse,
      keyboard: fakeKeyboard().keyboard,
      log: () => {},
    });
    const page = await fetch(`http://127.0.0.1:${running.httpPort}/`);
    expect(await page.text()).toBe("<h1>embedded</h1>");
  });

  it("rejects path traversal attempts end-to-end", async () => {
    const { srv } = await boot();
    // "/../" is clamped inside root by path.normalize (unit-tested in
    // static.test.ts), and Node's parser 400s slash-less request targets
    // before our handler — the safeResolve guard is defense-in-depth.
    const line = (target: string) =>
      new Promise<string>((resolve, reject) => {
        const sock = net.connect(srv.httpPort, "127.0.0.1", () => {
          sock.write(`GET ${target} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`);
        });
        let buf = "";
        sock.on("data", (d) => (buf += d));
        sock.on("end", () => resolve(buf.split("\r\n")[0]));
        sock.on("error", reject);
      });
    expect(await line("../server.ts")).toContain("400");
    expect(await line("/../package.json")).toContain("404");
  });

  it("moves the cursor on aim (scaled + clamped) and clicks on fire", async () => {
    const { srv, moves, clicks } = await boot();
    const ws = await wsOpen(`ws://127.0.0.1:${srv.httpPort}`);
    ws.send(JSON.stringify({ type: "aim", u: 0.5, v: 0.5, t: Date.now(), q: 1 }));
    await until(() => moves.length > 0);
    expect(moves[0]).toEqual([960, 540]);

    ws.send(JSON.stringify({ type: "aim", u: 2, v: -1 }));
    await until(() => moves.length > 1);
    expect(moves[1]).toEqual([1919, 0]);

    ws.send(JSON.stringify({ type: "fire" }));
    await until(() => clicks.length > 0);
    ws.close();
  });

  it("executes configured buttons: mouse hold, key, fire slot, unknown id", async () => {
    const { srv, buttons, keys, logs } = await boot();
    expect(logs.some((l) => l.includes("buttons: 4 action(s) mapped"))).toBe(true);

    const ws = await wsOpen(`ws://127.0.0.1:${srv.httpPort}`);
    // b1 = mouse:right in public/buttons.json
    ws.send(JSON.stringify({ type: "button", id: "b1", down: true }));
    await until(() => buttons.length > 0);
    ws.send(JSON.stringify({ type: "button", id: "b1", down: false }));
    await until(() => buttons.length > 1);
    expect(buttons).toEqual(["press:right", "release:right"]);

    // fire is a regular config-driven button now (mouse:left, hold-capable)
    ws.send(JSON.stringify({ type: "button", id: "fire", down: true }));
    ws.send(JSON.stringify({ type: "button", id: "fire", down: false }));
    await until(() => buttons.length > 3);
    expect(buttons.slice(2)).toEqual(["press:left", "release:left"]);

    // b2 = key:a
    ws.send(JSON.stringify({ type: "button", id: "b2", down: true }));
    ws.send(JSON.stringify({ type: "button", id: "b2", down: false }));
    await until(() => keys.length > 1);
    expect(keys).toEqual(["press:a", "release:a"]);

    // unmapped id is logged, not crashed
    ws.send(JSON.stringify({ type: "button", id: "b99", down: true }));
    await until(() => logs.some((l) => l.includes("button b99: no action mapped")));
    ws.close();
  });

  it("loads an explicit buttons file in place of the built-in one", async () => {
    const f = fakeMouse();
    const logs: string[] = [];
    running = await startServer({
      port: 0,
      certsDir: path.join(HERE, "no-such-dir"),
      publicDir: PUBLIC,
      buttonsFile: path.join(HERE, "no-such-buttons.json"),
      mouse: f.mouse,
      keyboard: fakeKeyboard().keyboard,
      log: (l) => logs.push(l),
      pauseCombo: "off",
    });
    expect(logs.some((l) => l.includes("buttons disabled"))).toBe(true);
    expect(logs).toContain("buttons: 0 action(s) mapped");
  });

  it("logs calib and state messages, survives garbage", async () => {
    const { srv, logs } = await boot();
    const ws = await wsOpen(`ws://127.0.0.1:${srv.httpPort}`);
    ws.send("{{{ not json");
    ws.send(JSON.stringify({ type: "calib", stage: "corner", i: 0, x: 0.1, y: 1.2, z: -0.5 }));
    ws.send(JSON.stringify({ type: "calib", stage: "begin" }));
    ws.send(JSON.stringify({ type: "state", tracking: "limited" }));
    await until(() => logs.some((l) => l.startsWith("tracking:")));
    expect(logs.find((l) => l.includes("calib corner #0"))).toContain("(0.100, 1.200, -0.500)");
    expect(logs).toContain("tracking: limited");
    ws.close();
    await until(() => logs.includes("phone disconnected"));
  });

  it("prints jitter stats once enough timestamped aims arrive", async () => {
    const { srv, logs, moves } = await boot();
    const ws = await wsOpen(`ws://127.0.0.1:${srv.httpPort}`);
    for (let i = 0; i < 15; i++)
      ws.send(JSON.stringify({ type: "aim", u: 0.5, v: 0.5, t: Date.now() - i }));
    await until(() => logs.some((l) => l.includes("jitter p50=")), 3000);
    expect(moves.length).toBeGreaterThan(0);
    ws.close();
  });

  it("reports fire errors without crashing", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const f = fakeMouse();
    f.mouse.click = async () => {
      throw new Error("no permission");
    };
    running = await startServer({
      port: 0,
      certsDir: path.join(HERE, "no-such-dir"),
      publicDir: PUBLIC,
      mouse: f.mouse,
      keyboard: fakeKeyboard().keyboard,
      log: () => {},
      pauseCombo: "off",
    });
    const ws = await wsOpen(`ws://127.0.0.1:${running.httpPort}`);
    ws.send(JSON.stringify({ type: "fire" }));
    await until(() => errSpy.mock.calls.length > 0);
    expect(errSpy).toHaveBeenCalledWith("no permission");
    ws.close();
    errSpy.mockRestore();
  });
});

describe("startServer modes", () => {
  async function bootMode(mode: "adb" | "wifi", certsDir: string) {
    const f = fakeMouse();
    const logs: string[] = [];
    running = await startServer({
      mode,
      port: 0,
      httpsPort: 0,
      certsDir,
      publicDir: PUBLIC,
      mouse: f.mouse,
      keyboard: fakeKeyboard().keyboard,
      log: (l) => logs.push(l),
      pauseCombo: "off",
    });
    return { logs, srv: running };
  }

  it("adb mode: http only, no WiFi noise, even when certs exist", async () => {
    const { srv, logs } = await bootMode("adb", FIXTURES);
    expect(srv.httpsPort).toBeNull();
    expect(logs.some((l) => l.startsWith("USB:"))).toBe(true);
    expect(logs.some((l) => l.startsWith("WiFi:"))).toBe(false);
  });

  it("wifi mode with certs: https URLs, no USB instructions", async () => {
    const { srv, logs } = await bootMode("wifi", FIXTURES);
    expect(srv.httpsPort).not.toBeNull();
    expect(logs.some((l) => l.startsWith("WiFi: open https://"))).toBe(true);
    expect(logs.some((l) => l.startsWith("USB:"))).toBe(false);
  });

  it("wifi mode without certs: prints Chrome-flag Option A URLs", async () => {
    const { srv, logs } = await bootMode("wifi", path.join(HERE, "no-such-dir"));
    expect(srv.httpsPort).toBeNull();
    expect(logs.some((l) => l.includes("unsafe-treat-insecure-origin-as-secure"))).toBe(true);
    expect(logs.some((l) => l.includes(`http://`) && l.includes(`:${srv.httpPort}`))).toBe(true);
  });
});

describe("startServer (with TLS certs)", () => {
  it("additionally serves https+wss and prints WiFi URLs", async () => {
    const f = fakeMouse();
    const logs: string[] = [];
    running = await startServer({
      port: 0,
      httpsPort: 0,
      certsDir: FIXTURES,
      publicDir: PUBLIC,
      mouse: f.mouse,
      keyboard: fakeKeyboard().keyboard,
      log: (l) => logs.push(l),
      pauseCombo: "off",
    });
    expect(running.httpsPort).not.toBeNull();
    expect(logs.some((l) => l.startsWith("WiFi: open https://"))).toBe(true);

    const status = await new Promise<number>((resolve, reject) => {
      https
        .get(
          { host: "127.0.0.1", port: running!.httpsPort!, path: "/", rejectUnauthorized: false },
          (res) => resolve(res.statusCode ?? 0),
        )
        .on("error", reject);
    });
    expect(status).toBe(200);

    const ws = await wsOpen(`wss://127.0.0.1:${running.httpsPort}`);
    ws.send(JSON.stringify({ type: "aim", u: 0, v: 0 }));
    await until(() => f.moves.length > 0);
    expect(f.moves[0]).toEqual([0, 0]);
    ws.close();
  });
});

describe("startServer input modes", () => {
  /** Boots with no injected devices — the only path that would load libnut. */
  async function bootVirtual(opts: Parameters<typeof startServer>[0]) {
    const logs: string[] = [];
    running = await startServer({
      port: 0,
      certsDir: path.join(HERE, "no-such-dir"),
      publicDir: PUBLIC,
      log: (l) => logs.push(l),
      pauseCombo: "off",
      ...opts,
    });
    return { logs, srv: running };
  }

  it("prints the aim instead of moving a cursor with --input none", async () => {
    const { logs, srv } = await bootVirtual({ input: "none", screen: { w: 1001, h: 1001 } });
    expect(logs.join("\n")).toContain("input: VIRTUAL (--input none)");
    expect(logs).toContain("input: assuming a 1001x1001 screen (--screen WxH to change)");
    expect(logs).toContain("Screen: 1001x1001");

    const ws = await wsOpen(`ws://127.0.0.1:${srv.httpPort}`);
    ws.send(JSON.stringify({ type: "aim", u: 0.5, v: 0.25, t: Date.now() }));
    await until(() => logs.some((l) => l.startsWith("aim ")));
    expect(logs.find((l) => l.startsWith("aim "))).toContain("500,250 px");

    ws.send(JSON.stringify({ type: "button", id: "b1", down: true }));
    await until(() => logs.includes("press  right"));
    ws.close();
  });

  it("picks virtual input on a display-less Linux box, never reaching the addon", async () => {
    const { logs } = await bootVirtual({ input: "auto", platform: "linux", env: {} });
    expect(logs.join("\n")).toContain("input: VIRTUAL — no DISPLAY");
    expect(logs).toContain("Screen: 1920x1080");
  });

  it("warns but obeys when native input is demanded without a display", async () => {
    const f = fakeMouse();
    const { logs } = await bootVirtual({
      input: "native",
      platform: "linux",
      env: {},
      mouse: f.mouse,
      keyboard: fakeKeyboard().keyboard,
    });
    expect(logs.join("\n")).toContain("WARNING — no DISPLAY");
    expect(logs.join("\n")).not.toContain("VIRTUAL");
  });

  it("lets an injected device win over the virtual one", async () => {
    const f = fakeMouse();
    const { logs, srv } = await bootVirtual({
      input: "none",
      mouse: f.mouse,
      keyboard: fakeKeyboard().keyboard,
    });
    const ws = await wsOpen(`ws://127.0.0.1:${srv.httpPort}`);
    ws.send(JSON.stringify({ type: "aim", u: 1, v: 1 }));
    await until(() => f.moves.length > 0);
    expect(f.moves[0]).toEqual([1919, 1079]);
    expect(logs.some((l) => l.startsWith("aim "))).toBe(false);
    ws.close();
  });
});

describe("startServer pause hotkey", () => {
  async function bootPaused(probe: { down(): boolean }, pauseCombo?: string) {
    const f = fakeMouse();
    const k = fakeKeyboard();
    const logs: string[] = [];
    running = await startServer({
      port: 0,
      certsDir: path.join(HERE, "no-such-dir"),
      publicDir: PUBLIC,
      mouse: f.mouse,
      keyboard: k.keyboard,
      log: (l) => logs.push(l),
      pauseProbe: probe,
      pauseCombo,
    });
    return { ...f, ...k, logs, srv: running };
  }

  it("toggles pause: aim/fire/presses drop, releases pass, resume works", async () => {
    let comboDown = false;
    const t = await bootPaused({ down: () => comboDown });
    expect(t.logs.some((l) => l.includes("pause hotkey: shift+space toggles tracking"))).toBe(true);

    const ws = await wsOpen(`ws://127.0.0.1:${t.srv.httpPort}`);
    // live: aim moves the cursor, b1 (mouse:right) goes down and stays held
    ws.send(JSON.stringify({ type: "aim", u: 0.5, v: 0.5 }));
    await until(() => t.moves.length > 0);
    ws.send(JSON.stringify({ type: "button", id: "b1", down: true }));
    await until(() => t.buttons.length === 1);

    comboDown = true; // press the combo
    await until(() => t.logs.some((l) => l.includes("tracking PAUSED")));
    const movesWhenPaused = t.moves.length;

    // paused: aim, fire and fresh presses are dropped at the socket …
    ws.send(JSON.stringify({ type: "aim", u: 0.9, v: 0.9 }));
    ws.send(JSON.stringify({ type: "fire" }));
    ws.send(JSON.stringify({ type: "button", id: "b2", down: true })); // key:a
    // … but the release of the button held across the pause still lands
    ws.send(JSON.stringify({ type: "button", id: "b1", down: false }));
    await until(() => t.buttons.length === 2);
    await new Promise((r) => setTimeout(r, 30)); // a dropped aim would move within ~2ms ticks
    expect(t.buttons).toEqual(["press:right", "release:right"]);
    expect(t.keys).toEqual([]);
    expect(t.clicks).toHaveLength(0);
    expect(t.moves.length).toBe(movesWhenPaused);

    comboDown = false; // release the combo …
    await new Promise((r) => setTimeout(r, 80)); // let the watcher see the release
    comboDown = true; // … press again to resume
    await until(() => t.logs.some((l) => l.includes("tracking resumed")));
    ws.send(JSON.stringify({ type: "aim", u: 0, v: 0 }));
    await until(() => t.moves.length > movesWhenPaused);
    expect(t.moves.at(-1)).toEqual([0, 0]);
    ws.close();
  });

  it("disables the hotkey on an unrecognized combo, even with a probe injected", async () => {
    const { logs } = await bootPaused({ down: () => true }, "sift+space");
    expect(logs.some((l) => l.includes('unrecognized combo "sift+space"'))).toBe(true);
    expect(logs.some((l) => l.includes("tracking PAUSED"))).toBe(false);
  });

  it("stops (not spams) when the probe starts throwing", async () => {
    const { logs } = await bootPaused({
      down: () => {
        throw new Error("ffi died");
      },
    });
    await until(() => logs.some((l) => l.includes("pause hotkey: stopped — ffi died")));
    await new Promise((r) => setTimeout(r, 80)); // more ticks would have fired by now
    expect(logs.filter((l) => l.includes("ffi died"))).toHaveLength(1);
  });
});

describe("startServer rtc signaling", () => {
  const PAGE_ORIGIN = "https://ggcaponetto.github.io";
  const OFFER = "v=0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n";

  /** Werift stand-in whose DataChannel the test can drive directly. */
  function fakeRtcPeer() {
    let onDc:
      ((dc: { onMessage: { subscribe(cb: (d: string | Buffer) => void): void } }) => void) | null =
      null;
    const closed: number[] = [];
    const peer = {
      onDataChannel: { subscribe: (cb: typeof onDc) => (onDc = cb) },
      connectionStateChange: { subscribe: () => {} },
      iceGatheringStateChange: { subscribe: () => {} },
      iceGatheringState: "complete",
      localDescription: { sdp: "v=0 answer" },
      setRemoteDescription: async () => {},
      createAnswer: async () => ({ type: "answer", sdp: "v=0 answer" }),
      setLocalDescription: async () => ({}),
      close: async () => {
        closed.push(1);
      },
    };
    const openChannel = () => {
      let onMsg: ((d: string | Buffer) => void) | null = null;
      onDc?.({ onMessage: { subscribe: (cb) => (onMsg = cb) } });
      return { send: (d: string) => onMsg?.(d) };
    };
    return { peer, openChannel, closed };
  }

  async function boot() {
    const f = fakeMouse();
    const rtc = fakeRtcPeer();
    const logs: string[] = [];
    running = await startServer({
      port: 0,
      certsDir: path.join(HERE, "no-such-dir"),
      publicDir: PUBLIC,
      mouse: f.mouse,
      keyboard: fakeKeyboard().keyboard,
      log: (l) => logs.push(l),
      pauseCombo: "off",
      rtc: { createPeer: () => rtc.peer },
    });
    return { ...f, rtc, logs, srv: running, base: `http://127.0.0.1:${running.httpPort}` };
  }

  const postOffer = (base: string, body: string, origin?: string) =>
    fetch(`${base}/rtc/offer`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(origin ? { origin } : {}) },
      body,
    });

  it("answers an offer from the hosted page and feeds its channel into the aim path", async () => {
    const { base, rtc, moves, clicks, srv } = await boot();
    const res = await postOffer(base, JSON.stringify({ sdp: OFFER }), PAGE_ORIGIN);
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(PAGE_ORIGIN);
    expect(await res.json()).toEqual({ sdp: "v=0 answer" });

    const dc = rtc.openChannel();
    dc.send("{{{ not json"); // garbage must be dropped, not crash
    dc.send(JSON.stringify({ type: "aim", u: 0.5, v: 0.5, t: Date.now(), q: 1 }));
    await until(() => moves.length > 0);
    expect(moves[0]).toEqual([960, 540]);
    dc.send(JSON.stringify({ type: "fire" }));
    await until(() => clicks.length > 0);

    await srv.close();
    running = null;
    expect(rtc.closed.length).toBe(1); // teardown closes live peers
  });

  it("403s a foreign browser origin — this socket ends at the mouse", async () => {
    const { base, moves } = await boot();
    const res = await postOffer(base, JSON.stringify({ sdp: OFFER }), "https://evil.example");
    expect(res.status).toBe(403);
    expect(moves.length).toBe(0);
  });

  it("allows same-origin and no-origin posts (localhost flows, curl)", async () => {
    const { base, srv } = await boot();
    const sameOrigin = await postOffer(
      base,
      JSON.stringify({ sdp: OFFER }),
      `http://127.0.0.1:${srv.httpPort}`,
    );
    expect(sameOrigin.status).toBe(200);
    const noOrigin = await postOffer(base, JSON.stringify({ sdp: OFFER }));
    expect(noOrigin.status).toBe(200);
  });

  it("400s malformed bodies and non-SDP offers", async () => {
    const { base } = await boot();
    expect((await postOffer(base, "{{{ nope", PAGE_ORIGIN)).status).toBe(400);
    expect((await postOffer(base, JSON.stringify({ nope: 1 }), PAGE_ORIGIN)).status).toBe(400);
    expect((await postOffer(base, JSON.stringify({ sdp: "hello" }), PAGE_ORIGIN)).status).toBe(400);
  });

  it("413s an oversized body", async () => {
    const { base } = await boot();
    const res = await postOffer(
      base,
      JSON.stringify({ sdp: "m=".padEnd(70_000, "x") }),
      PAGE_ORIGIN,
    );
    expect(res.status).toBe(413);
  });

  it("preflight: 204 with the private-network opt-in for the page, 403 for strangers", async () => {
    const { base } = await boot();
    const ok = await fetch(`${base}/rtc/offer`, {
      method: "OPTIONS",
      headers: { origin: PAGE_ORIGIN, "access-control-request-method": "POST" },
    });
    expect(ok.status).toBe(204);
    expect(ok.headers.get("access-control-allow-origin")).toBe(PAGE_ORIGIN);
    expect(ok.headers.get("access-control-allow-private-network")).toBe("true");

    const no = await fetch(`${base}/rtc/offer`, {
      method: "OPTIONS",
      headers: { origin: "https://evil.example" },
    });
    expect(no.status).toBe(403);
    expect(no.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("serves buttons.json to the hosted page with CORS (local config wins remotely)", async () => {
    const { base } = await boot();
    const res = await fetch(`${base}/buttons.json`, { headers: { origin: PAGE_ORIGIN } });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(PAGE_ORIGIN);
    const strange = await fetch(`${base}/buttons.json`, {
      headers: { origin: "https://evil.example" },
    });
    expect(strange.status).toBe(200); // static read is public; no ACAO = browser blocks it
    expect(strange.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("signals over the https server too when certs exist", async () => {
    const f = fakeMouse();
    const rtc = fakeRtcPeer();
    running = await startServer({
      port: 0,
      httpsPort: 0,
      certsDir: FIXTURES,
      publicDir: PUBLIC,
      mouse: f.mouse,
      keyboard: fakeKeyboard().keyboard,
      log: () => {},
      pauseCombo: "off",
      rtc: { createPeer: () => rtc.peer },
    });
    const body = await new Promise<{ status: number; text: string }>((resolve, reject) => {
      const req = https.request(
        {
          host: "127.0.0.1",
          port: running!.httpsPort!,
          path: "/rtc/offer",
          method: "POST",
          headers: { "content-type": "application/json", origin: PAGE_ORIGIN },
          rejectUnauthorized: false,
        },
        (res) => {
          let text = "";
          res.on("data", (c) => (text += c));
          res.on("end", () => resolve({ status: res.statusCode!, text }));
        },
      );
      req.on("error", reject);
      req.end(JSON.stringify({ sdp: OFFER }));
    });
    expect(body.status).toBe(200);
    expect(JSON.parse(body.text)).toEqual({ sdp: "v=0 answer" });
  });
});

describe("startServer setup QR", () => {
  async function bootMode(mode: "all" | "adb", qr?: boolean) {
    const logs: string[] = [];
    running = await startServer({
      mode,
      port: 0,
      certsDir: path.join(HERE, "no-such-dir"),
      publicDir: PUBLIC,
      mouse: fakeMouse().mouse,
      keyboard: fakeKeyboard().keyboard,
      log: (l) => logs.push(l),
      pauseCombo: "off",
      ...(qr === undefined ? {} : { qr }),
    });
    return logs;
  }

  it("prints the QR banner outside adb mode when a LAN address exists", async () => {
    if (lanIPv4().length === 0) return; // machine without a LAN: nothing to encode
    const logs = await bootMode("all");
    const joined = logs.join("\n");
    expect(joined).toContain("Phone: scan to play");
    expect(joined).toContain("#pc=");
    expect(joined).toContain("local network access");
    expect(logs.length).toBeGreaterThan(15); // the QR block itself
  });

  it("adb mode: prints a localhost QR instead of the hosted-page one", async () => {
    const logs = await bootMode("adb");
    const joined = logs.join("\n");
    expect(joined).not.toContain("scan to play"); // no wireless pairing over USB
    expect(joined).toMatch(/scan to open http:\/\/localhost:\d+ on the phone/);
    expect(logs.length).toBeGreaterThan(15); // the QR block itself
  });

  it("qr: false silences the banner in every mode", async () => {
    const all = await bootMode("all", false);
    expect(all.join("\n")).not.toContain("scan to play");
    await running!.close();
    const adb = await bootMode("adb", false);
    expect(adb.join("\n")).not.toContain("scan to open");
  });
});

describe("startServer session key", () => {
  const KEY = "testkey-123456";
  const OFFER = "v=0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n";

  /** Minimal werift stand-in — signaling is what's under test here. */
  const fakePeer = () => ({
    onDataChannel: { subscribe: () => {} },
    connectionStateChange: { subscribe: () => {} },
    iceGatheringStateChange: { subscribe: () => {} },
    iceGatheringState: "complete",
    localDescription: { sdp: "v=0 answer" },
    setRemoteDescription: async () => {},
    createAnswer: async () => ({ type: "answer", sdp: "v=0 answer" }),
    setLocalDescription: async () => ({}),
    close: async () => {},
  });

  async function boot(opts: { key?: string | null; keyLoopbackExempt?: boolean } = {}) {
    const f = fakeMouse();
    const logs: string[] = [];
    running = await startServer({
      port: 0,
      certsDir: path.join(HERE, "no-such-dir"),
      publicDir: PUBLIC,
      mouse: f.mouse,
      keyboard: fakeKeyboard().keyboard,
      log: (l) => logs.push(l),
      pauseCombo: "off",
      qr: false,
      rtc: { createPeer: fakePeer },
      ...opts,
    });
    return { ...f, logs, srv: running, base: `http://127.0.0.1:${running.httpPort}` };
  }

  /** Opens a WS and reports how it ended: open, or closed with code+reason. */
  const wsAttempt = (
    url: string,
  ): Promise<{ opened: boolean; code?: number; reason?: string; ws: WebSocket }> =>
    new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      let opened = false;
      ws.on("open", () => (opened = true));
      ws.on("close", (code, reason) => resolve({ opened, code, reason: reason.toString(), ws }));
      ws.on("error", reject);
      setTimeout(() => opened && resolve({ opened, ws }), 150);
    });

  it("refuses a keyless WS when loopback is not exempt (1008 + a hint)", async () => {
    const { srv } = await boot({ key: KEY, keyLoopbackExempt: false });
    const r = await wsAttempt(`ws://127.0.0.1:${srv.httpPort}`);
    expect(r.code).toBe(1008);
    expect(r.reason).toContain("session key");
    const wrong = await wsAttempt(`ws://127.0.0.1:${srv.httpPort}/?key=wrong-key-123`);
    expect(wrong.code).toBe(1008);
  });

  it("a WS presenting the key streams aim as usual", async () => {
    const { srv, moves } = await boot({ key: KEY, keyLoopbackExempt: false });
    const r = await wsAttempt(`ws://127.0.0.1:${srv.httpPort}/?key=${KEY}`);
    expect(r.opened).toBe(true);
    r.ws.send(JSON.stringify({ type: "aim", u: 0.5, v: 0.5, t: Date.now(), q: 1 }));
    await until(() => moves.length > 0);
    expect(moves[0]).toEqual([960, 540]);
    r.ws.close();
  });

  it("403s a keyless /rtc/offer and answers one carrying the key", async () => {
    const { base } = await boot({ key: KEY, keyLoopbackExempt: false });
    const post = (body: object) =>
      fetch(`${base}/rtc/offer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    const refused = await post({ sdp: OFFER });
    expect(refused.status).toBe(403);
    expect(await refused.text()).toContain("session key");
    expect((await post({ sdp: OFFER, key: "wrong-key-123" })).status).toBe(403);
    const ok = await post({ sdp: OFFER, key: KEY });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ sdp: "v=0 answer" });
  });

  it("loopback is exempt by default — the adb flow needs no key", async () => {
    const { srv, moves } = await boot({ key: KEY }); // exemption defaulted on
    const r = await wsAttempt(`ws://127.0.0.1:${srv.httpPort}`);
    expect(r.opened).toBe(true);
    r.ws.send(JSON.stringify({ type: "aim", u: 0.25, v: 0.5, t: Date.now(), q: 1 }));
    await until(() => moves.length > 0);
    r.ws.close();
  });

  it("key null = gate off, and the banner says so loudly", async () => {
    const { srv, logs } = await boot({ key: null, keyLoopbackExempt: false });
    const r = await wsAttempt(`ws://127.0.0.1:${srv.httpPort}`);
    expect(r.opened).toBe(true);
    r.ws.close();
    expect(logs.join("\n")).toContain("key : OFF");
  });

  it("generates a key when none is provided and prints it into the URLs", async () => {
    const { srv, logs } = await boot({ keyLoopbackExempt: false });
    expect(srv.key).toMatch(/^[A-Za-z0-9_-]{22}$/);
    const joined = logs.join("\n");
    expect(joined).toContain("session key");
    expect(joined).toContain(`http://localhost:${srv.httpPort}#key=${srv.key}`);
  });

  it("keeps loopback URLs bare while loopback is exempt", async () => {
    const { srv, logs } = await boot({ key: KEY });
    expect(srv.key).toBe(KEY);
    expect(logs.join("\n")).toContain(`http://localhost:${srv.httpPort} on the phone`);
    expect(logs.join("\n")).not.toContain(`localhost:${srv.httpPort}#key=`);
  });
});

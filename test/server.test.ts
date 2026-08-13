import { describe, it, expect, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { startServer, type RunningServer } from "../server.ts";
import type { ChannelLike } from "../lib/rtc.ts";
import type { MouseLike } from "../lib/cursor.ts";
import { lanIPv4 } from "../lib/net.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
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
  async function boot(extra: Partial<Parameters<typeof startServer>[0]> = {}) {
    const f = fakeMouse();
    const k = fakeKeyboard();
    const logs: string[] = [];
    running = await startServer({
      port: 0,
      publicDir: PUBLIC,
      mouse: f.mouse,
      keyboard: k.keyboard,
      log: (l) => logs.push(l),
      statsIntervalMs: 50,
      pauseCombo: "off",
      ...extra,
    });
    return { ...f, ...k, logs, srv: running };
  }

  it("serves the phone page and math module, 404s the rest", async () => {
    const { srv } = await boot();

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
    // A fixed config, NOT the live public/buttons.json — that file is the
    // user's to edit, and this test must not break when they remap buttons.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pb-buttons-"));
    const file = path.join(dir, "buttons.json");
    fs.writeFileSync(
      file,
      JSON.stringify({
        buttons: [
          { id: "fire", action: "mouse:left" },
          { id: "b1", action: "mouse:right" },
          { id: "b2", action: "key:a" },
          { id: "b3", action: "key:b" },
        ],
      }),
    );
    const { srv, buttons, keys, logs } = await boot({ buttonsFile: file });
    expect(logs.some((l) => l.includes("buttons: 4 action(s) mapped"))).toBe(true);

    const ws = await wsOpen(`ws://127.0.0.1:${srv.httpPort}`);
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
  async function bootMode(mode: "adb" | "wifi") {
    const f = fakeMouse();
    const logs: string[] = [];
    running = await startServer({
      mode,
      port: 0,
      publicDir: PUBLIC,
      mouse: f.mouse,
      keyboard: fakeKeyboard().keyboard,
      log: (l) => logs.push(l),
      pauseCombo: "off",
    });
    return { logs, srv: running };
  }

  it("adb mode: USB instructions, no WiFi noise", async () => {
    const { logs } = await bootMode("adb");
    expect(logs.some((l) => l.startsWith("USB:"))).toBe(true);
    expect(logs.some((l) => l.startsWith("WiFi:"))).toBe(false);
  });

  it("wifi mode: Chrome-flag fallback URLs, no USB instructions", async () => {
    const { srv, logs } = await bootMode("wifi");
    expect(logs.some((l) => l.includes("unsafe-treat-insecure-origin-as-secure"))).toBe(true);
    expect(logs.some((l) => l.includes(`http://`) && l.includes(`:${srv.httpPort}`))).toBe(true);
    expect(logs.some((l) => l.startsWith("USB:"))).toBe(false);
  });
});

describe("startServer monitor selection", () => {
  // real box this feature was verified on: primary at (0,0), second at (-1920,0)
  const TWO = {
    monitors: [
      { x: 0, y: 0, w: 1920, h: 1080, primary: true, label: "\\\\.\\DISPLAY1" },
      { x: -1920, y: 0, w: 1920, h: 1080, primary: false, label: "\\\\.\\DISPLAY2" },
    ],
    reason: null,
  };

  async function bootWith(opts: Parameters<typeof startServer>[0]) {
    const f = fakeMouse();
    const logs: string[] = [];
    running = await startServer({
      port: 0,
      publicDir: PUBLIC,
      mouse: f.mouse,
      keyboard: fakeKeyboard().keyboard,
      log: (l) => logs.push(l),
      pauseCombo: "off",
      // Pin a display-ful platform: on Linux CI `auto` input would resolve
      // to virtual and bypass the injected probe. Devices are fakes anyway.
      platform: "win32",
      ...opts,
    });
    return { ...f, logs, srv: running };
  }

  it("maps aim into a selected negative-origin monitor", async () => {
    const { srv, moves, logs } = await bootWith({
      monitor: { kind: "index", index: 2 },
      monitorProbe: async () => TWO,
    });
    expect(logs).toContain("Screen: 1920x1080 at (-1920,0) — \\\\.\\DISPLAY2");
    const ws = await wsOpen(`ws://127.0.0.1:${srv.httpPort}`);
    ws.send(JSON.stringify({ type: "aim", u: 0.5, v: 0.5 }));
    await until(() => moves.length > 0);
    expect(moves[0]).toEqual([-1920 + 960, 540]);
    ws.close();
  });

  it("spans all monitors with --monitor all", async () => {
    const { srv, moves, logs } = await bootWith({
      monitor: { kind: "all" },
      monitorProbe: async () => TWO,
    });
    expect(logs).toContain("Screen: 3840x1080 at (-1920,0) — all (2 monitors)");
    const ws = await wsOpen(`ws://127.0.0.1:${srv.httpPort}`);
    ws.send(JSON.stringify({ type: "aim", u: 0, v: 0 }));
    await until(() => moves.length > 0);
    expect(moves[0]).toEqual([-1920, 0]);
    ws.close();
  });

  it("default primary degrades to the screen when detection fails", async () => {
    const { logs } = await bootWith({
      monitor: { kind: "primary" },
      monitorProbe: async () => ({ monitors: [], reason: "no probe here" }),
    });
    expect(logs.join("\n")).toContain("no probe here");
    expect(logs).toContain("Screen: 1920x1080 at (0,0) — screen");
  });

  it("refuses to start when an explicit monitor cannot be honored", async () => {
    await expect(
      bootWith({
        monitor: { kind: "index", index: 3 },
        monitorProbe: async () => TWO,
      }),
    ).rejects.toThrow(/--monitor 3/);
    running = null;
  });

  it("routes per-monitor aim (aim.m) into that monitor's rect", async () => {
    const { srv, moves } = await bootWith({
      monitor: { kind: "all" },
      monitorProbe: async () => TWO,
    });
    const ws = await wsOpen(`ws://127.0.0.1:${srv.httpPort}`);
    ws.send(JSON.stringify({ type: "aim", u: 0.5, v: 0.5, m: 2 }));
    await until(() => moves.length > 0);
    expect(moves[0]).toEqual([-1920 + 960, 540]); // center of the second monitor
    ws.send(JSON.stringify({ type: "aim", u: 0.5, v: 0.5, m: 1 }));
    await until(() => moves.length > 1);
    expect(moves[1]).toEqual([960, 540]); // center of the first
    // no m (or out of range) falls back to the spanning rect
    ws.send(JSON.stringify({ type: "aim", u: 0, v: 0 }));
    await until(() => moves.length > 2);
    expect(moves[2]).toEqual([-1920, 0]);
    ws.close();
  });

  it("ignores aim.m outside all-mode — the selected rect stays authoritative", async () => {
    const { srv, moves } = await bootWith({
      monitor: { kind: "index", index: 1 },
      monitorProbe: async () => TWO,
    });
    const ws = await wsOpen(`ws://127.0.0.1:${srv.httpPort}`);
    ws.send(JSON.stringify({ type: "aim", u: 0.5, v: 0.5, m: 2 }));
    await until(() => moves.length > 0);
    expect(moves[0]).toEqual([960, 540]); // monitor 1, not 2
    ws.close();
  });

  it("parks the cursor on the monitor being calibrated (calib stage target)", async () => {
    const { srv, moves, logs } = await bootWith({
      monitor: { kind: "all" },
      monitorProbe: async () => TWO,
    });
    const ws = await wsOpen(`ws://127.0.0.1:${srv.httpPort}`);
    ws.send(JSON.stringify({ type: "calib", stage: "target", m: 2 }));
    await until(() => moves.length > 0);
    expect(moves[0]).toEqual([-1920 + 960, 540]); // center of the second monitor
    await until(() => logs.some((l) => l.includes("calibrating monitor 2")));
    ws.close();
  });

  it("drops cal-tagged aim while calibrating, resumes on the first untagged sample", async () => {
    const { srv, moves } = await bootWith({
      monitor: { kind: "all" },
      monitorProbe: async () => TWO,
    });
    const ws = await wsOpen(`ws://127.0.0.1:${srv.httpPort}`);
    ws.send(JSON.stringify({ type: "calib", stage: "target", m: 1 }));
    await until(() => moves.length > 0);
    expect(moves[0]).toEqual([960, 540]); // parked at monitor 1's center
    // tagged aim must not move the cursor off the park …
    ws.send(JSON.stringify({ type: "aim", u: 0.1, v: 0.1, m: 2, cal: 1 }));
    await new Promise((r) => setTimeout(r, 30)); // a leaked aim would move within ~2ms ticks
    expect(moves).toHaveLength(1);
    // … the first untagged sample does — resume is the absence of the tag
    ws.send(JSON.stringify({ type: "aim", u: 0.5, v: 0.5, m: 2 }));
    await until(() => moves.length > 1);
    expect(moves[1]).toEqual([-1920 + 960, 540]);
    ws.close();
  });

  it("ignores a park with an out-of-range or missing monitor index", async () => {
    const { srv, moves } = await bootWith({
      monitor: { kind: "all" },
      monitorProbe: async () => TWO,
    });
    const ws = await wsOpen(`ws://127.0.0.1:${srv.httpPort}`);
    ws.send(JSON.stringify({ type: "calib", stage: "target", m: 3 })); // out of range
    ws.send(JSON.stringify({ type: "calib", stage: "target" })); // no m (old phone)
    // a real aim afterwards is the ordering fence: no park move ever landed
    ws.send(JSON.stringify({ type: "aim", u: 0, v: 0 }));
    await until(() => moves.length > 0);
    expect(moves).toHaveLength(1);
    expect(moves[0]).toEqual([-1920, 0]);
    ws.close();
  });

  it("single-rect mode: calib stage target is a silent no-op", async () => {
    const { srv, moves } = await bootWith({
      monitor: { kind: "index", index: 1 },
      monitorProbe: async () => TWO,
    });
    const ws = await wsOpen(`ws://127.0.0.1:${srv.httpPort}`);
    ws.send(JSON.stringify({ type: "calib", stage: "target", m: 2 }));
    ws.send(JSON.stringify({ type: "aim", u: 0.5, v: 0.5 }));
    await until(() => moves.length > 0);
    expect(moves).toHaveLength(1);
    expect(moves[0]).toEqual([960, 540]);
    ws.close();
  });

  it("does not yank the parked cursor while tracking is paused", async () => {
    let comboDown = false;
    const { srv, moves, logs } = await bootWith({
      monitor: { kind: "all" },
      monitorProbe: async () => TWO,
      pauseCombo: "shift+space",
      pauseProbe: { down: () => comboDown },
    });
    comboDown = true;
    await until(() => logs.some((l) => l.includes("tracking PAUSED")));
    const ws = await wsOpen(`ws://127.0.0.1:${srv.httpPort}`);
    ws.send(JSON.stringify({ type: "calib", stage: "target", m: 2 }));
    await new Promise((r) => setTimeout(r, 30));
    expect(moves).toHaveLength(0); // the user paused to own the mouse
    ws.close();
  });

  it("serves /monitors with the aim targets and CORS for the hosted page", async () => {
    const { srv } = await bootWith({
      monitor: { kind: "all" },
      monitorProbe: async () => TWO,
    });
    const res = await fetch(`http://127.0.0.1:${srv.httpPort}/monitors`, {
      headers: { origin: "https://ggcaponetto.github.io" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(res.headers.get("access-control-allow-origin")).toBe("https://ggcaponetto.github.io");
    const body = (await res.json()) as { monitors: { i: number; w: number; label: string }[] };
    expect(body.monitors).toHaveLength(2);
    expect(body.monitors[0]).toMatchObject({ i: 1, w: 1920, label: "\\\\.\\DISPLAY1" });
    expect(body.monitors[1]).toMatchObject({ i: 2, label: "\\\\.\\DISPLAY2" });
    // no layout coordinates leak — the phone only needs count + aspect
    expect(body.monitors[0]).not.toHaveProperty("x");
  });

  it("serves a single aim target in single-rect modes", async () => {
    const { srv } = await bootWith({});
    const res = await fetch(`http://127.0.0.1:${srv.httpPort}/monitors`);
    const body = (await res.json()) as { monitors: unknown[] };
    expect(body.monitors).toHaveLength(1);
    expect(body.monitors[0]).toMatchObject({ i: 1, w: 1920, h: 1080 });
  });

  it("virtual input is one synthetic monitor: index 1 works, index 2 refuses", async () => {
    const { logs } = await bootWith({
      input: "none",
      screen: { w: 800, h: 600 },
      monitor: { kind: "index", index: 1 },
      mouse: undefined,
      keyboard: undefined,
    });
    expect(logs).toContain("Screen: 800x600 at (0,0) — virtual");
    await running?.close();
    running = null;
    await expect(
      bootWith({
        input: "none",
        monitor: { kind: "index", index: 2 },
        mouse: undefined,
        keyboard: undefined,
      }),
    ).rejects.toThrow(/--monitor 2/);
    running = null;
  });
});

describe("startServer input modes", () => {
  /** Boots with no injected devices — the only path that would load libnut. */
  async function bootVirtual(opts: Parameters<typeof startServer>[0]) {
    const logs: string[] = [];
    running = await startServer({
      port: 0,
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
    expect(t.moves).toHaveLength(movesWhenPaused);

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
    let onDc: ((dc: ChannelLike) => void) | null = null;
    const closed: number[] = [];
    const peer = {
      onDataChannel: { subscribe: (cb: (dc: ChannelLike) => void) => (onDc = cb) },
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
      const received: string[] = []; // server→phone pushes land here
      onDc?.({
        onMessage: { subscribe: (cb) => (onMsg = cb) },
        readyState: "open",
        send: (d: string) => received.push(d),
      });
      return { send: (d: string) => onMsg?.(d), received };
    };
    return { peer, openChannel, closed };
  }

  async function boot() {
    const f = fakeMouse();
    const rtc = fakeRtcPeer();
    const logs: string[] = [];
    running = await startServer({
      port: 0,
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
    expect(rtc.closed).toHaveLength(1); // teardown closes live peers
  });

  it("403s a foreign browser origin — this socket ends at the mouse", async () => {
    const { base, moves } = await boot();
    const res = await postOffer(base, JSON.stringify({ sdp: OFFER }), "https://evil.example");
    expect(res.status).toBe(403);
    expect(moves).toHaveLength(0);
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
});

describe("startServer port collisions", () => {
  // The server binds 0.0.0.0 — the blocker must too, or the collision is
  // OS-dependent (a 127.0.0.1 blocker does not conflict on every platform).
  const block = (): Promise<{ port: number; close(): Promise<void> }> =>
    new Promise((resolve, reject) => {
      const srv = net.createServer();
      srv.once("error", reject);
      srv.listen(0, "0.0.0.0", () => {
        resolve({
          port: (srv.address() as { port: number }).port,
          close: () => new Promise((r) => srv.close(() => r(undefined))),
        });
      });
    });

  const base = (logs: string[]) => ({
    publicDir: PUBLIC,
    mouse: fakeMouse().mouse,
    keyboard: fakeKeyboard().keyboard,
    log: (l: string) => logs.push(l),
    pauseCombo: "off" as const,
  });

  it("default port busy + fallback: binds a free one, every printed URL follows", async () => {
    const b = await block();
    const logs: string[] = [];
    try {
      running = await startServer({ ...base(logs), port: b.port, portFallback: true });
      expect(running.httpPort).not.toBe(b.port);
      expect(logs.join("\n")).toMatch(/busy — using a free port instead/);
      // the report layer prints the RESOLVED port, so the phone follows
      expect(logs.join("\n")).toContain(`http://localhost:${running.httpPort}`);
    } finally {
      await b.close();
    }
  });

  it("explicit busy port refuses with a clean coded error, no fallback", async () => {
    const b = await block();
    const logs: string[] = [];
    try {
      const err = await startServer({ ...base(logs), port: b.port }).then(
        () => null,
        (e: NodeJS.ErrnoException) => e,
      );
      expect(err?.message).toMatch(/already in use/);
      expect(err?.code).toBe("EADDRINUSE");
    } finally {
      await b.close();
    }
  });

  it("a failed bind tears the half-started server down (rebind proves it)", async () => {
    // probe a free port (accepted tiny race), block it, then fail to bind it
    const probe = await block();
    const P = probe.port;
    await probe.close();
    const b = await block();
    try {
      await expect(startServer({ ...base([]), port: b.port })).rejects.toThrow(/already in use/);
      // the failure-path teardown released everything — a fresh boot works
      running = await startServer({ ...base([]), port: P });
      expect(running.httpPort).toBe(P);
    } finally {
      await b.close();
    }
  });

  it("no port given: the 8443 default applies, fallback-armed either way", async () => {
    const logs: string[] = [];
    // Deliberately NO port: binds the real default when it is free, or an
    // OS-assigned port when something (CI neighbor, a dev's own running
    // server) holds it — deterministic in both worlds.
    running = await startServer({
      ...base(logs),
      portFallback: true,
    });
    expect(running.httpPort).toBeGreaterThan(0);
    expect(logs.join("\n")).toContain(`http+ws on :${running.httpPort}`);
  });

  it("non-EADDRINUSE listen errors pass through untouched", async () => {
    await expect(startServer({ ...base([]), port: 65536 })).rejects.toThrow(
      /^(?!.*already in use).*$/s,
    );
    running = null;
  });
});

describe("startServer live button config (editor save + push)", () => {
  const cfgWith = (action: string): object => ({
    buttons: [{ id: "b1", label: "B1", action, visible: true }],
  });

  // Every save test writes into ITS OWN temp dir — never the repo public/.
  function tempPublic(action = "key:a"): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pb-editor-"));
    fs.writeFileSync(path.join(dir, "buttons.json"), JSON.stringify(cfgWith(action)));
    return dir;
  }

  async function bootEditor(extra: Parameters<typeof startServer>[0] = {}) {
    const f = fakeMouse();
    const k = fakeKeyboard();
    const logs: string[] = [];
    running = await startServer({
      port: 0,
      mouse: f.mouse,
      keyboard: k.keyboard,
      log: (l) => logs.push(l),
      pauseCombo: "off",
      ...extra,
    });
    return { ...f, ...k, logs, srv: running, base: `http://127.0.0.1:${running.httpPort}` };
  }

  const postButtons = (base: string, body: string, origin?: string) =>
    fetch(`${base}/buttons`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(origin ? { origin } : {}) },
      body,
    });

  it("saves live: file rewritten, GET serves it, WS phone pushed, new action fires", async () => {
    const dir = tempPublic();
    const { srv, base, buttons, logs } = await bootEditor({ publicDir: dir });
    const ws = await wsOpen(`ws://127.0.0.1:${srv.httpPort}`);
    const pushes: string[] = [];
    ws.on("message", (d) => pushes.push(String(d)));

    const res = await postButtons(base, JSON.stringify({ config: cfgWith("mouse:right") }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, rev: 1 });
    // the file on disk was atomically replaced …
    expect(fs.readFileSync(path.join(dir, "buttons.json"), "utf8")).toContain("mouse:right");
    // … GET serves the new config …
    expect(await (await fetch(`${base}/buttons.json`)).text()).toContain("mouse:right");
    // … the phone got the push …
    await until(() => pushes.length > 0);
    expect(JSON.parse(pushes[0])).toEqual({ type: "buttons", rev: 1 });
    // … and the NEW action executes with no restart.
    ws.send(JSON.stringify({ type: "button", id: "b1", down: true }));
    await until(() => buttons.length > 0);
    expect(buttons[0]).toBe("press:right");
    expect(logs.some((l) => l.includes("1 action(s) mapped (live)"))).toBe(true);
    ws.close();
  });

  it("refuses a config with problems: 400 + problems, nothing written", async () => {
    const dir = tempPublic();
    const { base } = await bootEditor({ publicDir: dir });
    const res = await postButtons(base, JSON.stringify({ config: cfgWith("key:nope") }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      ok: false,
      problems: ['button b1: unknown action "key:nope"'],
    });
    expect(fs.readFileSync(path.join(dir, "buttons.json"), "utf8")).toContain("key:a");
  });

  it("400s a body without a buttons array, 413s an oversized one", async () => {
    const { base } = await bootEditor({ publicDir: tempPublic() });
    expect((await postButtons(base, "{{{ nope")).status).toBe(400);
    expect((await postButtons(base, JSON.stringify({ config: {} }))).status).toBe(400);
    const huge = JSON.stringify({ config: cfgWith("key:a"), pad: "x".repeat(70_000) });
    expect((await postButtons(base, huge)).status).toBe(413);
  });

  it("403s a foreign browser origin", async () => {
    const dir = tempPublic();
    const { base } = await bootEditor({ publicDir: dir });
    const res = await postButtons(
      base,
      JSON.stringify({ config: cfgWith("mouse:left") }),
      "https://evil.example",
    );
    expect(res.status).toBe(403);
    expect(fs.readFileSync(path.join(dir, "buttons.json"), "utf8")).toContain("key:a");
  });

  it("enforces the session key when loopback is not exempt", async () => {
    const dir = tempPublic();
    const { base } = await bootEditor({
      publicDir: dir,
      key: "sesame-key-123",
      keyLoopbackExempt: false,
    });
    const noKey = await postButtons(base, JSON.stringify({ config: cfgWith("mouse:left") }));
    expect(noKey.status).toBe(403);
    const withKey = await postButtons(
      base,
      JSON.stringify({ key: "sesame-key-123", config: cfgWith("mouse:left") }),
    );
    expect(withKey.status).toBe(200);
  });

  it("409s when there is nowhere to write (embedded assets, no file)", async () => {
    const { base } = await bootEditor({
      assets: {
        async read(name) {
          return name === "buttons.json" ? Buffer.from(JSON.stringify(cfgWith("key:a"))) : null;
        },
      },
    });
    const res = await postButtons(base, JSON.stringify({ config: cfgWith("mouse:left") }));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { problems: string[] }).problems[0]).toContain("no writable");
  });

  it("serves an explicit --buttons file on GET /buttons.json (both sides agree)", async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pb-explicit-")), "mine.json");
    fs.writeFileSync(file, JSON.stringify(cfgWith("key:x")));
    const { base } = await bootEditor({ publicDir: PUBLIC, buttonsFile: file });
    const text = await (await fetch(`${base}/buttons.json`)).text();
    expect(text).toContain("key:x"); // the file, not the public/ copy
  });

  it("repeats the push over the lossy DataChannel, deduped by rev", async () => {
    // Local werift stand-in (same shape as the rtc signaling suite's).
    let onDc: ((dc: ChannelLike) => void) | null = null;
    const peer = {
      onDataChannel: { subscribe: (cb: (dc: ChannelLike) => void) => (onDc = cb) },
      connectionStateChange: { subscribe: () => {} },
      iceGatheringStateChange: { subscribe: () => {} },
      iceGatheringState: "complete",
      localDescription: { sdp: "v=0 answer" },
      setRemoteDescription: async () => {},
      createAnswer: async () => ({ type: "answer", sdp: "v=0 answer" }),
      setLocalDescription: async () => ({}),
      close: async () => {},
    };
    const { base } = await bootEditor({
      publicDir: tempPublic(),
      rtc: { createPeer: () => peer },
    });
    const offer = await fetch(`${base}/rtc/offer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sdp: "v=0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n" }),
    });
    expect(offer.status).toBe(200);
    const received: string[] = [];
    onDc!({
      onMessage: { subscribe: () => {} },
      readyState: "open",
      send: (d: string) => received.push(d),
    });
    const res = await postButtons(base, JSON.stringify({ config: cfgWith("mouse:left") }));
    expect(res.status).toBe(200);
    await until(() => received.length >= 3); // 0/150/400ms repeats
    expect(JSON.parse(received[0])).toEqual({ type: "buttons", rev: 1 });
    expect(received[0]).toBe(received[1]); // identical copies — the phone dedupes on rev
  });
});

describe("startServer setup QR", () => {
  async function bootMode(mode: "all" | "adb") {
    const logs: string[] = [];
    running = await startServer({
      mode,
      port: 0,
      publicDir: PUBLIC,
      mouse: fakeMouse().mouse,
      keyboard: fakeKeyboard().keyboard,
      log: (l) => logs.push(l),
      pauseCombo: "off",
    });
    return logs;
  }

  it("prints the QR banner outside adb mode when a LAN address exists", async (ctx) => {
    if (lanIPv4().length === 0) ctx.skip(); // machine without a LAN: nothing to encode
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
      publicDir: PUBLIC,
      mouse: f.mouse,
      keyboard: fakeKeyboard().keyboard,
      log: (l) => logs.push(l),
      pauseCombo: "off",
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

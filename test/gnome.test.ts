import { describe, it, expect } from "vitest";
import {
  isWayland,
  gnomeKey,
  gvString,
  openGnomeInput,
  detectGnomeMonitors,
  type GnomeInput,
} from "../lib/gnome.ts";
import { listKeys, normalizeKey } from "../public/math.js";
import { fakeGlib, callLines, type FakeWorld } from "./helpers/fakeglib.ts";

const STREAM = "'/org/gnome/Mutter/ScreenCast/Stream/u1'";

function open(over: Partial<FakeWorld> = {}, healthMs = 2000) {
  const { ffi, world } = fakeGlib(over);
  const logs: string[] = [];
  const clock = { t: 1000 };
  const r = openGnomeInput({ ffi, log: (l) => logs.push(l), now: () => clock.t, healthMs });
  return { r, world, logs, clock };
}

function opened(over: Partial<FakeWorld> = {}, healthMs = 2000) {
  const o = open(over, healthMs);
  if (!o.r.input) throw new Error(`expected devices, got: ${o.r.reason}`);
  o.world.calls.length = 0; // assertions below are about what happens AFTER setup
  return { ...o, input: o.r.input as GnomeInput };
}

describe("isWayland", () => {
  it("is a Linux-only question answered by the session variables", () => {
    expect(isWayland("linux", { XDG_SESSION_TYPE: "wayland" })).toBe(true);
    expect(isWayland("linux", { WAYLAND_DISPLAY: "wayland-0" })).toBe(true);
    expect(isWayland("linux", { XDG_SESSION_TYPE: "x11", DISPLAY: ":0" })).toBe(false);
    expect(isWayland("linux", {})).toBe(false);
    expect(isWayland("win32", { XDG_SESSION_TYPE: "wayland" })).toBe(false);
    expect(isWayland("darwin", { WAYLAND_DISPLAY: "wayland-0" })).toBe(false);
  });
});

describe("gnomeKey", () => {
  const sym = (code: number) => ({ method: "NotifyKeyboardKeysym", code });

  it("maps names, characters and function keys to X keysyms", () => {
    expect(gnomeKey("a")).toEqual(sym(0x61));
    expect(gnomeKey("7")).toEqual(sym(0x37));
    expect(gnomeKey("/")).toEqual(sym(0x2f));
    expect(gnomeKey("space")).toEqual(sym(0x20));
    expect(gnomeKey("enter")).toEqual(sym(0xff0d));
    expect(gnomeKey("control")).toEqual(sym(0xffe3));
    expect(gnomeKey("f1")).toEqual(sym(0xffbe));
    expect(gnomeKey("f24")).toEqual(sym(0xffd5));
  });

  it("sends keypad digits as evdev keycodes — a keysym would drag Shift along", () => {
    expect(gnomeKey("numpad_0")).toEqual({ method: "NotifyKeyboardKeycode", code: 82 });
    expect(gnomeKey("numpad_7")).toEqual({ method: "NotifyKeyboardKeycode", code: 71 });
    expect(gnomeKey("numpad_9")).toEqual({ method: "NotifyKeyboardKeycode", code: 73 });
  });

  it("covers the WHOLE buttons.json vocabulary", () => {
    for (const { keys } of listKeys())
      for (const k of keys) {
        const canonical = normalizeKey(k);
        expect(canonical, k).not.toBeNull();
        expect(gnomeKey(canonical as string), k).not.toBeNull();
      }
  });

  it("rejects what is not a key", () => {
    expect(gnomeKey("f25")).toBeNull();
    expect(gnomeKey("numpad_x")).toBeNull();
    expect(gnomeKey("bogus")).toBeNull();
    expect(gnomeKey("é")).toBeNull();
    expect(gnomeKey("")).toBeNull();
  });
});

describe("gvString", () => {
  it("quotes and escapes for the GVariant text format", () => {
    expect(gvString("plain")).toBe("'plain'");
    expect(gvString("it's")).toBe(String.raw`'it\'s'`);
    expect(gvString(String.raw`a\b`)).toBe(String.raw`'a\\b'`);
  });
});

describe("openGnomeInput — setup", () => {
  it("opens a session framed by one desktop-wide stream", () => {
    const { r, world } = open();
    expect(r.reason).toBeNull();
    expect(r.input?.size).toEqual({ w: 1920, h: 1080 });
    expect(world.loaded).toEqual(["libgio-2.0.so.0", "libglib-2.0.so.0"]);
    expect(callLines(world)).toEqual([
      "GetCurrentState",
      "CreateSession",
      "GetAll ('org.gnome.Mutter.RemoteDesktop.Session',)",
      // the session id is random printables — quotes and backslashes escaped
      String.raw`CreateSession ({'remote-desktop-session-id': <'it\'s\\weird'>},)`,
      "RecordArea (0, 0, 1920, 1080, {})",
      "Start",
    ]);
    expect(world.calls.every((c) => c.wait)).toBe(true);
    expect(world.refs.released).toBe(world.refs.taken);
  });

  it.each([
    [{ libs: false }, "libgio-2.0.so.0: cannot open shared object file"],
    [{ bus: false }, "no D-Bus session bus to reach GNOME Shell on"],
    [{ display: false }, "GNOME Shell (org.gnome.Mutter.DisplayConfig) did not answer"],
    [{ monitors: [] }, "GNOME reported no active monitor"],
    [{ remote: false }, "GNOME's remote-control service (org.gnome.Mutter.RemoteDesktop) is not"],
    [{ sessionId: null }, "the remote-control session has no SessionId"],
    [{ cast: false }, "is PipeWire running?"],
    [{ area: false }, "GNOME refused the desktop-wide coordinate stream (RecordArea)"],
    [{ start: false }, "GNOME refused to start the remote-control session"],
    [{ parse: false }, "unparseable (s) arguments for GetAll"],
  ] as Array<[Partial<FakeWorld>, string]>)(
    "reports %j as a reason, never a throw",
    (over, why) => {
      const { r, world } = open(over);
      expect(r.input).toBeNull();
      expect(r.reason).toContain(why);
      expect(r.reason).not.toContain("\n");
      expect(world.refs.released).toBe(world.refs.taken);
    },
  );
});

describe("openGnomeInput — the stage", () => {
  it("physical layout: stage and stream agree, whatever the UI scale", () => {
    const { input, world } = opened({
      layoutMode: 2,
      monitors: [{ connector: "eDP-1", w: 3840, h: 2160, scale: 2, primary: true }],
    });
    expect(input.size).toEqual({ w: 3840, h: 2160 });
    input.mouse.setPosition(1200, 700);
    expect(callLines(world)).toEqual([`NotifyPointerMotionAbsolute (${STREAM}, 1200, 700)`]);
  });

  it("logical layout: the stage shrinks by the scale and the stream grows by it", () => {
    const { input, world } = opened({
      layoutMode: 1,
      monitors: [{ connector: "eDP-1", w: 3840, h: 2160, scale: 2, primary: true }],
    });
    expect(input.size).toEqual({ w: 1920, h: 1080 });
    input.mouse.setPosition(400, 300);
    expect(callLines(world)).toEqual([`NotifyPointerMotionAbsolute (${STREAM}, 800, 600)`]);
  });

  it("spans several monitors and uses the LARGEST scale of a logical layout", () => {
    const { input, world } = opened({
      layoutMode: 1,
      monitors: [
        { connector: "eDP-1", w: 3840, h: 2160, scale: 2, primary: true },
        { connector: "DP-1", w: 1920, h: 1080, scale: 1, x: 1920, y: 0 },
      ],
    });
    expect(input.size).toEqual({ w: 3840, h: 1080 });
    input.mouse.setPosition(2000, 10);
    expect(world.calls[0].text).toBe(`(${STREAM}, 4000, 20)`);
  });

  it("swaps width and height for a monitor turned by a quarter", () => {
    const { input } = opened({
      monitors: [{ connector: "DP-2", w: 1920, h: 1080, transform: 1, primary: true }],
    });
    expect(input.size).toEqual({ w: 1080, h: 1920 });
  });

  it("treats a missing layout-mode as physical and skips disabled outputs", () => {
    const { input } = opened({
      layoutMode: null,
      monitors: [
        { connector: "eDP-1", w: 2560, h: 1440, scale: 2, primary: true },
        { connector: "HDMI-1", w: 1920, h: 1080, active: false },
      ],
    });
    expect(input.size).toEqual({ w: 2560, h: 1440 });
  });
});

describe("detectGnomeMonitors", () => {
  it("lists the logical monitors in stage pixels", () => {
    const { ffi, world } = fakeGlib({
      layoutMode: 1,
      monitors: [
        { connector: "eDP-1", w: 3840, h: 2160, scale: 2, primary: true },
        { connector: "DP-1", w: 1920, h: 1080, x: 1920, y: 0 },
      ],
    });
    expect(detectGnomeMonitors(ffi)).toEqual([
      { x: 0, y: 0, w: 1920, h: 1080, primary: true, label: "eDP-1" },
      { x: 1920, y: 0, w: 1920, h: 1080, primary: false, label: "DP-1" },
    ]);
    expect(callLines(world)).toEqual(["GetCurrentState"]); // read-only: no session
    expect(world.refs.released).toBe(world.refs.taken);
  });

  it("throws when GNOME is not there", () => {
    expect(() => detectGnomeMonitors(fakeGlib({ bus: false }).ffi)).toThrow("no D-Bus session");
    expect(() => detectGnomeMonitors(fakeGlib({ display: false }).ffi)).toThrow("did not answer");
  });
});

describe("openGnomeInput — devices", () => {
  it("aims without waiting for a reply", async () => {
    const { input, world } = opened();
    await input.mouse.setPosition(10, 20);
    await input.mouse.setPosition(30, 40);
    expect(world.calls.map((c) => [c.text, c.wait])).toEqual([
      [`(${STREAM}, 10, 20)`, false],
      [`(${STREAM}, 30, 40)`, false],
    ]);
    expect(world.calls[0].sig).toBe("(sdd)");
    expect(await input.mouse.screenSize()).toEqual({ w: 1920, h: 1080 });
    expect(world.refs.released).toBe(world.refs.taken);
  });

  it("presses buttons by evdev code and waits for each", async () => {
    const { input, world } = opened();
    await input.mouse.click();
    await input.mouse.press("right");
    await input.mouse.release("middle");
    expect(callLines(world)).toEqual([
      "NotifyPointerButton (272, true)",
      "NotifyPointerButton (272, false)",
      "NotifyPointerButton (273, true)",
      "NotifyPointerButton (274, false)",
    ]);
    expect(world.calls.every((c) => c.wait && c.sig === "(ib)")).toBe(true);
    expect(world.refs.released).toBe(world.refs.taken);
  });

  it("sends keys in the given order, keypad digits as keycodes", async () => {
    const { input, world } = opened();
    await input.keyboard.pressKeys(["control", "numpad_7"]);
    await input.keyboard.releaseKeys(["numpad_7", "control"]);
    expect(world.calls.map((c) => `${c.method} ${c.text}`)).toEqual([
      "NotifyKeyboardKeysym (65507, true)",
      "NotifyKeyboardKeycode (71, true)",
      "NotifyKeyboardKeycode (71, false)",
      "NotifyKeyboardKeysym (65507, false)",
    ]);
  });

  it("refuses a key it cannot send instead of sending something else", async () => {
    const { input, world } = opened();
    await expect(input.keyboard.pressKeys(["bogus"])).rejects.toThrow('key "bogus" cannot be sent');
    expect(world.calls).toEqual([]);
  });

  it("close stops the session and never throws", () => {
    const { input, world } = opened();
    input.close();
    expect(callLines(world)).toEqual(["Stop"]);
    expect(world.alive).toBe(false);
    input.close(); // already gone: the failed call is swallowed
    world.parse = false;
    expect(() => input.close()).not.toThrow();
    expect(world.refs.released).toBe(world.refs.taken);
  });
});

describe("openGnomeInput — a session GNOME closed", () => {
  it("notices on the periodic check, starts a new one and re-sends", async () => {
    const { input, world, logs, clock } = opened({}, 2000);
    world.alive = false; // the user pressed "stop" in GNOME's indicator
    await input.mouse.setPosition(1, 1); // fire-and-forget: nobody notices yet
    expect(logs).toEqual([]);
    clock.t += 2000;
    await input.mouse.setPosition(5, 6);
    expect(logs).toEqual(["input: GNOME closed the remote-control session — started a new one"]);
    expect(world.sessions).toBe(2);
    // re-sent against the NEW stream, and answered
    expect(world.calls.at(-1)).toMatchObject({
      method: "NotifyPointerMotionAbsolute",
      text: "('/org/gnome/Mutter/ScreenCast/Stream/u2', 5, 6)",
      wait: true,
    });
    expect(world.refs.released).toBe(world.refs.taken);
  });

  it("recovers on a click too — a lost click is never silent", async () => {
    const { input, world, logs } = opened();
    world.alive = false;
    await input.mouse.press("left");
    expect(world.sessions).toBe(2);
    expect(logs).toHaveLength(1);
    expect(world.calls.at(-1)).toMatchObject({ method: "NotifyPointerButton", wait: true });
  });

  it("says once that the cursor stopped, stays quiet, then reports the recovery", async () => {
    const { input, world, logs, clock } = opened({}, 2000);
    world.alive = false;
    world.remote = false; // GNOME Shell itself is gone
    clock.t += 2000;
    await input.mouse.setPosition(1, 1);
    expect(logs).toEqual([
      "input: GNOME ended the remote-control session (GNOME's remote-control service (org.gnome.Mutter.RemoteDesktop) is not available)",
      "input: the cursor is not moving — retrying every few seconds",
    ]);
    // between checks: nothing is sent into the void, nothing is retried
    const before = world.calls.length;
    await input.mouse.setPosition(2, 2);
    expect(world.calls).toHaveLength(before);
    // the next check fails again — silently
    clock.t += 2000;
    await input.mouse.setPosition(3, 3);
    expect(logs).toHaveLength(2);
    // GNOME Shell is back
    world.remote = true;
    clock.t += 2000;
    await input.mouse.setPosition(4, 4);
    expect(logs.at(-1)).toBe("input: GNOME remote-control session re-established");
    expect(world.calls.at(-1)?.text).toBe("('/org/gnome/Mutter/ScreenCast/Stream/u2', 4, 4)");
    // and aim is fire-and-forget again
    await input.mouse.setPosition(5, 5);
    expect(world.calls.at(-1)?.wait).toBe(false);
  });

  it("re-reads the stage when it reconnects — monitors may have changed", async () => {
    const { input, world } = opened({ layoutMode: 1 });
    world.alive = false;
    world.monitors = [{ connector: "eDP-1", w: 3840, h: 2160, scale: 2, primary: true }];
    await input.mouse.press("left");
    await input.mouse.setPosition(100, 100);
    expect(world.calls.at(-1)?.text).toBe("('/org/gnome/Mutter/ScreenCast/Stream/u2', 200, 200)");
  });
});

import { describe, it, expect, afterEach, vi } from "vitest";
import {
  parseCombo,
  createWin32Probe,
  createX11Probe,
  createDarwinProbe,
  createComboProbe,
  watchCombo,
} from "../lib/hotkey.ts";
import type { Ffi } from "../lib/native.ts";

/** Windows fake: GetAsyncKeyState with the given VKs currently down. */
function winFfi(downVks: number[]) {
  const down = new Set(downVks);
  const specs: Array<Array<string | string[]>> = [];
  const ffi: Ffi = {
    load: () => ({
      func: (...spec) => {
        specs.push(spec);
        // real API: SHORT with the high bit set while the key is down
        return (vk) => (down.has(vk as number) ? -32768 : 0);
      },
    }),
  };
  return { ffi, down, specs };
}

/** X11 fake: keysym-name → keycode table plus the keycodes currently down. */
function x11Ffi(cfg: { display?: boolean; codes?: Record<string, number>; down?: number[] }) {
  const names: string[] = [];
  const codes = cfg.codes ?? {};
  const down = new Set(cfg.down ?? []);
  const funcs: Record<string, (...a: unknown[]) => unknown> = {
    XOpenDisplay: () => (cfg.display === false ? null : { dpy: true }),
    XStringToKeysym: (s) => (codes[s as string] !== undefined ? names.push(s as string) : 0),
    XKeysymToKeycode: (_dpy, sym) => codes[names[(sym as number) - 1]] ?? 0,
    XQueryKeymap: (_dpy, buf) => {
      const b = buf as Buffer;
      b.fill(0);
      for (const c of down) b[c >> 3] |= 1 << (c & 7);
      return 1;
    },
  };
  const ffi: Ffi = { load: () => ({ func: (...spec) => funcs[spec[0] as string] }) };
  return { ffi, down };
}

describe("parseCombo", () => {
  it("parses combos into canonical names, buttons.json vocabulary", () => {
    expect(parseCombo("shift+space")).toEqual(["shift", "space"]);
    expect(parseCombo("Ctrl+F12")).toEqual(["control", "f12"]);
    expect(parseCombo("a")).toEqual(["a"]);
  });
  it("drops duplicates and rejects unknown keys or empty specs", () => {
    expect(parseCombo("shift+shift+space")).toEqual(["shift", "space"]);
    expect(parseCombo("sift+space")).toBeNull();
    expect(parseCombo("")).toBeNull();
    expect(parseCombo("shift+")).toBeNull();
  });
});

describe("createWin32Probe", () => {
  it("is down only when EVERY combo key is down", () => {
    const shiftOnly = winFfi([0x10]);
    expect(createWin32Probe(shiftOnly.ffi, ["shift", "space"]).probe!.down()).toBe(false);
    const both = winFfi([0x10, 0x20]);
    expect(createWin32Probe(both.ffi, ["shift", "space"]).probe!.down()).toBe(true);
  });
  it("accepts either physical key when several map to one name", () => {
    const rightWin = winFfi([0x5c, 0x41]);
    expect(createWin32Probe(rightWin.ffi, ["win", "a"]).probe!.down()).toBe(true);
  });
  it("binds GetAsyncKeyState with the stdcall convention", () => {
    const { ffi, specs } = winFfi([]);
    createWin32Probe(ffi, ["space"]);
    expect(specs[0]).toEqual(["__stdcall", "GetAsyncKeyState", "int16", ["int"]]);
  });
  it("rejects keys without a stable virtual-key code", () => {
    const r = createWin32Probe(winFfi([]).ffi, ["control", ";"]);
    expect(r.probe).toBeNull();
    expect(r.reason).toContain('key ";" cannot be watched');
  });
  it("covers letters, digits, f-keys and the numpad", () => {
    const { ffi } = winFfi([0x42, 0x37, 0x7b, 0x65]); // b, 7, f12, numpad5
    expect(createWin32Probe(ffi, ["b", "7", "f12", "numpad_5"]).probe!.down()).toBe(true);
  });
});

describe("createX11Probe", () => {
  const CODES = { Shift_L: 50, Shift_R: 62, space: 65 };

  it("needs a DISPLAY before it even loads libX11", () => {
    const r = createX11Probe(x11Ffi({}).ffi, ["shift", "space"], {});
    expect(r.reason).toBe("no DISPLAY (headless session)");
  });
  it("reports an unopenable display", () => {
    const r = createX11Probe(x11Ffi({ display: false }).ffi, ["space"], { DISPLAY: ":0" });
    expect(r.reason).toBe("cannot open the X display");
  });
  it("tests keycode bits from one XQueryKeymap snapshot", () => {
    const { ffi, down } = x11Ffi({ codes: CODES, down: [65] });
    const probe = createX11Probe(ffi, ["shift", "space"], { DISPLAY: ":0" }).probe!;
    expect(probe.down()).toBe(false); // space alone
    down.add(62); // right shift counts as shift
    expect(probe.down()).toBe(true);
  });
  it("rejects keys the keyboard does not map", () => {
    const r = createX11Probe(x11Ffi({ codes: { space: 65 } }).ffi, ["shift", "space"], {
      DISPLAY: ":0",
    });
    expect(r.probe).toBeNull();
    expect(r.reason).toContain('key "shift" is not mapped');
  });
  it("rejects keys without a keysym name", () => {
    const r = createX11Probe(x11Ffi({ codes: CODES }).ffi, [";"], { DISPLAY: ":0" });
    expect(r.reason).toContain('key ";" cannot be watched');
  });
});

/** macOS fake: CGEventSourceKeyState with the given kVK codes currently down. */
function macFfi(downVks: number[]) {
  const down = new Set(downVks);
  const specs: Array<Array<string | string[]>> = [];
  const paths: string[] = [];
  const ffi: Ffi = {
    load: (p: string) => {
      paths.push(p);
      return {
        func: (...spec) => {
          specs.push(spec);
          // real API: Boolean, keyed by (stateID, keycode); 0 = combined session
          return (stateId, vk) => stateId === 0 && down.has(vk as number);
        },
      };
    },
  };
  return { ffi, down, specs, paths };
}

describe("createDarwinProbe", () => {
  it("is down only when EVERY combo key is down; either shift counts", () => {
    const leftOnly = macFfi([0x38]);
    expect(createDarwinProbe(leftOnly.ffi, ["shift", "s"]).probe!.down()).toBe(false);
    const rightAndS = macFfi([0x3c, 0x01]); // kVK_RightShift + kVK_ANSI_S
    expect(createDarwinProbe(rightAndS.ffi, ["shift", "s"]).probe!.down()).toBe(true);
  });
  it("binds CGEventSourceKeyState from the CoreGraphics framework", () => {
    const { ffi, specs, paths } = macFfi([]);
    createDarwinProbe(ffi, ["space"]);
    expect(paths[0]).toContain("CoreGraphics.framework");
    expect(specs[0]).toEqual(["CGEventSourceKeyState", "bool", ["int32", "uint16"]]);
  });
  it("covers letters, digits, f-keys and the numpad (non-contiguous kVK codes)", () => {
    const { ffi } = macFfi([0x0b, 0x1a, 0x6f, 0x57]); // b, 7, f12, numpad5
    expect(createDarwinProbe(ffi, ["b", "7", "f12", "numpad_5"]).probe!.down()).toBe(true);
  });
  it("rejects punctuation and keys macOS does not have (f21+)", () => {
    for (const bad of [";", "f21", "f24"]) {
      const r = createDarwinProbe(macFfi([]).ffi, ["control", bad]);
      expect(r.probe).toBeNull();
      expect(r.reason).toContain(`key "${bad}" cannot be watched on macOS`);
    }
  });
});

describe("createComboProbe", () => {
  it("dispatches by platform", () => {
    const win = createComboProbe(["space"], { ffi: winFfi([0x20]).ffi, platform: "win32" });
    expect(win.probe!.down()).toBe(true);
    const linux = createComboProbe(["space"], {
      ffi: x11Ffi({ codes: { space: 65 }, down: [65] }).ffi,
      platform: "linux",
      env: { DISPLAY: ":0" },
    });
    expect(linux.probe!.down()).toBe(true);
    const mac = createComboProbe(["space"], { ffi: macFfi([0x31]).ffi, platform: "darwin" });
    expect(mac.probe!.down()).toBe(true);
  });
  it("has no watcher for other platforms", () => {
    const r = createComboProbe(["space"], { ffi: winFfi([]).ffi, platform: "freebsd" });
    expect(r.reason).toContain('no key watcher for platform "freebsd"');
  });
  it("turns FFI load failures into a reason, never a throw", () => {
    const ffi: Ffi = {
      load: () => {
        throw new Error("user32.dll went missing");
      },
    };
    const r = createComboProbe(["space"], { ffi, platform: "win32" });
    expect(r.probe).toBeNull();
    expect(r.reason).toBe("user32.dll went missing");
  });
});

describe("watchCombo", () => {
  afterEach(() => vi.useRealTimers());

  it("toggles once per press: on the edge, not while held", () => {
    vi.useFakeTimers();
    const seq = [false, true, true, false, true];
    let i = 0;
    let toggles = 0;
    const w = watchCombo({ down: () => seq[Math.min(i++, seq.length - 1)] }, () => toggles++);
    vi.advanceTimersByTime(25 * 5);
    expect(toggles).toBe(2); // ticks 2 and 5; the held tick 3 does not re-fire
    w.stop();
    vi.advanceTimersByTime(200);
    expect(i).toBe(5); // no polling after stop()
  });

  it("stops itself and reports when the probe throws", () => {
    vi.useFakeTimers();
    const errors: string[] = [];
    let calls = 0;
    watchCombo(
      {
        down: () => {
          calls++;
          throw new Error("ffi died");
        },
      },
      () => {},
      25,
      (e) => errors.push(e.message),
    );
    vi.advanceTimersByTime(200);
    expect(errors).toEqual(["ffi died"]);
    expect(calls).toBe(1);
  });

  it("survives a throwing probe even without an error handler", () => {
    vi.useFakeTimers();
    let calls = 0;
    watchCombo(
      {
        down: () => {
          calls++;
          throw new Error("boom");
        },
      },
      () => {},
    );
    expect(() => vi.advanceTimersByTime(200)).not.toThrow();
    expect(calls).toBe(1);
  });
});

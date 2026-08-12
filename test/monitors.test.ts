import { describe, it, expect } from "vitest";
import {
  parseMonitorArg,
  boundingRect,
  selectMonitor,
  parseXrandr,
  detectWin32,
  detectMonitors,
  formatMonitorsReport,
  monitorsMain,
  type MonitorRect,
  type MonitorsReport,
} from "../lib/monitors.ts";
import type { Ffi } from "../lib/native.ts";

const mon = (over: Partial<MonitorRect> = {}): MonitorRect => ({
  x: 0,
  y: 0,
  w: 1920,
  h: 1080,
  primary: false,
  label: "M",
  ...over,
});

describe("parseMonitorArg", () => {
  it("parses the three shapes, case/space tolerant", () => {
    expect(parseMonitorArg("primary")).toEqual({ kind: "primary" });
    expect(parseMonitorArg(" ALL ")).toEqual({ kind: "all" });
    expect(parseMonitorArg("2")).toEqual({ kind: "index", index: 2 });
  });
  it("rejects garbage, zero and negatives", () => {
    for (const bad of ["", "0", "-1", "1.5", "second", "1 2"]) {
      expect(parseMonitorArg(bad)).toBeNull();
    }
  });
});

describe("boundingRect", () => {
  it("unions rects across a negative origin", () => {
    const b = boundingRect([
      mon({ x: 0, y: 0, primary: true }),
      mon({ x: -1920, y: -200, w: 1920, h: 1080 }),
    ]);
    expect(b).toMatchObject({ x: -1920, y: -200, w: 3840, h: 1280 });
    expect(b.label).toContain("2 monitors");
  });
});

describe("selectMonitor", () => {
  const two: MonitorsReport = {
    monitors: [mon({ label: "A" }), mon({ x: 1920, primary: true, label: "B" })],
    reason: null,
  };
  const none: MonitorsReport = { monitors: [], reason: "xrandr unavailable" };

  it("primary picks the primary flag, falls back to the first, degrades to null", () => {
    expect(selectMonitor(two, { kind: "primary" })!.label).toBe("B");
    const noFlag: MonitorsReport = { monitors: [mon({ label: "A" }), mon()], reason: null };
    expect(selectMonitor(noFlag, { kind: "primary" })!.label).toBe("A");
    expect(selectMonitor(none, { kind: "primary" })).toBeNull();
  });

  it("all spans the union and index is 1-based", () => {
    expect(selectMonitor(two, { kind: "all" })).toMatchObject({ x: 0, w: 3840 });
    expect(selectMonitor(two, { kind: "index", index: 1 })!.label).toBe("A");
  });

  it("explicit choices that cannot be honored throw with the reason", () => {
    expect(() => selectMonitor(none, { kind: "all" })).toThrow(/xrandr unavailable/);
    expect(() => selectMonitor(two, { kind: "index", index: 3 })).toThrow(/2 monitor/);
    expect(() => selectMonitor(none, { kind: "index", index: 1 })).toThrow(/monitors/);
  });
});

describe("parseXrandr", () => {
  const QUERY = [
    "Screen 0: minimum 320 x 200, current 3840 x 1080, maximum 16384 x 16384",
    "eDP-1 connected primary 1920x1080+0+0 (normal left inverted right x axis y axis) 344mm x 194mm",
    "   1920x1080     60.01*+  59.97    59.96",
    "DP-1 connected 1080x1920+1920+0 left (normal left inverted right x axis y axis) 597mm x 336mm",
    "HDMI-1 disconnected (normal left inverted right x axis y axis)",
    "HDMI-2 connected (normal left inverted right x axis y axis)",
    "DVI-D-0 disconnected primary (normal left inverted right x axis y axis)",
  ].join("\n");

  it("reads geometry, primary flag and labels; rotation token tolerated", () => {
    const m = parseXrandr(QUERY);
    expect(m).toEqual([
      { x: 0, y: 0, w: 1920, h: 1080, primary: true, label: "eDP-1" },
      { x: 1920, y: 0, w: 1080, h: 1920, primary: false, label: "DP-1" },
    ]);
  });

  it("never matches 'disconnected' as connected (substring trap)", () => {
    expect(parseXrandr("DP-9 disconnected 1920x1080+0+0 (normal)")).toEqual([]);
  });

  it("skips a connected output with no active mode (screen off)", () => {
    expect(parseXrandr("HDMI-2 connected (normal left inverted)")).toEqual([]);
  });

  it("survives CRLF output", () => {
    const m = parseXrandr("eDP-1 connected primary 800x600+0+0 (normal)\r\nX disconnected\r\n");
    expect(m).toHaveLength(1);
    expect(m[0].w).toBe(800);
  });

  it("returns [] for empty or header-only output", () => {
    expect(parseXrandr("")).toEqual([]);
    expect(parseXrandr("Screen 0: minimum 320 x 200, current 1920 x 1080")).toEqual([]);
  });
});

// ---------- Windows fake: buffers filled at the documented offsets ----------

interface FakeAdapter {
  name: string;
  flags: number;
  mode?: { x: number; y: number; w: number; h: number; fields?: number };
}

/** An Ffi whose user32 writes DISPLAY_DEVICEW / DEVMODEW at the real offsets. */
function win32Ffi(adapters: FakeAdapter[], opts: { dpiCtxFails?: boolean } = {}): Ffi {
  return {
    load: () => ({
      func: (...spec: Array<string | string[]>) => {
        const name = spec[1] as string;
        if (name === "SetProcessDpiAwarenessContext") return () => (opts.dpiCtxFails ? 0 : 1);
        if (name === "SetProcessDPIAware") return () => 1;
        if (name === "EnumDisplayDevicesW")
          return (...args: unknown[]) => {
            const [, i, buf] = args as [null, number, Buffer];
            const a = adapters[i];
            if (!a) return 0;
            expect(buf.readUInt32LE(0)).toBe(840); // caller must set cb
            buf.write(a.name, 4, "utf16le");
            buf.writeUInt32LE(a.flags, 324);
            return 1;
          };
        if (name === "EnumDisplaySettingsExW")
          return (...args: unknown[]) => {
            const [devName, which, buf] = args as [string, number, Buffer];
            expect(which).toBe(0xffffffff); // ENUM_CURRENT_SETTINGS
            expect(buf.readUInt16LE(68)).toBe(220); // caller must set dmSize
            const a = adapters.find((ad) => ad.name === devName);
            if (!a?.mode) return 0;
            buf.writeUInt32LE(a.mode.fields ?? 0x20, 72);
            buf.writeInt32LE(a.mode.x, 76);
            buf.writeInt32LE(a.mode.y, 80);
            buf.writeUInt32LE(a.mode.w, 172);
            buf.writeUInt32LE(a.mode.h, 176);
            return 1;
          };
        throw new Error(`unexpected func ${name}`);
      },
    }),
  };
}

describe("detectWin32", () => {
  // mirrors the real box this was verified on: primary at (0,0), second LEFT
  // of it at a negative origin, plus inactive and mirroring pseudo-adapters
  const REAL_BOX: FakeAdapter[] = [
    { name: "\\\\.\\DISPLAY1", flags: 0x80005, mode: { x: 0, y: 0, w: 1920, h: 1080 } },
    { name: "\\\\.\\DISPLAY2", flags: 0x80001, mode: { x: -1920, y: 0, w: 1920, h: 1080 } },
    { name: "\\\\.\\DISPLAY3", flags: 0x80000 }, // attached bit off, no mode
    { name: "\\\\.\\DISPLAYV1", flags: 0x89, mode: { x: 0, y: 0, w: 640, h: 480 } }, // mirroring
  ];

  it("lists active monitors with signed origins, skipping inactive and mirroring", () => {
    expect(detectWin32(win32Ffi(REAL_BOX))).toEqual([
      { x: 0, y: 0, w: 1920, h: 1080, primary: true, label: "\\\\.\\DISPLAY1" },
      { x: -1920, y: 0, w: 1920, h: 1080, primary: false, label: "\\\\.\\DISPLAY2" },
    ]);
  });

  it("skips modes without a valid position and survives the DPI fallback path", () => {
    const noPos: FakeAdapter[] = [
      { name: "\\\\.\\D1", flags: 0x5, mode: { x: 0, y: 0, w: 800, h: 600, fields: 0 } },
    ];
    expect(detectWin32(win32Ffi(noPos, { dpiCtxFails: true }))).toEqual([]);
  });
});

describe("detectMonitors", () => {
  it("win32: dispatches to the ffi and degrades when it explodes", async () => {
    const ok = await detectMonitors({
      platform: "win32",
      loadFfi: async () =>
        win32Ffi([{ name: "\\\\.\\D1", flags: 0x5, mode: { x: 0, y: 0, w: 800, h: 600 } }]),
    });
    expect(ok.monitors).toHaveLength(1);
    expect(ok.reason).toBeNull();

    const boom = await detectMonitors({
      platform: "win32",
      loadFfi: async () => {
        throw new Error("koffi missing\nnoise");
      },
    });
    expect(boom.monitors).toEqual([]);
    expect(boom.reason).toContain("koffi missing");
    expect(boom.reason).not.toContain("noise");
  });

  it("linux: runs xrandr through the injected exec and degrades when absent", async () => {
    const cmds: string[] = [];
    const ok = await detectMonitors({
      platform: "linux",
      exec: (c) => {
        cmds.push(c);
        return "eDP-1 connected primary 1920x1080+0+0 (normal)";
      },
    });
    expect(cmds).toEqual(["xrandr --query"]);
    expect(ok.monitors[0].label).toBe("eDP-1");

    const missing = await detectMonitors({
      platform: "linux",
      exec: () => {
        throw new Error("xrandr: command not found");
      },
    });
    expect(missing.monitors).toEqual([]);
    expect(missing.reason).toContain("xrandr unavailable");
  });

  it("names unimplemented platforms instead of guessing", async () => {
    const r = await detectMonitors({ platform: "darwin" });
    expect(r.monitors).toEqual([]);
    expect(r.reason).toContain("darwin");
  });
});

describe("formatMonitorsReport / monitorsMain", () => {
  it("prints indexed rows with the primary marked, then the usage hint", () => {
    const lines = formatMonitorsReport({
      monitors: [mon({ primary: true, label: "eDP-1" }), mon({ x: 1920, label: "DP-1" })],
      reason: null,
    });
    expect(lines[0]).toBe("1  eDP-1  1920x1080 at (0,0)  PRIMARY");
    expect(lines[1]).toBe("2  DP-1  1920x1080 at (1920,0)");
    expect(lines.at(-1)).toContain("--monitor all");
  });

  it("prints only the reason when nothing was detected", () => {
    expect(formatMonitorsReport({ monitors: [], reason: "why" })).toEqual(["why"]);
  });

  it("monitorsMain exits 0 with monitors, 1 without", async () => {
    const out: string[] = [];
    const code = await monitorsMain({
      platform: "linux",
      exec: () => "eDP-1 connected primary 1920x1080+0+0 (normal)",
      log: (l) => out.push(l),
    });
    expect(code).toBe(0);
    expect(out[0]).toContain("eDP-1");
    expect(
      await monitorsMain({
        platform: "linux",
        exec: () => {
          throw new Error("nope");
        },
        log: () => {},
      }),
    ).toBe(1);
  });
});

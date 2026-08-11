import { describe, it, expect, vi } from "vitest";
import {
  hasDisplay,
  parseScreenSize,
  renderAimLine,
  createVirtualMouse,
  createVirtualKeyboard,
  DEFAULT_SCREEN,
} from "../lib/virtual.ts";
import { createCursorLoop } from "../lib/cursor.ts";

describe("hasDisplay", () => {
  it("is false only on Linux without DISPLAY — the case that aborts the process", () => {
    expect(hasDisplay("linux", {})).toBe(false);
    expect(hasDisplay("linux", { DISPLAY: "" })).toBe(false);
    expect(hasDisplay("linux", { DISPLAY: ":0" })).toBe(true);
  });

  it("assumes a desktop on Windows and macOS", () => {
    expect(hasDisplay("win32", {})).toBe(true);
    expect(hasDisplay("darwin", {})).toBe(true);
  });

  it("defaults to this process's platform and environment", () => {
    expect(typeof hasDisplay()).toBe("boolean");
  });
});

describe("parseScreenSize", () => {
  it("accepts the documented forms", () => {
    expect(parseScreenSize("1920x1080")).toEqual({ w: 1920, h: 1080 });
    expect(parseScreenSize("2560X1440")).toEqual({ w: 2560, h: 1440 });
    expect(parseScreenSize(" 800 x 600 ")).toEqual({ w: 800, h: 600 });
    expect(parseScreenSize("800*600")).toEqual({ w: 800, h: 600 });
  });

  it("rejects anything it cannot turn into two positive numbers", () => {
    for (const bad of ["", "1920", "1920x", "axb", "-1920x1080", "1920x1080x60", "0x600"])
      expect(parseScreenSize(bad)).toBeNull();
  });
});

describe("renderAimLine", () => {
  it("shows the numbers and marks the position on both axes", () => {
    const line = renderAimLine(0, 0, 0, 0, 5);
    expect(line).toContain("u=0.000 v=0.000");
    expect(line).toContain("0,0 px");
    expect(line).toContain("x[+....]");
    expect(line).toContain("y[+....]");
  });

  it("puts centre in the middle and 1.0 at the far end", () => {
    expect(renderAimLine(0.5, 1, 960, 1079, 5)).toContain("x[..+..] y[....+]");
  });

  it("stays ASCII so it survives cmd.exe", () => {
    expect(renderAimLine(0.512, 0.334, 983, 360)).toMatch(/^[\x20-\x7e]+$/);
  });
});

describe("createVirtualMouse", () => {
  const spy = () => {
    const lines: string[] = [];
    return { lines, log: (l: string) => lines.push(l) };
  };

  it("prints where the cursor would go instead of moving one", async () => {
    const { lines, log } = spy();
    const m = createVirtualMouse({ log, size: { w: 1921, h: 1081 }, now: () => 0 });
    await m.setPosition(960, 540);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("u=0.500 v=0.500");
    expect(lines[0]).toContain("960,540 px");
  });

  it("reports the assumed screen size, since none can be measured", async () => {
    expect(await createVirtualMouse({ log: () => {} }).screenSize()).toBe(DEFAULT_SCREEN);
    const size = { w: 3840, h: 2160 };
    expect(await createVirtualMouse({ log: () => {}, size }).screenSize()).toEqual(size);
  });

  it("drops throttled samples rather than queueing them", async () => {
    const { lines, log } = spy();
    let t = 1000;
    const m = createVirtualMouse({ log, now: () => t, throttleMs: 100 });
    await m.setPosition(1, 1);
    t = 1050;
    await m.setPosition(2, 2);
    t = 1099;
    await m.setPosition(3, 3);
    t = 1100;
    await m.setPosition(4, 4);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("4,4 px");
  });

  it("logs clicks and holds without touching a device", async () => {
    const { lines, log } = spy();
    const m = createVirtualMouse({ log });
    await m.click();
    await m.press("right");
    await m.release("right");
    expect(lines).toEqual(["click  left", "press  right", "release right"]);
  });

  it("falls back to the console and a real clock when nothing is injected", async () => {
    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    const m = createVirtualMouse();
    await m.setPosition(10, 20);
    await m.setPosition(11, 21); // inside the default throttle window
    expect(out).toHaveBeenCalledTimes(1);
    createVirtualKeyboard().pressKeys(["f1"]);
    out.mockRestore();
  });

  it("satisfies the cursor loop end to end", async () => {
    const { lines, log } = spy();
    const mouse = createVirtualMouse({ log, size: { w: 101, h: 101 }, throttleMs: 0 });
    const loop = createCursorLoop(
      mouse,
      () => ({ w: 101, h: 101 }),
      () => ({ u: 0.25, v: 0.75 }),
      () => {},
      1,
    );
    await new Promise((r) => setTimeout(r, 20));
    loop.stop();
    expect(lines[0]).toContain("25,75 px");
  });
});

describe("createVirtualKeyboard", () => {
  it("reports combos in press and release order", async () => {
    const lines: string[] = [];
    const k = createVirtualKeyboard({ log: (l) => lines.push(l) });
    await k.pressKeys(["control", "f4"]);
    await k.releaseKeys(["f4", "control"]);
    expect(lines).toEqual(["keys down control+f4", "keys up   f4+control"]);
  });
});

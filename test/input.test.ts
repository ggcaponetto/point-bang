import { describe, it, expect, vi } from "vitest";
import { createMouse, createKeyboard } from "../lib/input.ts";
import type { LibNut } from "../lib/native.ts";

function fakeLibNut() {
  const calls: string[] = [];
  const lib: LibNut = {
    setMouseDelay: vi.fn((ms) => void calls.push(`mouseDelay:${ms}`)),
    setKeyboardDelay: vi.fn((ms) => void calls.push(`keyDelay:${ms}`)),
    moveMouse: vi.fn((x, y) => void calls.push(`move:${x},${y}`)),
    mouseClick: vi.fn((b) => void calls.push(`click:${b}`)),
    mouseToggle: vi.fn((down, b) => void calls.push(`${down}:${b}`)),
    keyToggle: vi.fn((k, down) => void calls.push(`key-${down}:${k}`)),
    getScreenSize: () => ({ width: 2560, height: 1440 }),
  };
  return { lib, calls };
}

describe("createMouse", () => {
  it("zeroes the mouse delay (libnut sleeps it inside every press/release)", async () => {
    const { lib, calls } = fakeLibNut();
    await createMouse(lib);
    expect(calls).toContain("mouseDelay:0");
  });
  it("moves, clicks, and holds buttons", async () => {
    const { lib, calls } = fakeLibNut();
    const m = await createMouse(lib);
    await m.setPosition(10, 20);
    await m.click();
    await m.press("right");
    await m.release("middle");
    expect(calls.slice(1)).toEqual(["move:10,20", "click:left", "down:right", "up:middle"]);
  });
  it("reads the screen size, renaming width/height to w/h", async () => {
    const { lib } = fakeLibNut();
    const m = await createMouse(lib);
    expect(await m.screenSize()).toEqual({ w: 2560, h: 1440 });
  });
});

describe("createKeyboard", () => {
  it("zeroes the keyboard delay", async () => {
    const { lib, calls } = fakeLibNut();
    await createKeyboard(lib);
    expect(calls).toContain("keyDelay:0");
  });
  it("toggles every key of a combo individually so holds work", async () => {
    const { lib, calls } = fakeLibNut();
    const k = await createKeyboard(lib);
    await k.pressKeys(["control", "shift", "f"]);
    await k.releaseKeys(["f", "shift", "control"]);
    expect(calls.slice(1)).toEqual([
      "key-down:control",
      "key-down:shift",
      "key-down:f",
      "key-up:f",
      "key-up:shift",
      "key-up:control",
    ]);
  });
});

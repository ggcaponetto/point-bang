import { describe, it, expect, vi } from "vitest";

const { setPosition, click, pressButton, releaseButton, pressKey, releaseKey } = vi.hoisted(() => ({
  setPosition: vi.fn(),
  click: vi.fn(),
  pressButton: vi.fn(),
  releaseButton: vi.fn(),
  pressKey: vi.fn(),
  releaseKey: vi.fn(),
}));
vi.mock("@nut-tree-fork/nut-js", () => ({
  mouse: { config: { autoDelayMs: 100 }, setPosition, click, pressButton, releaseButton },
  keyboard: { config: { autoDelayMs: 300 }, pressKey, releaseKey },
  screen: { width: async () => 2560, height: async () => 1440 },
  Point: class {
    x: number;
    y: number;
    constructor(x: number, y: number) {
      this.x = x;
      this.y = y;
    }
  },
  Button: { LEFT: "LEFT", RIGHT: "RIGHT", MIDDLE: "MIDDLE" },
  Key: { A: "key-A", Num1: "key-Num1", LeftControl: "key-LeftControl", Enter: "key-Enter" },
}));

import { createNutMouse, createNutKeyboard } from "../lib/input.ts";
import { mouse as nutMouse, keyboard as nutKeyboard } from "@nut-tree-fork/nut-js";

describe("createNutMouse", () => {
  it("zeroes autoDelayMs (the hidden ~200ms fire-click penalty)", async () => {
    await createNutMouse();
    expect(nutMouse.config.autoDelayMs).toBe(0);
  });
  it("wires setPosition through Point", async () => {
    const m = await createNutMouse();
    await m.setPosition(10, 20);
    expect(setPosition).toHaveBeenCalledWith(expect.objectContaining({ x: 10, y: 20 }));
  });
  it("clicks LEFT", async () => {
    const m = await createNutMouse();
    await m.click();
    expect(click).toHaveBeenCalledWith("LEFT");
  });
  it("presses and releases mapped buttons", async () => {
    const m = await createNutMouse();
    await m.press("right");
    await m.release("middle");
    expect(pressButton).toHaveBeenCalledWith("RIGHT");
    expect(releaseButton).toHaveBeenCalledWith("MIDDLE");
  });
  it("reads the screen size", async () => {
    const m = await createNutMouse();
    expect(await m.screenSize()).toEqual({ w: 2560, h: 1440 });
  });
});

describe("createNutKeyboard", () => {
  it("zeroes keyboard autoDelayMs (default 300ms per keypress)", async () => {
    await createNutKeyboard();
    expect(nutKeyboard.config.autoDelayMs).toBe(0);
  });
  it("maps normalized names to nut Key values, spread as variadic args", async () => {
    const k = await createNutKeyboard();
    await k.pressKeys(["LeftControl", "A"]);
    await k.releaseKeys(["A", "LeftControl"]);
    expect(pressKey).toHaveBeenCalledWith("key-LeftControl", "key-A");
    expect(releaseKey).toHaveBeenCalledWith("key-A", "key-LeftControl");
  });
  it("throws on names missing from the Key enum", async () => {
    const k = await createNutKeyboard();
    await expect(k.pressKeys(["NotAKey"])).rejects.toThrow('unknown key "NotAKey"');
  });
});

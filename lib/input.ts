import type { MouseButton, MouseLike } from "./cursor.ts";
import type { KeyboardLike } from "./buttons.ts";

/**
 * nut-js adapters behind the MouseLike/KeyboardLike interfaces (so a future
 * koffi/SendInput absolute-injection path can slot in unchanged, and tests
 * use fakes — never the real devices).
 *
 * nut-js defaults `autoDelayMs` to 100 (mouse) / 300 (keyboard), which sleeps
 * inside press/release — up to ~200ms added to every fire click. Both are
 * zeroed here. `setPosition` is unaffected (measured 0.2ms/call).
 *
 * @module
 */

/** Creates the real nut-js mouse behind the MouseLike interface. */
export async function createNutMouse(): Promise<MouseLike> {
  const nut = await import("@nut-tree-fork/nut-js");
  const { mouse, screen, Point, Button } = nut;
  mouse.config.autoDelayMs = 0;
  const BUTTONS: Record<MouseButton, (typeof Button)[keyof typeof Button]> = {
    left: Button.LEFT,
    right: Button.RIGHT,
    middle: Button.MIDDLE,
  };
  return {
    async setPosition(x, y) {
      await mouse.setPosition(new Point(x, y));
    },
    async click() {
      await mouse.click(Button.LEFT);
    },
    async press(button) {
      await mouse.pressButton(BUTTONS[button]);
    },
    async release(button) {
      await mouse.releaseButton(BUTTONS[button]);
    },
    async screenSize() {
      return { w: await screen.width(), h: await screen.height() };
    },
  };
}

/**
 * Creates the real nut-js keyboard behind the KeyboardLike interface.
 * Key names must exist in nut's `Key` enum; unknown names throw at press time
 * (config validation in lib/buttons keeps them out earlier).
 */
export async function createNutKeyboard(): Promise<KeyboardLike> {
  const nut = await import("@nut-tree-fork/nut-js");
  const { keyboard, Key } = nut;
  keyboard.config.autoDelayMs = 0;
  const toKeys = (names: string[]) =>
    names.map((n) => {
      const k = (Key as Record<string, unknown>)[n];
      if (k === undefined) throw new Error(`unknown key "${n}"`);
      return k as (typeof Key)[keyof typeof Key];
    });
  return {
    async pressKeys(names) {
      await keyboard.pressKey(...toKeys(names));
    },
    async releaseKeys(names) {
      await keyboard.releaseKey(...toKeys(names));
    },
  };
}

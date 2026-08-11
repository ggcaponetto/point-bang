import type { MouseButton, MouseLike } from "./cursor.ts";
import type { KeyboardLike } from "./buttons.ts";
import { loadLibNut, type LibNut } from "./native.ts";

/**
 * Device adapters over the raw libnut addon, behind the MouseLike/KeyboardLike
 * interfaces (so a future koffi/SendInput absolute-injection path can slot in
 * unchanged, and tests use fakes — never the real devices).
 *
 * We talk to libnut directly rather than through the nut-js wrapper: the six
 * calls below are all this project needs, the wrapper pulled a large image
 * library along for screen capture we never use, and its `bindings`-based
 * module lookup cannot survive being bundled into a single executable.
 *
 * libnut sleeps `setMouseDelay`/`setKeyboardDelay` milliseconds *inside* every
 * press and release — the defaults would add ~200ms to a fire click. Both are
 * zeroed here. `moveMouse` is unaffected (measured 0.2ms/call).
 *
 * @module
 */

const BUTTONS: Record<MouseButton, string> = {
  left: "left",
  right: "right",
  middle: "middle",
};

/**
 * Creates the real mouse behind the MouseLike interface.
 * @param lib Injected addon; loaded from disk (or the SEA blob) when omitted.
 */
export async function createMouse(lib?: LibNut): Promise<MouseLike> {
  const n = lib ?? (await loadLibNut());
  n.setMouseDelay(0);
  return {
    async setPosition(x, y) {
      n.moveMouse(x, y);
    },
    async click() {
      n.mouseClick("left");
    },
    async press(button) {
      n.mouseToggle("down", BUTTONS[button]);
    },
    async release(button) {
      n.mouseToggle("up", BUTTONS[button]);
    },
    async screenSize() {
      const s = n.getScreenSize();
      return { w: s.width, h: s.height };
    },
  };
}

/**
 * Creates the real keyboard behind the KeyboardLike interface. Each key of a
 * combo is toggled individually (modifiers included) so press-and-hold works;
 * names are libnut's, validated at config load in `lib/buttons`.
 * @param lib Injected addon; loaded from disk (or the SEA blob) when omitted.
 */
export async function createKeyboard(lib?: LibNut): Promise<KeyboardLike> {
  const n = lib ?? (await loadLibNut());
  n.setKeyboardDelay(0);
  return {
    async pressKeys(names) {
      for (const k of names) n.keyToggle(k, "down");
    },
    async releaseKeys(names) {
      for (const k of names) n.keyToggle(k, "up");
    },
  };
}

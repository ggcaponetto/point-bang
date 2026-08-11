import type { MouseButton, MouseLike } from "./cursor.ts";
import type { KeyboardLike } from "./buttons.ts";

/**
 * Virtual input devices: the MouseLike/KeyboardLike pair used when there is no
 * display to inject into. Instead of moving the OS cursor they print where the
 * cursor *would* go, which makes `serve` usable from a container, a CI box or
 * an SSH session — the whole phone-side flow (calibration, aim, buttons) can
 * be exercised with the PC side reporting rather than acting.
 *
 * This exists because the alternative is fatal: libnut does not throw when
 * X11 has no display, it prints "Could not open main display" and kills the
 * process from native code. Nothing downstream can catch that, so headless
 * runs must never reach the addon at all (same reasoning as `lib/check`).
 *
 * @module
 */

/** Pixel dimensions assumed when no real screen can be measured. */
export const DEFAULT_SCREEN = { w: 1920, h: 1080 };

/**
 * Can this machine accept injected input at all?
 *
 * Only Linux can answer no: libnut needs an X11 (or Xwayland) display, and
 * `DISPLAY` is how it finds one. Windows and macOS always have a desktop when
 * a user is logged in.
 */
export function hasDisplay(
  platform: string = process.platform,
  env: Record<string, string | undefined> = process.env,
): boolean {
  return platform !== "linux" || Boolean(env.DISPLAY);
}

/** Parses a `--screen 1920x1080` value. @returns null when unparsable. */
export function parseScreenSize(raw: string): { w: number; h: number } | null {
  const m = /^\s*(\d+)\s*[x*]\s*(\d+)\s*$/i.exec(raw);
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  return w > 0 && h > 0 ? { w, h } : null;
}

const bar = (t: number, width: number): string => {
  const cells = ".".repeat(width).split("");
  cells[Math.min(Math.max(Math.round(t * (width - 1)), 0), width - 1)] = "+";
  return cells.join("");
};

/**
 * One line of aim visualization: numbers plus a coarse position bar per axis.
 *
 * Off-screen aim never reaches here — the cursor loop clamps to the screen
 * before calling the device — so the bars only ever span [0..1].
 *
 * ASCII only and one line per print, on purpose: it shares stdout with the
 * jitter stats and connection logs, and it has to stay readable in `cmd.exe`.
 */
export function renderAimLine(u: number, v: number, x: number, y: number, width = 12): string {
  return (
    `aim  u=${u.toFixed(3)} v=${v.toFixed(3)}  ->  ${x},${y} px` +
    `   x[${bar(u, width)}] y[${bar(v, width)}]`
  );
}

/** Injection points for the virtual devices; all defaulted for real use. */
export interface VirtualDeps {
  log?: (line: string) => void;
  /** Screen the aim is scaled against — no real one can be measured here. */
  size?: { w: number; h: number };
  now?: () => number;
  /** Minimum gap between aim prints; 10Hz keeps a 500Hz loop readable. */
  throttleMs?: number;
}

/**
 * A mouse that reports instead of moving.
 *
 * Aim prints are throttled and *dropped*, never queued — same rule as the real
 * cursor loop. A consequence worth knowing: the cursor loop only calls in on
 * change, so the last position before the aim comes to rest can go unprinted,
 * leaving the display up to `throttleMs` stale.
 */
export function createVirtualMouse(d: VirtualDeps = {}): MouseLike {
  const log = d.log ?? console.log;
  const size = d.size ?? DEFAULT_SCREEN;
  const now = d.now ?? Date.now;
  const throttleMs = d.throttleMs ?? 100;
  let last = -Infinity;
  return {
    async setPosition(x, y) {
      const t = now();
      if (t - last < throttleMs) return;
      last = t;
      log(renderAimLine(x / (size.w - 1), y / (size.h - 1), x, y));
    },
    async click() {
      log("click  left");
    },
    async press(button: MouseButton) {
      log(`press  ${button}`);
    },
    async release(button: MouseButton) {
      log(`release ${button}`);
    },
    async screenSize() {
      return size;
    },
  };
}

/** A keyboard that reports instead of typing. */
export function createVirtualKeyboard(d: VirtualDeps = {}): KeyboardLike {
  const log = d.log ?? console.log;
  return {
    async pressKeys(keys) {
      log(`keys down ${keys.join("+")}`);
    },
    async releaseKeys(keys) {
      log(`keys up   ${keys.join("+")}`);
    },
  };
}

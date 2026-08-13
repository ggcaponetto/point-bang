/**
 * Cursor movement: screen-space scaling and the 2ms pull loop that keeps the
 * OS cursor on the (predicted) aim point without ever queueing stale moves.
 *
 * @module
 */

/** Physical mouse buttons an action can press. */
export type MouseButton = "left" | "right" | "middle";

/**
 * Everything the server needs from a pointing device. Implemented by the
 * nut-js adapter in `lib/input` and by test fakes; a future SendInput/koffi
 * path slots in behind the same interface.
 */
export interface MouseLike {
  setPosition(x: number, y: number): Promise<void>;
  click(): Promise<void>;
  press(button: MouseButton): Promise<void>;
  release(button: MouseButton): Promise<void>;
  screenSize(): Promise<{ w: number; h: number }>;
}

/**
 * The pixel rectangle aim maps into: one monitor, the spanning virtual
 * desktop, or the whole primary screen. `x`/`y` may be negative — on Windows
 * a monitor left of or above the primary has a negative origin.
 */
export interface TargetRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Maps normalized aim (u,v) to clamped pixel coordinates inside `rect`. */
export function scaleToRect(u: number, v: number, rect: TargetRect): { x: number; y: number } {
  return {
    x: rect.x + Math.round(Math.min(Math.max(u, 0), 1) * (rect.w - 1)),
    y: rect.y + Math.round(Math.min(Math.max(v, 0), 1) * (rect.h - 1)),
  };
}

/** Handle for a running cursor loop. */
export interface CursorLoop {
  stop(): void;
}

/**
 * Pull model: every tick asks `getTarget()` for where the cursor should be
 * NOW (typically an AimPredictor projection) and moves only when the target
 * pixel changed. A slow `setPosition` call can never queue stale positions.
 */
export function createCursorLoop(
  mouse: MouseLike,
  getRect: () => TargetRect,
  getTarget: () => { u: number; v: number } | null,
  onError: (e: Error) => void = () => {},
  tickMs = 2,
): CursorLoop {
  let applying = false;
  // null, not (-1,-1): a monitor left of the primary makes (-1,-1) a REAL
  // pixel, and a sentinel that collides with it would silently drop the move.
  let last: { x: number; y: number } | null = null;
  const timer = setInterval(async () => {
    if (applying) return;
    const target = getTarget();
    if (!target) return;
    const { x, y } = scaleToRect(target.u, target.v, getRect());
    if (x === last?.x && y === last?.y) return;
    applying = true;
    try {
      await mouse.setPosition(x, y);
      last = { x, y };
    } catch (e) {
      onError(e as Error);
    }
    applying = false;
  }, tickMs);
  return {
    stop() {
      clearInterval(timer);
    },
  };
}

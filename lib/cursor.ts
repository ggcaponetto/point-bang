// Apply-latest pattern: the phone sends ~60Hz; we only ever apply the newest
// sample, so a slow mouse call never builds a queue of stale positions.

export type MouseButton = "left" | "right" | "middle";

export interface MouseLike {
  setPosition(x: number, y: number): Promise<void>;
  click(): Promise<void>;
  press(button: MouseButton): Promise<void>;
  release(button: MouseButton): Promise<void>;
  screenSize(): Promise<{ w: number; h: number }>;
}

export function scaleToScreen(
  u: number,
  v: number,
  w: number,
  h: number,
): { x: number; y: number } {
  return {
    x: Math.round(Math.min(Math.max(u, 0), 1) * (w - 1)),
    y: Math.round(Math.min(Math.max(v, 0), 1) * (h - 1)),
  };
}

export interface CursorLoop {
  stop(): void;
}

// Pull model: every tick asks getTarget() for where the cursor should be NOW
// (typically an AimPredictor projection) and moves only when the target pixel
// changed. A slow setPosition call can never queue stale positions.
export function createCursorLoop(
  mouse: MouseLike,
  getSize: () => { w: number; h: number },
  getTarget: () => { u: number; v: number } | null,
  onError: (e: Error) => void = () => {},
  tickMs = 2,
): CursorLoop {
  let applying = false;
  let lastX = -1;
  let lastY = -1;
  const timer = setInterval(async () => {
    if (applying) return;
    const target = getTarget();
    if (!target) return;
    const { w, h } = getSize();
    const { x, y } = scaleToScreen(target.u, target.v, w, h);
    if (x === lastX && y === lastY) return;
    applying = true;
    try {
      await mouse.setPosition(x, y);
      lastX = x;
      lastY = y;
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

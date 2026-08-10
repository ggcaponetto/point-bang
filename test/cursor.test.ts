import { describe, it, expect, vi } from "vitest";
import { scaleToScreen, createCursorLoop, type MouseLike } from "../lib/cursor.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Windows timer resolution can be ~15.6ms — poll for conditions instead of
// assuming a fixed number of ticks happened during a sleep.
const until = async (cond: () => boolean, ms = 2000) => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("condition not met in time");
    await sleep(2);
  }
};

function fakeMouse(overrides: Partial<MouseLike> = {}): MouseLike & { moves: [number, number][] } {
  const moves: [number, number][] = [];
  return {
    moves,
    async setPosition(x: number, y: number) {
      moves.push([x, y]);
    },
    async click() {},
    async press() {},
    async release() {},
    async screenSize() {
      return { w: 1920, h: 1080 };
    },
    ...overrides,
  };
}

const SIZE = () => ({ w: 1920, h: 1080 });

describe("scaleToScreen", () => {
  it("maps u,v proportions to pixels", () => {
    expect(scaleToScreen(0.5, 0.5, 1920, 1080)).toEqual({ x: 960, y: 540 });
    expect(scaleToScreen(0, 0, 1920, 1080)).toEqual({ x: 0, y: 0 });
    expect(scaleToScreen(1, 1, 1920, 1080)).toEqual({ x: 1919, y: 1079 });
  });
  it("clamps off-screen values (reload gesture stays phone-side)", () => {
    expect(scaleToScreen(-0.4, 1.7, 1920, 1080)).toEqual({ x: 0, y: 1079 });
  });
});

describe("createCursorLoop (pull model)", () => {
  it("does nothing while the target is null", async () => {
    const m = fakeMouse();
    const loop = createCursorLoop(m, SIZE, () => null, undefined, 1);
    await sleep(10);
    loop.stop();
    expect(m.moves).toEqual([]);
  });

  it("moves once per distinct target pixel — no repeats for a steady aim", async () => {
    const m = fakeMouse();
    const loop = createCursorLoop(m, SIZE, () => ({ u: 0.5, v: 0.5 }), undefined, 1);
    await until(() => m.moves.length > 0);
    await sleep(40); // several more ticks with the same target
    loop.stop();
    expect(m.moves).toEqual([[960, 540]]);
  });

  it("tracks a changing target and lands on the newest one", async () => {
    const m = fakeMouse();
    let target = { u: 0.1, v: 0.1 };
    const loop = createCursorLoop(m, SIZE, () => target, undefined, 1);
    await until(() => m.moves.length > 0);
    target = { u: 1, v: 1 };
    await until(() => m.moves[m.moves.length - 1][0] === 1919);
    loop.stop();
    expect(m.moves[0]).toEqual([Math.round(0.1 * 1919), Math.round(0.1 * 1079)]);
    expect(m.moves[m.moves.length - 1]).toEqual([1919, 1079]);
  });

  it("never queues stale positions behind a slow mouse", async () => {
    const m = fakeMouse();
    const slow: MouseLike = {
      ...m,
      async setPosition(x, y) {
        await sleep(15);
        m.moves.push([x, y]);
      },
    };
    let target = { u: 0, v: 0 };
    const loop = createCursorLoop(slow, SIZE, () => target, undefined, 1);
    await sleep(5);
    target = { u: 0.5, v: 0.5 };
    await sleep(2);
    target = { u: 1, v: 1 };
    await until(() => m.moves.length > 0 && m.moves[m.moves.length - 1][0] === 1919);
    loop.stop();
    expect(m.moves.length).toBeLessThanOrEqual(3);
  });

  it("reports errors and retries the same target next tick", async () => {
    const m = fakeMouse();
    let calls = 0;
    const flaky: MouseLike = {
      ...m,
      async setPosition(x, y) {
        if (++calls === 1) throw new Error("boom");
        m.moves.push([x, y]);
      },
    };
    const onError = vi.fn();
    const loop = createCursorLoop(flaky, SIZE, () => ({ u: 0.5, v: 0.5 }), onError, 1);
    await until(() => m.moves.length > 0);
    loop.stop();
    expect(onError).toHaveBeenCalledOnce();
    expect(m.moves).toEqual([[960, 540]]);
  });

  it("stop() halts the loop", async () => {
    const m = fakeMouse();
    const loop = createCursorLoop(m, SIZE, () => ({ u: 0.5, v: 0.5 }), undefined, 1);
    loop.stop();
    await sleep(10);
    expect(m.moves).toEqual([]);
  });
});

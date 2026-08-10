import { describe, it, expect } from "vitest";
import { JitterWindow, formatJitter, percentile } from "../lib/jitter.ts";

describe("percentile", () => {
  it("indexes into a sorted array", () => {
    const s = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    expect(percentile(s, 0.5)).toBe(4);
    expect(percentile(s, 0.95)).toBe(8);
    expect(percentile(s, 1)).toBe(9);
  });
});

describe("JitterWindow", () => {
  it("returns null below the sample threshold", () => {
    const w = new JitterWindow();
    for (let i = 0; i < 9; i++) w.add(i);
    expect(w.summarize()).toBeNull();
  });

  it("subtracts the window minimum (clock offset is unknown)", () => {
    const w = new JitterWindow();
    // constant 1000ms offset + 0..9ms jitter
    for (let i = 0; i < 10; i++) w.add(1000 + i);
    const s = w.summarize()!;
    expect(s.count).toBe(10);
    expect(s.p50).toBe(4);
    expect(s.max).toBe(9);
  });

  it("clears the window after summarizing", () => {
    const w = new JitterWindow();
    for (let i = 0; i < 10; i++) w.add(i);
    expect(w.summarize()).not.toBeNull();
    expect(w.summarize()).toBeNull();
  });
});

describe("formatJitter", () => {
  it("prints the p50/p95/max line", () => {
    expect(formatJitter({ count: 120, p50: 1.234, p95: 4.5, max: 9 }, 2)).toBe(
      "aim msgs: 120/2s  jitter p50=1.2ms p95=4.5ms max=9.0ms",
    );
  });
});

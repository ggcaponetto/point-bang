import { describe, it, expect } from "vitest";
import { AimPredictor } from "../lib/predict.ts";

describe("AimPredictor", () => {
  it("returns null with no samples", () => {
    expect(new AimPredictor().predict(1000)).toBeNull();
  });

  it("returns the latest sample while velocity is unknown (<3 samples)", () => {
    const p = new AimPredictor(20);
    p.add(0.2, 0.3, 1000);
    expect(p.predict(1050)).toEqual({ u: 0.2, v: 0.3 });
    p.add(0.4, 0.5, 1016);
    expect(p.predict(1050)).toEqual({ u: 0.4, v: 0.5 });
  });

  it("lookahead 0 (the default) disables extrapolation — newest sample verbatim", () => {
    const p = new AimPredictor();
    // fast steady motion, stale by 10ms: extrapolation would land ahead of 0.048
    for (const t of [1000, 1016, 1032, 1048]) p.add((t - 1000) * 0.001, 0.5, t);
    expect(p.predict(1058)).toEqual({ u: 0.048, v: 0.5 });
  });

  it("projects constant velocity ahead by age + lookahead", () => {
    const p = new AimPredictor(20, 45);
    // u moves +0.001/ms, v is still
    for (const t of [1000, 1016, 1032, 1048]) p.add((t - 1000) * 0.001, 0.5, t);
    const out = p.predict(1058)!; // age 10ms + lookahead 20ms = 30ms ahead
    expect(out.u).toBeCloseTo(0.048 + 30 * 0.001, 6);
    expect(out.v).toBeCloseTo(0.5, 6);
  });

  it("caps the total projection horizon", () => {
    const p = new AimPredictor(20, 45);
    for (const t of [1000, 1016, 1032, 1048]) p.add((t - 1000) * 0.001, 0.5, t);
    const out = p.predict(5000)!; // very stale — capped at 45ms
    expect(out.u).toBeCloseTo(0.048 + 45 * 0.001, 6);
  });

  it("never projects backwards on clock skew", () => {
    const p = new AimPredictor(20, 45);
    for (const t of [1000, 1016, 1032]) p.add((t - 1000) * 0.001, 0.5, t);
    const out = p.predict(900)!; // now before last sample: age clamps to 0
    expect(out.u).toBeCloseTo(0.032 + 20 * 0.001, 6);
  });

  it("predicts a steady position for a steady aim", () => {
    const p = new AimPredictor(20, 45);
    for (const t of [1000, 1016, 1032, 1048]) p.add(0.5, 0.5, t);
    expect(p.predict(1060)).toEqual({ u: 0.5, v: 0.5 });
  });

  it("handles identical timestamps without dividing by zero", () => {
    const p = new AimPredictor(20);
    p.add(0.1, 0.1, 1000);
    p.add(0.2, 0.2, 1000);
    p.add(0.3, 0.3, 1000);
    expect(p.predict(1010)).toEqual({ u: 0.3, v: 0.3 });
  });

  it("keeps a bounded window of samples", () => {
    const p = new AimPredictor(20, 45, 1000);
    for (let i = 0; i < 50; i++) p.add(i, 0, 1000 + i * 16);
    // window holds at most 8 samples: regression stays local, prediction finite
    const out = p.predict(1000 + 49 * 16)!;
    expect(Number.isFinite(out.u)).toBe(true);
  });

  it("reset() forgets everything", () => {
    const p = new AimPredictor();
    p.add(0.5, 0.5, 1000);
    p.reset();
    expect(p.predict(1001)).toBeNull();
  });
});

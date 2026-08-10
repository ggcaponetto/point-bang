/**
 * PC-side aim extrapolation (roadmap Phase 3): least-squares velocity over
 * the last ~120ms of samples, projected slightly ahead of the newest one.
 * This hides network jitter and ~1 frame of delay, and lets the 2ms cursor
 * loop move smoothly BETWEEN 60Hz phone frames. It is prediction, not
 * smoothing — One Euro stays phone-side (don't double-smooth).
 *
 * @module
 */

interface Sample {
  u: number;
  v: number;
  t: number; // PC arrival time (ms) — phone clock offset is unknown
}

/**
 * Ring buffer of timestamped aim samples with a capped linear projection.
 * `add()` samples as they arrive, `predict(now)` for the cursor target;
 * `reset()` when tracking is lost so stale velocity can't keep extrapolating.
 */
export class AimPredictor {
  private samples: Sample[] = [];
  private lookaheadMs: number;
  private maxTotalMs: number;
  private windowMs: number;

  // lookaheadMs compensates phone-side capture->send latency we can't measure;
  // the total projection (sample age + lookahead) is capped so a dropped
  // connection or flick can't overshoot far.
  constructor(lookaheadMs = 20, maxTotalMs = 45, windowMs = 120) {
    this.lookaheadMs = lookaheadMs;
    this.maxTotalMs = maxTotalMs;
    this.windowMs = windowMs;
  }

  add(u: number, v: number, t: number): void {
    this.samples.push({ u, v, t });
    while (this.samples.length > 8 || this.samples[0].t < t - this.windowMs) this.samples.shift();
  }

  reset(): void {
    this.samples = [];
  }

  predict(now: number): { u: number; v: number } | null {
    const n = this.samples.length;
    if (n === 0) return null;
    const last = this.samples[n - 1];
    if (n < 3) return { u: last.u, v: last.v }; // no velocity estimate yet

    let tm = 0;
    for (const s of this.samples) tm += s.t;
    tm /= n;
    let um = 0,
      vm = 0;
    for (const s of this.samples) {
      um += s.u;
      vm += s.v;
    }
    um /= n;
    vm /= n;
    let den = 0,
      numU = 0,
      numV = 0;
    for (const s of this.samples) {
      const dt = s.t - tm;
      den += dt * dt;
      numU += dt * (s.u - um);
      numV += dt * (s.v - vm);
    }
    if (den === 0) return { u: last.u, v: last.v };

    const h = Math.min(Math.max(now - last.t, 0) + this.lookaheadMs, this.maxTotalMs);
    return { u: last.u + (numU / den) * h, v: last.v + (numV / den) * h };
  }
}

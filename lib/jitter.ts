/**
 * Transport jitter measurement. Phone and PC clocks differ by an unknown
 * offset, so absolute latency can't be computed from timestamps alone — but
 * (arrival − t) minus its window minimum is the jitter above best case,
 * which is the number that hurts feel. Judge changes by p95, not p50.
 *
 * @module
 */

/** One window's jitter percentiles in milliseconds. */
export interface JitterSummary {
  count: number;
  p50: number;
  p95: number;
  max: number;
}

/** Nearest-rank percentile of an already-sorted array. */
export function percentile(sorted: number[], q: number): number {
  return sorted[Math.floor(q * (sorted.length - 1))];
}

/** Accumulates (arrival − t) diffs and summarizes them per window. */
export class JitterWindow {
  private diffs: number[] = [];

  add(diff: number): void {
    this.diffs.push(diff);
  }

  // Returns null (and keeps accumulating) below minSamples; otherwise returns
  // the window summary and starts a fresh window.
  summarize(minSamples = 10): JitterSummary | null {
    if (this.diffs.length < minSamples) return null;
    const min = Math.min(...this.diffs);
    const jit = this.diffs.map((d) => d - min).sort((a, b) => a - b);
    const summary: JitterSummary = {
      count: jit.length,
      p50: percentile(jit, 0.5),
      p95: percentile(jit, 0.95),
      max: jit[jit.length - 1],
    };
    this.diffs = [];
    return summary;
  }
}

/** Renders a summary as the server's one-line jitter print. */
export function formatJitter(s: JitterSummary, windowSecs: number): string {
  return `aim msgs: ${s.count}/${windowSecs}s  jitter p50=${s.p50.toFixed(1)}ms p95=${s.p95.toFixed(1)}ms max=${s.max.toFixed(1)}ms`;
}

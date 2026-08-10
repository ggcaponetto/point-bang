// Phone and PC clocks differ by an unknown offset, so absolute latency can't
// be computed from timestamps alone. But (arrival - t) minus its window
// minimum = jitter above best case, which is the number that hurts feel.

export interface JitterSummary {
  count: number;
  p50: number;
  p95: number;
  max: number;
}

export function percentile(sorted: number[], q: number): number {
  return sorted[Math.floor(q * (sorted.length - 1))];
}

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

export function formatJitter(s: JitterSummary, windowSecs: number): string {
  return `aim msgs: ${s.count}/${windowSecs}s  jitter p50=${s.p50.toFixed(1)}ms p95=${s.p95.toFixed(1)}ms max=${s.max.toFixed(1)}ms`;
}

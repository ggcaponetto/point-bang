import { execSync } from "node:child_process";

// Sets up the USB tunnel so the phone's localhost:<port> reaches this PC.
// The mapping dies on cable replug / adb restart — start:adb re-runs it each time.
export function adbReverse(
  port: number,
  exec: (cmd: string) => void = (cmd) => execSync(cmd, { stdio: ["ignore", "pipe", "pipe"] }),
): { ok: boolean; detail: string } {
  try {
    exec(`adb reverse tcp:${port} tcp:${port}`);
    return {
      ok: true,
      detail: `adb reverse tcp:${port} active — open http://localhost:${port} on the phone`,
    };
  } catch (e) {
    const first = (e as Error).message.split("\n")[0];
    return {
      ok: false,
      detail:
        `adb reverse failed (${first}) — phone connected with USB debugging on?\n` +
        `Run manually once fixed: adb reverse tcp:${port} tcp:${port}`,
    };
  }
}

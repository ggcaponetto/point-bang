import { spawnSync } from "node:child_process";

/**
 * adb USB tunnel setup.
 * @module
 */

/** Runs one program with literal arguments — no shell, nothing to inject into. */
type AdbRun = (file: string, args: string[]) => void;

const runAdb: AdbRun = (file, args) => {
  const r = spawnSync(file, args, { stdio: ["ignore", "pipe", "pipe"] });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(String(r.stderr ?? "").trim() || `adb exited ${r.status}`);
};

/**
 * Runs `adb reverse` so the phone's `localhost:<port>` reaches this PC.
 * The mapping dies on cable replug / adb restart — `start:adb` re-runs it
 * each time. Failure is reported, never thrown; the server starts anyway.
 *
 * The port is validated and adb is invoked with an argument array (no shell),
 * so nothing that arrives via the CLI can smuggle extra commands in.
 */
export function adbReverse(port: number, run: AdbRun = runAdb): { ok: boolean; detail: string } {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, detail: `adb reverse skipped — invalid port ${port}` };
  }
  const mapping = `tcp:${port}`;
  try {
    run("adb", ["reverse", mapping, mapping]);
    return {
      ok: true,
      detail: `adb reverse tcp:${port} active — open http://localhost:${port} on the phone`,
    };
  } catch (e) {
    // adb.exe ends lines with \r\n — a plain "\n" split would leave the \r
    // behind and the carriage return would eat the start of the printed line.
    const first = (e as Error).message.split(/\r?\n/)[0];
    return {
      ok: false,
      detail:
        `adb reverse failed (${first}) — phone connected with USB debugging on?\n` +
        `Run manually once fixed: adb reverse tcp:${port} tcp:${port}`,
    };
  }
}

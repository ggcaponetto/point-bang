import { spawn as nodeSpawn } from "node:child_process";

/**
 * Public tunnels: exposing the local server on an HTTPS origin so a phone on
 * any network can load the WebXR page.
 *
 * Why this earns its place: WebXR demands a secure context, and the two
 * existing answers both need setup on the phone (the Chrome flag toggled,
 * or a Chrome origin flag). A tunnel hands you a real HTTPS URL with neither
 * — and because the phone page derives `wss://` from `location.protocol`,
 * aim data rides the very same tunnel with no client change.
 *
 * The cost is latency: every packet goes phone → carrier → ngrok's region PoP
 * → your PC. That is the opposite of what this project optimizes for, so the
 * tunnel is opt-in, off by default, and loudly labelled as a setup aid rather
 * than a way to play.
 *
 * We drive the `ngrok` binary rather than its SDK: the SDK is a native addon,
 * and native addons cannot live in a SEA blob (see `lib/native`). Shelling out
 * matches how `lib/adb` and `lib/wifi` already talk to platform tools.
 *
 * @module
 */

const MISSING =
  "ngrok is not installed or not on PATH — install it from https://ngrok.com/download " +
  "and run `ngrok config add-authtoken <token>` once (a free account is enough)";

/**
 * The hostname of a `--tunnel-url` value (scheme optional), `""` when it does
 * not parse. The caller regex-checks and REBUILDS the argument from this —
 * the raw CLI string never reaches the agent (argument-injection guard).
 */
const tunnelHost = (raw: string): string => {
  try {
    return new URL(raw.includes("://") ? raw : `https://${raw}`).hostname;
  } catch {
    return "";
  }
};

/** A live public endpoint pointed at the local server. */
export interface Tunnel {
  url: string;
  /**
   * True when the agent was already running and we merely borrowed it. It
   * outlives us and we must not kill it — which also means the caller has
   * nothing to keep alive and will exit straight away.
   */
  adopted: boolean;
  /** Kills the agent we spawned; a no-op when we attached to a running one. */
  stop(): void;
}

/** One entry of the agent's `/api/tunnels` response. */
interface AgentTunnel {
  public_url?: string;
  proto?: string;
  /** Current field name. */
  forwards_to?: string;
  /** Older agents put the same thing here. */
  config?: { addr?: string };
}

const forwardsTo = (t: AgentTunnel): string => t.forwards_to ?? t.config?.addr ?? "";

/**
 * Finds our own HTTPS endpoint in an agent API response.
 *
 * The agent may be forwarding several ports (a shared machine, a second
 * project), so the local port is matched rather than "first tunnel wins", and
 * only `https` is accepted — a plain-http endpoint is not a secure context and
 * WebXR would refuse it.
 */
export function pickTunnel(body: unknown, port: number): string | null {
  const list = (body as { tunnels?: AgentTunnel[] } | null)?.tunnels;
  if (!Array.isArray(list)) return null;
  const hit = list.find(
    (t) =>
      t.proto === "https" && typeof t.public_url === "string" && forwardsTo(t).endsWith(`:${port}`),
  );
  return hit?.public_url ?? null;
}

/**
 * Pulls the useful part out of the agent's JSON log.
 *
 * Its failures are the interesting ones — no authtoken, an account limited to
 * one session, a region typo — and they arrive as `err`/`msg` fields the user
 * would otherwise never see, because the agent's own output is swallowed.
 */
export function summarizeNgrokOutput(lines: string[]): string {
  const failures: string[] = [];
  const plain: string[] = [];
  for (const line of lines) {
    const text = line.trim();
    if (!text) continue;
    try {
      const rec = JSON.parse(text) as { lvl?: string; msg?: string; err?: string };
      // Level gates everything: the agent attaches `err` to routine info
      // records too ("ignoring default config path"), and reporting those as
      // the reason for a failure would be actively misleading.
      if (!rec.lvl || !/^(eror|error|crit)/i.test(rec.lvl)) continue;
      const note = rec.err ?? rec.msg;
      // Real errors are multi-line with embedded CRLF (they include signup
      // instructions); one log line means one line.
      if (note) failures.push(note.replace(/\s+/g, " ").trim());
    } catch {
      // Not JSON: an early crash or a usage error, worth keeping verbatim.
      plain.push(text);
    }
  }
  // The agent repeats its failure through several subsystems, then repeats it
  // again in plain text on stderr — prefer the structured copy and dedupe.
  const chosen = [...new Set(failures.length ? failures : plain)].slice(-2);
  const text = chosen.join("; ");
  return text.length > 300 ? text.slice(0, 297) + "..." : text;
}

/**
 * The lines printed once a tunnel is up. Split out so they can be asserted.
 *
 * The security lines are not decoration: a tunnel puts a socket that moves
 * the mouse and presses keys on the public internet. With a session `key`
 * the URL's fragment carries the credential — the socket refuses anyone
 * without it, but the full URL is still the key to this machine. Without a
 * key (`--key off`, or the standalone `tunnel` command in front of a server
 * whose loopback exemption is on), the URL alone is enough — whoever opens
 * one deserves to be told plainly.
 */
export function formatTunnelReport(
  url: string,
  adopted = false,
  key: string | null = null,
): string[] {
  const keyedUrl = key ? `${url}#key=${key}` : url;
  return [
    `TUNNEL: ${keyedUrl}  <-- open this on the phone, from any network`,
    "TUNNEL: it is HTTPS, so WebXR works with no Chrome flag needed",
    'TUNNEL: the free plan shows a one-time "Visit Site" warning page — tap through it',
    "TUNNEL: expect tens of ms more latency than USB; use it to set up, not to play",
    ...(key
      ? [
          "TUNNEL: connections must present the session key in this URL's #fragment —",
          "TUNNEL: it IS the key to this PC's mouse and keyboard. Share it with nobody.",
        ]
      : [
          "TUNNEL: WARNING — unauthenticated: anyone with this URL can move your mouse and",
          "TUNNEL: press keys on this PC. Share it with nobody and Ctrl+C when you are done.",
        ]),
    ...(adopted
      ? [
          "TUNNEL: this agent was already running — reusing it and leaving it up.",
          "TUNNEL: nothing to keep open here, so this command now exits; stop the",
          "TUNNEL: tunnel wherever that agent was started.",
        ]
      : []),
  ];
}

/** Injection points for {@link startNgrok}; defaults do the real thing. */
export interface NgrokDeps {
  spawn?: typeof nodeSpawn;
  /** GETs a URL and parses JSON; rejects/throws when the agent isn't up yet. */
  fetchJson?: (url: string) => Promise<unknown>;
  sleep?: (ms: number) => Promise<void>;
  /** Agent inspector port — where the tunnel list lives. */
  apiPort?: number;
  /**
   * A reserved endpoint URL to claim instead of a random one. Free accounts
   * get a single static domain; using it means the phone keeps the same
   * address between sessions (and only meets the interstitial once).
   *
   * There is deliberately no region option: `--region` is deprecated, because
   * the agent now picks the lowest-latency region by itself.
   */
  url?: string;
  /** How long to wait for the endpoint to come up before giving up. */
  timeoutMs?: number;
  pollMs?: number;
}

const defaultFetchJson = async (url: string): Promise<unknown> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`agent API ${res.status}`);
  return res.json();
};

/**
 * Brings up (or adopts) an ngrok endpoint for `port`.
 *
 * The URL comes from the agent's documented local API rather than by scraping
 * its log lines, and an agent that is already running is reused instead of
 * fought with — the free plan allows one session, so spawning a second one
 * just fails.
 *
 * @throws When the binary is missing, the agent dies, or no endpoint appears
 * before `timeoutMs`. Callers are expected to keep serving anyway: a tunnel is
 * a convenience, and the USB and LAN flows are unaffected by its absence.
 */
export async function startNgrok(port: number, d: NgrokDeps = {}): Promise<Tunnel> {
  // Regex is the injection guard (digits only), the range check sanity.
  const portArg = String(port);
  if (!/^\d{1,5}$/.test(portArg) || port < 1 || port > 65535) {
    throw new Error(`invalid port ${port}`);
  }
  const fetchJson = d.fetchJson ?? defaultFetchJson;
  const sleep = d.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const api = `http://127.0.0.1:${d.apiPort ?? 4040}/api/tunnels`;
  const timeoutMs = d.timeoutMs ?? 20000;
  const pollMs = d.pollMs ?? 250;

  const adopted = pickTunnel(await fetchJson(api).catch(() => null), port);
  if (adopted) return { url: adopted, adopted: true, stop: () => {} };

  // --log=stdout is not optional: without it the agent takes over the terminal
  // with its full-screen TUI and the server's own output becomes unreadable.
  const args = ["http", portArg, "--log=stdout", "--log-format=json"];
  if (d.url) {
    const host = tunnelHost(d.url);
    if (!/^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(host)) {
      throw new Error(`--tunnel-url must be a plain https hostname, got "${d.url}"`);
    }
    args.push(`--url=https://${host}`);
  }
  const child = (d.spawn ?? nodeSpawn)("ngrok", args, { stdio: ["ignore", "pipe", "pipe"] });

  const out: string[] = [];
  const collect = (chunk: unknown): void => {
    for (const line of String(chunk).split(/\r?\n/)) if (line.trim()) out.push(line);
    if (out.length > 200) out.splice(0, out.length - 200);
  };
  child.stdout?.on("data", collect);
  child.stderr?.on("data", collect);

  let died: string | null = null;
  child.on("exit", (code) => (died = `ngrok exited with code ${code}`));
  child.on(
    "error",
    (e) => (died = (e as NodeJS.ErrnoException).code === "ENOENT" ? MISSING : e.message),
  );

  const fail = (reason: string): Error => {
    child.kill();
    const detail = summarizeNgrokOutput(out);
    return new Error(detail ? `${reason}: ${detail}` : reason);
  };

  for (let waited = 0; waited < timeoutMs; waited += pollMs) {
    await sleep(pollMs);
    if (died) throw fail(died);
    const url = pickTunnel(await fetchJson(api).catch(() => null), port);
    if (url) return { url, adopted: false, stop: () => child.kill() };
  }
  throw fail(`no ngrok endpoint after ${Math.round(timeoutMs / 1000)}s`);
}

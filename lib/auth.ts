/**
 * Session-key gate for the two aim intakes (WebSocket upgrade, `/rtc/offer`).
 *
 * Why CORS is not enough: the allowlist in `lib/cors` only constrains
 * *browsers* — a non-browser client (curl, a script, any laptop on the same
 * WiFi) sends no Origin header and passes it untouched, and the WebSocket
 * never had an origin check at all. These sockets end at the mouse and
 * keyboard, so network clients must present a shared secret.
 *
 * The key rides the URL *fragment* (`#pc=…&key=…`), same as the LAN
 * addresses: fragments never leave the phone, so the page host (GitHub
 * Pages, ngrok) learns nothing. The phone page echoes it back in the
 * signaling body and the WS query string.
 *
 * Loopback is exempt by default: the adb/USB flow types
 * `http://localhost:8443` by hand, and a process that can connect to
 * loopback is already on this machine, where it could move the mouse
 * directly. The exemption MUST be dropped when an in-process tunnel is up —
 * ngrok's agent forwards the public internet to loopback.
 *
 * @module
 */

import crypto from "node:crypto";

/** Fragment- and query-safe, and long enough to not be guessable. */
const KEY_RE = /^[A-Za-z0-9._~-]{8,128}$/;

/** 128 random bits, base64url — 22 chars, QR- and fragment-friendly. */
export function generateKey(random: (bytes: number) => Buffer = crypto.randomBytes): string {
  return random(16).toString("base64url");
}

/**
 * Turns the `--key` flag into a key (or null = auth off, for trusted LANs).
 * A `problem` means the value was unusable and the caller should refuse to
 * start — silently generating a different key than the one the user asked
 * for would lock their bookmarked URL out.
 */
export function resolveKey(
  flag: string | undefined,
  random?: (bytes: number) => Buffer,
): { key: string | null; problem?: string } {
  if (flag === undefined || flag === "auto") return { key: generateKey(random) };
  if (flag === "off") return { key: null };
  if (!KEY_RE.test(flag))
    return {
      key: null,
      problem: `--key: 8-128 characters from A-Za-z0-9._~- (got "${flag}"), or "auto"/"off"`,
    };
  return { key: flag };
}

/** `remoteAddress` values loopback connections actually arrive with. */
export function isLoopback(addr: string | undefined): boolean {
  if (!addr) return false;
  const bare = addr.replace(/^::ffff:/i, "");
  return bare === "::1" || bare.startsWith("127.");
}

/** Decides, per connection, whether a presented key opens the gate. */
export interface KeyGate {
  /** The session key network clients must present; null = gate open. */
  key: string | null;
  /** Whether this particular connection must present the key at all. */
  required(remoteAddress: string | undefined): boolean;
  /** The one question both intakes ask. */
  allow(remoteAddress: string | undefined, presented: string | null | undefined): boolean;
}

/** Equal-length digests make the comparison timing-safe for any inputs. */
const digest = (s: string): Buffer => crypto.createHash("sha256").update(s).digest();

export function createKeyGate(opts: {
  key: string | null;
  /** Default true; pass false whenever loopback traffic can be remote (tunnel). */
  loopbackExempt?: boolean;
}): KeyGate {
  const { key } = opts;
  const exempt = opts.loopbackExempt ?? true;
  const expected = key === null ? null : digest(key);
  const required = (addr: string | undefined): boolean => {
    if (expected === null) return false;
    return !(exempt && isLoopback(addr));
  };
  return {
    key,
    required,
    allow(addr, presented) {
      if (!required(addr)) return true;
      if (typeof presented !== "string" || presented.length === 0) return false;
      return crypto.timingSafeEqual(digest(presented), expected!);
    },
  };
}

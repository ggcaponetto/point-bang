/**
 * The setup QR: encodes the hosted phone page plus this PC's LAN addresses
 * in the URL fragment (`#pc=ip:port,…`) — the whole consumer journey is
 * "run the exe, scan, tap Allow". The fragment never leaves the phone, so
 * the page host learns nothing about the LAN.
 *
 * @module
 */

import qrcode from "qrcode-terminal";
import type { LanAddress } from "./net.ts";

/** The GitHub-Pages copy of `public/` — override with `--page-url`. */
export const DEFAULT_PAGE_URL = "https://ggcaponetto.github.io/point-bang/phone/";

/**
 * The URL the QR encodes: WiFi-flagged interfaces first (that is the network
 * the phone shares), capped at three hosts to keep the QR scannable in an
 * 80-column terminal. Null when there is no LAN address to offer.
 */
export function phonePageUrl(
  pageUrl: string,
  addrs: LanAddress[],
  httpPort: number,
): string | null {
  if (addrs.length === 0) return null;
  const ordered = [...addrs.filter((a) => a.wifi), ...addrs.filter((a) => !a.wifi)].slice(0, 3);
  return `${pageUrl}#pc=${ordered.map((a) => `${a.address}:${httpPort}`).join(",")}`;
}

type Generate = (text: string, opts: { small: boolean }, cb: (q: string) => void) => void;

/**
 * Renders the QR as terminal lines (half-block chars, `small: true`).
 * Split on `\r?\n` — qrcode-terminal is an external formatter, same CRLF
 * rule as every other tool we parse.
 */
export function qrLines(
  text: string,
  // Wrapped, not detached: qrcode-terminal reads its error-correction level
  // off `this`, so a bare `qrcode.generate` reference renders nothing.
  generate: Generate = (t, o, cb) => qrcode.generate(t, o, cb),
): Promise<string[]> {
  return new Promise((resolve) =>
    generate(text, { small: true }, (q) => resolve(q.split(/\r?\n/))),
  );
}

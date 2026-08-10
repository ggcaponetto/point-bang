/**
 * WiFi band detection via `netsh wlan show interfaces` (Windows only).
 * Parsing avoids locale-specific labels where possible: the "GHz" unit and
 * "SSID" label survive translation; the channel label is matched across
 * common locales.
 *
 * @module
 */

/** Parsed connection info; `connected: false` when no SSID is present. */
export interface WifiReport {
  connected: boolean;
  ssid?: string;
  band?: string | null;
  channel?: string | null;
  signal?: string | null;
}

/** Infers the band when netsh has no explicit Band line (ch 1–14 = 2.4 GHz). */
export function bandFromChannel(channel: number): string {
  return channel <= 14 ? "2.4 GHz" : "5 GHz"; // ch 1-14 = 2.4
}

/** Extracts SSID, band, channel and signal from raw netsh output. */
export function parseNetsh(output: string): WifiReport {
  const lines = output.split(/\r?\n/);
  const val = (re: RegExp): string | null => {
    const l = lines.find((l) => re.test(l));
    return l ? l.split(":").slice(1).join(":").trim() : null;
  };
  const ssid = val(/^\s*SSID\s*:/); // "SSID" is not localized; skips BSSID
  if (!ssid) return { connected: false };
  return {
    connected: true,
    ssid,
    band: val(/GHz/), // Win11 "Band : 5 GHz" line, any locale
    channel: val(/^\s*(Channel|Canale|Kanal|Canal)\s*:/i),
    signal: val(/%/),
  };
}

/** Renders the `npm run wifi` report, including the 2.4 GHz warning. */
export function renderWifiReport(r: WifiReport): string[] {
  if (!r.connected) return ["Not connected to WiFi."];
  let verdict = r.band;
  if (!verdict && r.channel) verdict = bandFromChannel(+r.channel);
  const out = [
    `SSID:    ${r.ssid}`,
    `Band:    ${verdict ?? "unknown"}${r.channel ? `  (channel ${r.channel})` : ""}`,
  ];
  if (r.signal) out.push(`Signal:  ${r.signal}`);
  if (verdict?.startsWith("2.4"))
    out.push(
      "",
      "2.4 GHz = more interference and jitter. If your router has a 5 GHz",
      "SSID, connect the PC (and the phone) to that instead.",
    );
  return out;
}

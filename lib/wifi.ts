/**
 * WiFi band detection — 5 GHz is what you want for low aim jitter.
 *
 * Windows reads `netsh wlan show interfaces`; parsing avoids locale-specific
 * labels where possible (the "GHz" unit and the "SSID" label survive
 * translation, the channel label is matched across common locales). Linux
 * prefers `nmcli` (terse mode is locale-independent) and falls back to
 * `iw dev`. Both Linux tools report the frequency in MHz, which pins the band
 * exactly instead of inferring it from the channel number. macOS reads
 * `system_profiler SPAirPortDataType -json` — the JSON keys are stable
 * identifiers regardless of system language (the legacy `airport -I` tool
 * was removed in macOS 14.4, and `wdutil info` needs sudo).
 *
 * @module
 */

import { execSync } from "node:child_process";

/** Parsed connection info; `connected: false` when no SSID is present. */
export interface WifiReport {
  connected: boolean;
  ssid?: string;
  band?: string | null;
  channel?: string | null;
  signal?: string | null;
  /** Set when the probe itself failed (no adapter, no tooling). */
  error?: string;
}

/** Infers the band when only a channel number is available (ch 1–14 = 2.4 GHz). */
export function bandFromChannel(channel: number): string {
  return channel <= 14 ? "2.4 GHz" : "5 GHz"; // ch 1-14 = 2.4
}

/** Exact band from a centre frequency in MHz, or `null` outside the WiFi bands. */
export function bandFromMHz(mhz: number): string | null {
  if (mhz >= 2400 && mhz < 2500) return "2.4 GHz";
  if (mhz >= 4900 && mhz < 5925) return "5 GHz";
  if (mhz >= 5925 && mhz <= 7125) return "6 GHz";
  return null;
}

/** Extracts SSID, band, channel and signal from raw netsh output (Windows). */
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

// nmcli terse mode separates fields with ":" and backslash-escapes any colon
// inside a value (SSIDs and MAC-shaped fields routinely contain them).
function splitTerse(line: string): string[] {
  return line.split(/(?<!\\):/).map((f) => f.replaceAll(String.raw`\:`, ":"));
}

/**
 * Parses `nmcli -t -f ACTIVE,SSID,CHAN,FREQ,SIGNAL device wifi` (Linux).
 * Terse output is field-positional and locale-independent, so nothing here
 * depends on the system language.
 */
export function parseNmcli(output: string): WifiReport {
  for (const line of output.split(/\r?\n/)) {
    const [active, ssid, chan, freq, signal] = splitTerse(line);
    if (active !== "yes" || !ssid) continue;
    const mhz = Number.parseInt(freq ?? "", 10);
    return {
      connected: true,
      ssid,
      band: Number.isNaN(mhz) ? null : bandFromMHz(mhz),
      channel: chan || null,
      signal: signal ? `${signal}%` : null,
    };
  }
  return { connected: false };
}

/**
 * Parses `iw dev` (Linux fallback when NetworkManager isn't in use). Only
 * associated interfaces carry an `ssid` line, so an idle adapter reads as
 * disconnected. `iw` reports no signal strength here.
 */
export function parseIwDev(output: string): WifiReport {
  // [ \t] instead of \s: \s matches newlines, and with the m flag that lets
  // the engine backtrack across lines — super-linear on adversarial input.
  // \S pins the capture start: with (.+) the dot also matches blanks, so
  // [ \t]+ and the capture overlap and trailing whitespace backtracks
  // quadratically. The capture is trimmed either way, so behavior is equal.
  const ssid = /^[ \t]*ssid[ \t]+(\S.*)$/m.exec(output)?.[1].trim();
  if (!ssid) return { connected: false };
  // iw prints exactly "channel %d (%d MHz)" — single spaces, bounded digits.
  // Anything looser (e.g. \d+ then optional space) backtracks super-linearly.
  const ch = /^[ \t]*channel (\d{1,5}) \((\d{1,6}) MHz\)/m.exec(output);
  return {
    connected: true,
    ssid,
    band: ch ? bandFromMHz(+ch[2]) : null,
    channel: ch ? ch[1] : null,
    signal: null,
  };
}

/**
 * Parses `system_profiler SPAirPortDataType -json` (macOS). An interface
 * carrying `spairport_current_network_information` with a `_name` is the
 * "associated" signal (the status string wording varies across majors, so it
 * is deliberately not required). The channel value looks like
 * `"44 (5GHz, 80MHz)"` — the parenthetical pins the band (Apple abbreviates
 * 2.4 as plain "2" on some versions); a bare channel number falls back to
 * `bandFromChannel`. Any shape miss degrades to disconnected/unknown, never
 * a crash — the output format is Apple's to change.
 */
/** Band from the channel string's parts: the GHz parenthetical wins (Apple
 * abbreviates 2.4 as plain "2"), a bare channel number is inferred. */
function airportBand(ghz: string | undefined, channel: string | null): string | null {
  if (ghz) return ghz.startsWith("2") ? "2.4 GHz" : `${ghz} GHz`;
  return channel ? bandFromChannel(+channel) : null;
}

/** An interface's current-network record, or null when it is not associated. */
function airportInfo(iface: unknown): Record<string, unknown> | null {
  const info = (iface as Record<string, unknown>).spairport_current_network_information;
  return info && typeof info === "object" ? (info as Record<string, unknown>) : null;
}

/** The connected report for one associated interface's network record. */
function airportReport(info: Record<string, unknown>, ssid: string): WifiReport {
  const chanRaw =
    typeof info.spairport_network_channel === "string" ? info.spairport_network_channel : "";
  // bounded, anchored: "44 (5GHz, 80MHz)" / "6 (2GHz, 20MHz)" / bare "44"
  const m = /^(\d{1,5})(?: \((\d{1,2}(?:\.\d)?)GHz)?/.exec(chanRaw);
  const channel = m ? m[1] : null;
  const signal =
    typeof info.spairport_signal_noise === "string"
      ? (/-\d{1,3} dBm/.exec(info.spairport_signal_noise)?.[0] ?? null)
      : null;
  return { connected: true, ssid, band: airportBand(m?.[2], channel), channel, signal };
}

export function parseAirportJson(output: string): WifiReport {
  let root: unknown;
  try {
    root = JSON.parse(output);
  } catch {
    return { connected: false, error: "unexpected system_profiler output" };
  }
  const sections = (root as { SPAirPortDataType?: unknown[] }).SPAirPortDataType;
  if (!Array.isArray(sections))
    return { connected: false, error: "unexpected system_profiler output" };
  for (const section of sections) {
    const ifaces = (section as { spairport_airport_interfaces?: unknown[] })
      .spairport_airport_interfaces;
    for (const iface of Array.isArray(ifaces) ? ifaces : []) {
      const info = airportInfo(iface);
      if (info && typeof info._name === "string") return airportReport(info, info._name);
    }
  }
  return { connected: false };
}

/**
 * Runs the right probe for `platform`.
 * @returns The report, or `null` on a platform with no implementation.
 */
function probeWifi(exec: (cmd: string) => string, platform: string): WifiReport | null {
  if (platform === "win32") {
    try {
      return parseNetsh(exec("netsh wlan show interfaces"));
    } catch {
      return { connected: false, error: "netsh failed — is there a WiFi adapter?" };
    }
  }
  if (platform === "linux") {
    try {
      const r = parseNmcli(exec("nmcli -t -f ACTIVE,SSID,CHAN,FREQ,SIGNAL device wifi"));
      if (r.connected) return r;
    } catch {
      // NetworkManager absent — iw is the fallback, not an error yet.
    }
    try {
      return parseIwDev(exec("iw dev"));
    } catch {
      return { connected: false, error: "no WiFi info — install NetworkManager (nmcli) or iw" };
    }
  }
  if (platform === "darwin") {
    try {
      return parseAirportJson(exec("system_profiler SPAirPortDataType -json"));
    } catch {
      return { connected: false, error: "system_profiler failed — is there a WiFi adapter?" };
    }
  }
  return null;
}

/**
 * The `point-bang wifi` command: probe, print, and turn the result into an
 * exit code (0 connected / no implementation, 1 disconnected or probe failed).
 */
export function wifiMain(
  exec: (cmd: string) => string = (cmd) => execSync(cmd, { encoding: "utf8" }),
  log: (line: string) => void = console.log,
  platform: string = process.platform,
): number {
  const report = probeWifi(exec, platform);
  if (!report) {
    log("Band check is implemented for Windows, macOS and Linux — check your OS WiFi settings.");
    return 0;
  }
  for (const line of renderWifiReport(report)) log(line);
  return report.connected ? 0 : 1;
}

/** Renders the `point-bang wifi` report, including the 2.4 GHz warning. */
export function renderWifiReport(r: WifiReport): string[] {
  if (r.error) return [r.error];
  if (!r.connected) return ["Not connected to WiFi."];
  let verdict = r.band;
  if (!verdict && r.channel) verdict = bandFromChannel(+r.channel);
  const channelPart = r.channel ? `  (channel ${r.channel})` : "";
  const out = [`SSID:    ${r.ssid}`, `Band:    ${verdict ?? "unknown"}${channelPart}`];
  if (r.signal) out.push(`Signal:  ${r.signal}`);
  if (verdict?.startsWith("2.4"))
    out.push(
      "",
      "2.4 GHz = more interference and jitter. If your router has a 5 GHz",
      "SSID, connect the PC (and the phone) to that instead.",
    );
  return out;
}

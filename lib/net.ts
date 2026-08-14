import os from "node:os";
import { execSync } from "node:child_process";

/**
 * LAN address discovery — which IP should the phone dial?
 * @module
 */

/** One external IPv4 address with its interface name and a WiFi guess. */
export interface LanAddress {
  name: string;
  address: string;
  wifi: boolean;
}

type Interfaces = Record<
  string,
  { family: string; internal: boolean; address: string }[] | undefined
>;

/**
 * Parses `networksetup -listallhardwareports` (macOS): "Hardware Port:" /
 * "Device:" line pairs. Collects the device names whose port is the WiFi
 * adapter — macOS names interfaces `en0`/`en1`, which no name heuristic can
 * tell apart from Ethernet (en0 is WiFi on laptops but wired on a Mac mini).
 */
export function parseHardwarePorts(output: string): Set<string> {
  const wifi = new Set<string>();
  let port = "";
  for (const line of output.split(/\r?\n/)) {
    // \S pins the capture start so it cannot overlap the whitespace run —
    // /\s*(.+)/ backtracks quadratically on long blanks (house rule, see
    // parseIwDev in lib/wifi.ts).
    const p = /^Hardware Port:[ \t]*(\S.*)$/.exec(line);
    if (p) {
      port = p[1].trim();
      continue;
    }
    const d = /^Device:\s*(\S+)/.exec(line);
    if (d && /wi-?fi|airport/i.test(port)) wifi.add(d[1]);
  }
  return wifi;
}

/**
 * The WiFi interface names for platforms where the name alone cannot tell
 * (macOS only). `null` elsewhere or when the lookup fails — callers fall
 * back to the name regex.
 */
export function wifiInterfaceNames(
  exec: (cmd: string) => string = (cmd) => execSync(cmd, { encoding: "utf8" }),
  platform: string = process.platform,
): Set<string> | null {
  if (platform !== "darwin") return null;
  try {
    return parseHardwarePorts(exec("networksetup -listallhardwareports"));
  } catch {
    return null;
  }
}

// Cached per process: the QR banner and `ip` both call lanIPv4, and shelling
// networksetup once is plenty. Only the zero-argument (real machine) path
// uses this — injected interface fixtures keep the pure regex behavior.
let cachedWifiNames: Set<string> | null | undefined;
function defaultWifiNames(): Set<string> | null {
  if (cachedWifiNames === undefined) cachedWifiNames = wifiInterfaceNames();
  return cachedWifiNames;
}

/** Lists external IPv4 addresses, flagging Wi-Fi/WLAN interfaces. */
export function lanIPv4(ifaces?: Interfaces, wifiNames?: Set<string> | null): LanAddress[] {
  let names = wifiNames;
  if (names === undefined) names = ifaces ? null : defaultWifiNames();
  const list = ifaces ?? (os.networkInterfaces() as Interfaces);
  const out: LanAddress[] = [];
  for (const [name, addrs] of Object.entries(list))
    for (const i of addrs ?? [])
      if (i.family === "IPv4" && !i.internal)
        // Windows names the adapter "Wi-Fi"/"WLAN"; Linux uses wlan0 and the
        // predictable-names scheme (wlp2s0, wlx00...), all of which start
        // "wl"; macOS `en0`-style names come from `wifiNames` instead.
        out.push({
          name,
          address: i.address,
          wifi: (names?.has(name) ?? false) || /wi-?fi|^wl/i.test(name),
        });
  return out;
}

/**
 * Formats addresses for `npm run ip` — the marked Wi-Fi line is what the
 * phone needs (`http://<ip>:8443` or `https://<ip>:8444`).
 */
export function formatIpReport(addrs: LanAddress[]): string[] {
  return addrs.map((a) => `${a.name.padEnd(28)} ${a.address}${a.wifi ? "   <-- your WiFi" : ""}`);
}

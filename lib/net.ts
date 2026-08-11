import os from "node:os";

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

/** Lists external IPv4 addresses, flagging Wi-Fi/WLAN interfaces. */
export function lanIPv4(ifaces: Interfaces = os.networkInterfaces() as Interfaces): LanAddress[] {
  const out: LanAddress[] = [];
  for (const [name, addrs] of Object.entries(ifaces))
    for (const i of addrs ?? [])
      if (i.family === "IPv4" && !i.internal)
        // Windows names the adapter "Wi-Fi"/"WLAN"; Linux uses wlan0 and the
        // predictable-names scheme (wlp2s0, wlx00...), all of which start "wl".
        out.push({ name, address: i.address, wifi: /wi-?fi|^wl/i.test(name) });
  return out;
}

/**
 * Formats addresses for `npm run ip` — the marked Wi-Fi line is what the
 * phone needs (`http://<ip>:8443` or `https://<ip>:8444`).
 */
export function formatIpReport(addrs: LanAddress[]): string[] {
  return addrs.map((a) => `${a.name.padEnd(28)} ${a.address}${a.wifi ? "   <-- your WiFi" : ""}`);
}

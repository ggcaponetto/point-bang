import os from "node:os";

export interface LanAddress {
  name: string;
  address: string;
  wifi: boolean;
}

type Interfaces = Record<
  string,
  { family: string; internal: boolean; address: string }[] | undefined
>;

export function lanIPv4(ifaces: Interfaces = os.networkInterfaces() as Interfaces): LanAddress[] {
  const out: LanAddress[] = [];
  for (const [name, addrs] of Object.entries(ifaces))
    for (const i of addrs ?? [])
      if (i.family === "IPv4" && !i.internal)
        out.push({ name, address: i.address, wifi: /wi-?fi|wlan/i.test(name) });
  return out;
}

// The Wi-Fi interface is what the phone needs (http://<ip>:8443 or https://<ip>:8444).
export function formatIpReport(addrs: LanAddress[]): string[] {
  return addrs.map((a) => `${a.name.padEnd(28)} ${a.address}${a.wifi ? "   <-- your WiFi" : ""}`);
}

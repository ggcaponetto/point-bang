import { describe, it, expect } from "vitest";
import { lanIPv4, formatIpReport } from "../lib/net.ts";
import { ipMain } from "../ip.ts";

const IFACES = {
  Loopback: [{ family: "IPv4", internal: true, address: "127.0.0.1" }],
  "Wi-Fi": [
    { family: "IPv6", internal: false, address: "fe80::1" },
    { family: "IPv4", internal: false, address: "192.168.1.20" },
  ],
  Ethernet: [{ family: "IPv4", internal: false, address: "10.0.0.5" }],
  wlan0: [{ family: "IPv4", internal: false, address: "192.168.1.30" }],
  Dead: undefined,
};

describe("lanIPv4", () => {
  it("keeps external IPv4 only and flags WiFi interfaces", () => {
    expect(lanIPv4(IFACES)).toEqual([
      { name: "Wi-Fi", address: "192.168.1.20", wifi: true },
      { name: "Ethernet", address: "10.0.0.5", wifi: false },
      { name: "wlan0", address: "192.168.1.30", wifi: true },
    ]);
  });
  it("reads the real machine without crashing", () => {
    expect(Array.isArray(lanIPv4())).toBe(true);
  });
});

describe("formatIpReport", () => {
  it("marks the WiFi line", () => {
    const lines = formatIpReport(lanIPv4(IFACES));
    expect(lines[0]).toContain("192.168.1.20");
    expect(lines[0]).toContain("<-- your WiFi");
    expect(lines[1]).not.toContain("<--");
  });
});

describe("ipMain", () => {
  it("logs one line per address", () => {
    const out: string[] = [];
    ipMain(lanIPv4(IFACES), (l) => out.push(l));
    expect(out).toHaveLength(3);
  });
});

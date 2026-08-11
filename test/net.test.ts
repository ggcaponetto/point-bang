import { describe, it, expect } from "vitest";
import { lanIPv4, formatIpReport } from "../lib/net.ts";

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
  it("flags Linux predictable interface names, which contain neither wifi nor wlan", () => {
    const linux = {
      wlp2s0: [{ family: "IPv4", internal: false, address: "192.168.1.40" }],
      wlx00c0ca: [{ family: "IPv4", internal: false, address: "192.168.1.41" }],
      enp0s31f6: [{ family: "IPv4", internal: false, address: "10.0.0.9" }],
    };
    expect(lanIPv4(linux).map((a) => a.wifi)).toEqual([true, true, false]);
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

import { describe, it, expect } from "vitest";
import { lanIPv4, formatIpReport, parseHardwarePorts, wifiInterfaceNames } from "../lib/net.ts";

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

// macOS names every interface enN — only networksetup can say which is WiFi.
const PORTS = [
  "Hardware Port: Wi-Fi",
  "Device: en0",
  "Ethernet Address: a4:83:e7:00:00:00",
  "",
  "Hardware Port: Bluetooth PAN",
  "Device: en4",
  "Ethernet Address: a4:83:e7:00:00:01",
  "",
  "Hardware Port: Thunderbolt Ethernet",
  "Device: en5",
  "Ethernet Address: 00:00:00:00:00:02",
].join("\r\n");

describe("parseHardwarePorts / wifiInterfaceNames", () => {
  it("collects only WiFi/AirPort device names, CRLF tolerated", () => {
    expect([...parseHardwarePorts(PORTS)]).toEqual(["en0"]);
    expect([...parseHardwarePorts("Hardware Port: AirPort\nDevice: en1")]).toEqual(["en1"]);
  });
  it("resolves names only on darwin and degrades to null on failure", () => {
    const cmds: string[] = [];
    const names = wifiInterfaceNames((c) => {
      cmds.push(c);
      return PORTS;
    }, "darwin");
    expect(cmds[0]).toContain("networksetup -listallhardwareports");
    expect(names?.has("en0")).toBe(true);
    expect(wifiInterfaceNames(() => "", "win32")).toBeNull();
    expect(
      wifiInterfaceNames(() => {
        throw new Error("not found");
      }, "darwin"),
    ).toBeNull();
  });
  it("lanIPv4 prefers explicit WiFi names over the regex, union not veto", () => {
    const mac = {
      en0: [{ family: "IPv4", internal: false, address: "192.168.1.50" }],
      en5: [{ family: "IPv4", internal: false, address: "10.0.0.7" }],
      "Wi-Fi": [{ family: "IPv4", internal: false, address: "192.168.1.51" }],
    };
    const flagged = lanIPv4(mac, new Set(["en0"]));
    expect(flagged.map((a) => [a.name, a.wifi])).toEqual([
      ["en0", true],
      ["en5", false],
      ["Wi-Fi", true], // regex still counts — names add to it, never veto
    ]);
    // an explicit null (lookup failed) keeps the pure regex behavior
    expect(lanIPv4(mac, null).map((a) => a.wifi)).toEqual([false, false, true]);
  });
});

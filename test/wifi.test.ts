import { describe, it, expect } from "vitest";
import {
  parseNetsh,
  parseNmcli,
  parseIwDev,
  parseAirportJson,
  renderWifiReport,
  bandFromChannel,
  bandFromMHz,
  wifiMain,
} from "../lib/wifi.ts";

const NMCLI = [
  "no:Neighbour\\:Net:1:2412 MHz:41",
  "yes:CasaMia:100:5500 MHz:78",
  "no:Other:6:2437 MHz:33",
].join("\n");

const NMCLI_24 = "yes:CCHOME:11:2462 MHz:86";

const IW_DEV = `phy#0
	Interface wlp2s0
		ifindex 3
		addr aa:bb:cc:dd:ee:ff
		ssid HomeNet
		type managed
		channel 44 (5220 MHz), width: 80 MHz, center1: 5210 MHz
		txpower 22.00 dBm
`;

const IW_IDLE = `phy#0
	Interface wlp2s0
		ifindex 3
		type managed
`;

const EN_5GHZ = `
There is 1 interface on the system:

    Name                   : Wi-Fi
    State                  : connected
    SSID                   : HomeNet
    BSSID                  : aa:bb:cc:dd:ee:ff
    Radio type             : 802.11ax
    Band                   : 5 GHz
    Channel                : 44
    Signal                 : 92%
`;

const EN_24GHZ_NO_BAND = `
    Name                   : Wi-Fi
    State                  : connected
    SSID                   : CCHOME
    BSSID                  : aa:bb:cc:dd:ee:ff
    Channel                : 11
    Signal                 : 86%
`;

const IT_5GHZ = `
    Nome                   : Wi-Fi
    Stato                  : connessa
    SSID                   : CasaMia
    BSSID                  : aa:bb:cc:dd:ee:ff
    Banda                  : 5 GHz
    Canale                 : 100
    Segnale                : 70%
`;

const DISCONNECTED = `
    Name                   : Wi-Fi
    State                  : disconnected
`;

describe("bandFromChannel", () => {
  it("channels 1-14 are 2.4 GHz, higher is 5 GHz", () => {
    expect(bandFromChannel(1)).toBe("2.4 GHz");
    expect(bandFromChannel(14)).toBe("2.4 GHz");
    expect(bandFromChannel(36)).toBe("5 GHz");
  });
});

describe("parseNetsh", () => {
  it("parses an English 5 GHz interface", () => {
    expect(parseNetsh(EN_5GHZ)).toEqual({
      connected: true,
      ssid: "HomeNet",
      band: "5 GHz",
      channel: "44",
      signal: "92%",
    });
  });
  it("parses an Italian localization via the GHz unit", () => {
    const r = parseNetsh(IT_5GHZ);
    expect(r).toMatchObject({ connected: true, ssid: "CasaMia", band: "5 GHz", channel: "100" });
  });
  it("reports disconnected when no SSID is present", () => {
    expect(parseNetsh(DISCONNECTED)).toEqual({ connected: false });
  });
});

describe("renderWifiReport", () => {
  it("advises against 2.4 GHz, inferring band from channel", () => {
    const lines = renderWifiReport(parseNetsh(EN_24GHZ_NO_BAND));
    expect(lines[0]).toBe("SSID:    CCHOME");
    expect(lines[1]).toContain("2.4 GHz");
    expect(lines[1]).toContain("channel 11");
    expect(lines.join("\n")).toContain("more interference and jitter");
  });
  it("gives no advice on 5 GHz", () => {
    const lines = renderWifiReport(parseNetsh(EN_5GHZ));
    expect(lines.join("\n")).not.toContain("interference");
    expect(lines).toContain("Signal:  92%");
  });
  it("handles a disconnected adapter", () => {
    expect(renderWifiReport({ connected: false })).toEqual(["Not connected to WiFi."]);
  });
  it("prints unknown when neither band nor channel exist", () => {
    const lines = renderWifiReport({
      connected: true,
      ssid: "X",
      band: null,
      channel: null,
      signal: null,
    });
    expect(lines[1]).toBe("Band:    unknown");
  });
});

describe("bandFromMHz", () => {
  it("maps the WiFi bands and rejects anything outside them", () => {
    expect(bandFromMHz(2412)).toBe("2.4 GHz");
    expect(bandFromMHz(5500)).toBe("5 GHz");
    expect(bandFromMHz(6115)).toBe("6 GHz");
    expect(bandFromMHz(900)).toBeNull();
  });
});

describe("parseNmcli", () => {
  it("takes the active row and pins the band from the frequency", () => {
    expect(parseNmcli(NMCLI)).toEqual({
      connected: true,
      ssid: "CasaMia",
      band: "5 GHz",
      channel: "100",
      signal: "78%",
    });
  });
  it("un-escapes colons inside terse field values", () => {
    const r = parseNmcli(`yes:Neighbour\\:Net:1:2412 MHz:41`);
    expect(r.ssid).toBe("Neighbour:Net");
  });
  it("advises against 2.4 GHz", () => {
    expect(renderWifiReport(parseNmcli(NMCLI_24)).join("\n")).toContain("more interference");
  });
  it("reports disconnected when no row is active", () => {
    expect(parseNmcli("no:Foo:1:2412 MHz:41")).toEqual({ connected: false });
  });
});

describe("parseIwDev", () => {
  it("reads ssid and channel from an associated interface", () => {
    expect(parseIwDev(IW_DEV)).toEqual({
      connected: true,
      ssid: "HomeNet",
      band: "5 GHz",
      channel: "44",
      signal: null,
    });
  });
  it("reports disconnected for an idle adapter", () => {
    expect(parseIwDev(IW_IDLE)).toEqual({ connected: false });
  });
});

// system_profiler -json shapes: connected 5 GHz, connected 2.4 GHz (Apple
// abbreviates it "2GHz"), and an interface with no current network.
const airport = (info: object | undefined) =>
  JSON.stringify({
    SPAirPortDataType: [
      {
        spairport_airport_interfaces: [
          { _name: "en0", ...(info ? { spairport_current_network_information: info } : {}) },
        ],
      },
    ],
  });

describe("parseAirportJson", () => {
  it("reads ssid, channel, band and signal from a connected interface", () => {
    expect(
      parseAirportJson(
        airport({
          _name: "HomeNet",
          spairport_network_channel: "44 (5GHz, 80MHz)",
          spairport_signal_noise: "-55 dBm / -92 dBm",
        }),
      ),
    ).toEqual({
      connected: true,
      ssid: "HomeNet",
      band: "5 GHz",
      channel: "44",
      signal: "-55 dBm",
    });
  });
  it('maps Apple\'s "2GHz" to 2.4 GHz and tolerates a bare channel number', () => {
    const two = parseAirportJson(
      airport({ _name: "N", spairport_network_channel: "6 (2GHz, 20MHz)" }),
    );
    expect(two.band).toBe("2.4 GHz");
    const bare = parseAirportJson(airport({ _name: "N", spairport_network_channel: "149" }));
    expect(bare.band).toBe("5 GHz"); // bandFromChannel fallback
    expect(bare.signal).toBeNull();
  });
  it("reports disconnected when no interface carries network info", () => {
    expect(parseAirportJson(airport(undefined))).toEqual({ connected: false });
  });
  it("degrades on garbage or unexpected shapes, never throws", () => {
    expect(parseAirportJson("not json").error).toContain("unexpected");
    expect(parseAirportJson("{}").error).toContain("unexpected");
    expect(parseAirportJson('{"SPAirPortDataType":[{}]}')).toEqual({ connected: false });
  });
});

describe("wifiMain", () => {
  it("says so on a platform with no implementation", () => {
    const out: string[] = [];
    expect(
      wifiMain(
        () => "",
        (l) => out.push(l),
        "freebsd",
      ),
    ).toBe(0);
    expect(out[0]).toContain("Windows, macOS and Linux");
  });
  it("uses system_profiler on macOS and reports its failure", () => {
    const out: string[] = [];
    const cmds: string[] = [];
    const code = wifiMain(
      (c) => {
        cmds.push(c);
        return airport({ _name: "HomeNet", spairport_network_channel: "44 (5GHz, 80MHz)" });
      },
      (l) => out.push(l),
      "darwin",
    );
    expect(code).toBe(0);
    expect(cmds[0]).toContain("system_profiler SPAirPortDataType -json");
    expect(out[0]).toBe("SSID:    HomeNet");

    const failing: string[] = [];
    expect(
      wifiMain(
        () => {
          throw new Error("spawn failed");
        },
        (l) => failing.push(l),
        "darwin",
      ),
    ).toBe(1);
    expect(failing[0]).toContain("system_profiler failed");
  });
  it("uses nmcli on Linux", () => {
    const out: string[] = [];
    const cmds: string[] = [];
    const code = wifiMain(
      (c) => {
        cmds.push(c);
        return NMCLI;
      },
      (l) => out.push(l),
      "linux",
    );
    expect(code).toBe(0);
    expect(cmds[0]).toContain("nmcli");
    expect(out[0]).toBe("SSID:    CasaMia");
  });
  it("falls back to iw when nmcli is absent", () => {
    const out: string[] = [];
    const cmds: string[] = [];
    const code = wifiMain(
      (c) => {
        cmds.push(c);
        if (c.startsWith("nmcli")) throw new Error("not found");
        return IW_DEV;
      },
      (l) => out.push(l),
      "linux",
    );
    expect(code).toBe(0);
    expect(cmds).toHaveLength(2);
    expect(out[0]).toBe("SSID:    HomeNet");
  });
  it("falls back to iw when nmcli reports nothing active", () => {
    const out: string[] = [];
    const code = wifiMain(
      (c) => (c.startsWith("nmcli") ? "no:Foo:1:2412 MHz:41" : IW_DEV),
      (l) => out.push(l),
      "linux",
    );
    expect(code).toBe(0);
    expect(out[0]).toBe("SSID:    HomeNet");
  });
  it("reports when neither Linux tool exists", () => {
    const out: string[] = [];
    const code = wifiMain(
      () => {
        throw new Error("not found");
      },
      (l) => out.push(l),
      "linux",
    );
    expect(code).toBe(1);
    expect(out[0]).toContain("nmcli");
  });
  it("reports netsh failure", () => {
    const out: string[] = [];
    const code = wifiMain(
      () => {
        throw new Error("no wlan service");
      },
      (l) => out.push(l),
      "win32",
    );
    expect(code).toBe(1);
    expect(out[0]).toContain("netsh failed");
  });
  it("prints the report on success", () => {
    const out: string[] = [];
    expect(
      wifiMain(
        () => EN_5GHZ,
        (l) => out.push(l),
        "win32",
      ),
    ).toBe(0);
    expect(out[0]).toBe("SSID:    HomeNet");
  });
  it("exits 1 when disconnected", () => {
    expect(
      wifiMain(
        () => DISCONNECTED,
        () => {},
        "win32",
      ),
    ).toBe(1);
  });
});

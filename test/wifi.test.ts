import { describe, it, expect } from "vitest";
import { parseNetsh, renderWifiReport, bandFromChannel } from "../lib/wifi.ts";
import { wifiMain } from "../wifi.ts";

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

describe("wifiMain", () => {
  it("is a no-op on non-Windows platforms", () => {
    const out: string[] = [];
    expect(
      wifiMain(
        () => "",
        (l) => out.push(l),
        "darwin",
      ),
    ).toBe(0);
    expect(out[0]).toContain("Windows only");
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

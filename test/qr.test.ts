import { describe, it, expect } from "vitest";
import { phonePageUrl, qrLines, DEFAULT_PAGE_URL } from "../lib/qr.ts";
import type { LanAddress } from "../lib/net.ts";

const addr = (address: string, wifi: boolean): LanAddress => ({ name: "if", address, wifi });

describe("phonePageUrl", () => {
  it("puts WiFi interfaces first — that is the network the phone shares", () => {
    const url = phonePageUrl(
      DEFAULT_PAGE_URL,
      [addr("10.0.0.9", false), addr("192.168.1.5", true)],
      8443,
    );
    expect(url).toBe(`${DEFAULT_PAGE_URL}#pc=192.168.1.5:8443,10.0.0.9:8443`);
  });

  it("caps the list at three hosts to keep the QR scannable", () => {
    const url = phonePageUrl(
      DEFAULT_PAGE_URL,
      [
        addr("1.1.1.1", true),
        addr("2.2.2.2", true),
        addr("3.3.3.3", false),
        addr("4.4.4.4", false),
      ],
      9000,
    );
    expect(url).toBe(`${DEFAULT_PAGE_URL}#pc=1.1.1.1:9000,2.2.2.2:9000,3.3.3.3:9000`);
  });

  it("returns null when there is no LAN address to encode", () => {
    expect(phonePageUrl(DEFAULT_PAGE_URL, [], 8443)).toBeNull();
    expect(phonePageUrl(DEFAULT_PAGE_URL, [], 8443, "abc123-XY")).toBeNull();
  });

  it("appends the session key to the fragment — scanning hands over the credential", () => {
    const url = phonePageUrl(DEFAULT_PAGE_URL, [addr("192.168.1.5", true)], 8443, "abc123-XY");
    expect(url).toBe(`${DEFAULT_PAGE_URL}#pc=192.168.1.5:8443&key=abc123-XY`);
    // null = gate off: the fragment stays key-free
    expect(phonePageUrl(DEFAULT_PAGE_URL, [addr("192.168.1.5", true)], 8443, null)).toBe(
      `${DEFAULT_PAGE_URL}#pc=192.168.1.5:8443`,
    );
  });
});

describe("qrLines", () => {
  it("splits the generated block on CRLF or LF", async () => {
    const lines = await qrLines("x", (_t, _o, cb) => cb("aa\r\nbb\ncc"));
    expect(lines).toEqual(["aa", "bb", "cc"]);
  });

  it("renders a real QR with qrcode-terminal", async () => {
    const lines = await qrLines(`${DEFAULT_PAGE_URL}#pc=192.168.1.5:8443`);
    expect(lines.length).toBeGreaterThan(10); // a real matrix, not a stub
    expect(lines.some((l) => l.trim().length > 0)).toBe(true);
  });
});

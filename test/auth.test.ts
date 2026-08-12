import { describe, it, expect } from "vitest";
import { generateKey, resolveKey, isLoopback, createKeyGate } from "../lib/auth.ts";

describe("generateKey", () => {
  it("mints fragment-safe base64url keys", () => {
    const k = generateKey();
    expect(k).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it("uses the injected randomness (and 128 bits of it)", () => {
    let asked = 0;
    const k = generateKey((n) => {
      asked = n;
      return Buffer.alloc(n, 7);
    });
    expect(asked).toBe(16);
    expect(k).toBe(Buffer.alloc(16, 7).toString("base64url"));
  });
});

describe("resolveKey", () => {
  it("generates on 'auto' and on no flag at all", () => {
    expect(resolveKey("auto").key).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(resolveKey(undefined).key).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it("'off' disables the gate", () => {
    expect(resolveKey("off")).toEqual({ key: null });
  });

  it("passes an explicit key through", () => {
    expect(resolveKey("my-fixed-key.01")).toEqual({ key: "my-fixed-key.01" });
  });

  it("refuses unusable keys instead of silently substituting", () => {
    for (const bad of ["short", "has spaces", "ümlaut-key", "x".repeat(129)]) {
      const r = resolveKey(bad);
      expect(r.key).toBeNull();
      expect(r.problem).toContain("--key");
    }
  });
});

describe("isLoopback", () => {
  it("matches the shapes loopback connections actually arrive with", () => {
    expect(isLoopback("127.0.0.1")).toBe(true);
    expect(isLoopback("127.8.9.10")).toBe(true);
    expect(isLoopback("::1")).toBe(true);
    expect(isLoopback("::ffff:127.0.0.1")).toBe(true);
  });

  it("treats everything else — including unknown — as remote", () => {
    expect(isLoopback("192.168.1.7")).toBe(false);
    expect(isLoopback("::ffff:192.168.1.7")).toBe(false);
    expect(isLoopback(undefined)).toBe(false);
    expect(isLoopback("")).toBe(false);
  });
});

describe("createKeyGate", () => {
  const LAN = "192.168.1.7";
  const LOOP = "127.0.0.1";

  it("key null = gate open for everyone", () => {
    const g = createKeyGate({ key: null });
    expect(g.required(LAN)).toBe(false);
    expect(g.allow(LAN, undefined)).toBe(true);
    expect(g.allow(undefined, undefined)).toBe(true);
  });

  it("requires the exact key from network clients", () => {
    const g = createKeyGate({ key: "abc123-XY" });
    expect(g.required(LAN)).toBe(true);
    expect(g.allow(LAN, "abc123-XY")).toBe(true);
    expect(g.allow(LAN, "abc123-Xy")).toBe(false);
    expect(g.allow(LAN, "")).toBe(false);
    expect(g.allow(LAN, undefined)).toBe(false);
    expect(g.allow(LAN, null)).toBe(false);
    // an unknown remote address never bypasses the gate
    expect(g.allow(undefined, undefined)).toBe(false);
  });

  it("exempts loopback by default — the adb/USB flow", () => {
    const g = createKeyGate({ key: "abc123-XY" });
    expect(g.required(LOOP)).toBe(false);
    expect(g.allow(LOOP, undefined)).toBe(true);
    expect(g.allow("::1", undefined)).toBe(true);
  });

  it("holds loopback to the key when the exemption is off (tunnel)", () => {
    const g = createKeyGate({ key: "abc123-XY", loopbackExempt: false });
    expect(g.required(LOOP)).toBe(true);
    expect(g.allow(LOOP, undefined)).toBe(false);
    expect(g.allow(LOOP, "abc123-XY")).toBe(true);
  });

  it("compares without length leaks (a longer/shorter guess just fails)", () => {
    const g = createKeyGate({ key: "abc123-XY" });
    expect(g.allow(LAN, "a")).toBe(false);
    expect(g.allow(LAN, "abc123-XY-and-more")).toBe(false);
  });
});

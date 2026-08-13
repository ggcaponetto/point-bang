import { describe, it, expect } from "vitest";
import { originAllowed, corsHeaders } from "../lib/cors.ts";

const PAGES = ["https://ggcaponetto.github.io"];

describe("originAllowed", () => {
  it("passes requests without an Origin (curl, non-browser)", () => {
    expect(originAllowed({ origin: undefined, host: "192.168.1.5:8443" }, PAGES)).toBe(true);
  });

  it("passes the allowlisted hosted-page origin", () => {
    expect(
      originAllowed({ origin: "https://ggcaponetto.github.io", host: "192.168.1.5:8443" }, PAGES),
    ).toBe(true);
  });

  it("passes same-origin browsers regardless of scheme (localhost, tunnel)", () => {
    expect(originAllowed({ origin: "http://localhost:8443", host: "localhost:8443" }, PAGES)).toBe(
      true,
    );
    expect(
      originAllowed({ origin: "https://abc.ngrok-free.app", host: "abc.ngrok-free.app" }, PAGES),
    ).toBe(true);
  });

  it("rejects any other website", () => {
    expect(originAllowed({ origin: "https://evil.example", host: "192.168.1.5:8443" }, PAGES)).toBe(
      false,
    );
  });

  it("rejects an unparseable Origin", () => {
    expect(originAllowed({ origin: "not a url", host: "x" }, PAGES)).toBe(false);
  });
});

describe("corsHeaders", () => {
  it("returns {} when no Origin is present — nothing to allow", () => {
    expect(corsHeaders({ origin: undefined, host: "h" }, PAGES, false)).toEqual({});
  });

  it("answers an allowlisted Origin with the allowlist value and Vary", () => {
    const h = corsHeaders({ origin: "https://ggcaponetto.github.io", host: "h" }, PAGES, false);
    expect(h).toEqual({
      "Access-Control-Allow-Origin": "https://ggcaponetto.github.io",
      Vary: "Origin",
    });
  });

  it("returns {} for same-origin requests — CORS is only enforced cross-origin", () => {
    expect(
      corsHeaders({ origin: "http://localhost:8443", host: "localhost:8443" }, PAGES, false),
    ).toEqual({});
    expect(
      corsHeaders(
        { origin: "https://abc.ngrok-free.app", host: "abc.ngrok-free.app" },
        PAGES,
        true,
      ),
    ).toEqual({});
  });

  it("adds preflight headers including the private-network opt-in", () => {
    const h = corsHeaders({ origin: "https://ggcaponetto.github.io", host: "h" }, PAGES, true)!;
    expect(h["Access-Control-Allow-Methods"]).toBe("GET, POST, OPTIONS");
    expect(h["Access-Control-Allow-Headers"]).toBe("content-type");
    expect(h["Access-Control-Allow-Private-Network"]).toBe("true");
    expect(h["Access-Control-Max-Age"]).toBe("86400");
  });

  it("returns null for a disallowed Origin", () => {
    expect(corsHeaders({ origin: "https://evil.example", host: "h" }, PAGES, true)).toBeNull();
  });
});

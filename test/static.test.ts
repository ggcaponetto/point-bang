import { describe, it, expect } from "vitest";
import path from "node:path";
import { safeResolve, contentTypeFor } from "../lib/static.ts";

const root = path.resolve("/srv/public");

describe("safeResolve", () => {
  it("maps / to index.html", () => {
    expect(safeResolve(root, "/")).toBe(path.join(root, "index.html"));
  });
  it("maps plain files into root", () => {
    expect(safeResolve(root, "/math.js")).toBe(path.join(root, "math.js"));
  });
  it("normalizes leading /../ back inside root (never escapes)", () => {
    // path.normalize clamps "/.." at the root, so these resolve INSIDE
    // public/ and simply 404 — the important property is: never a parent path.
    expect(safeResolve(root, "/../secret.txt")).toBe(path.join(root, "secret.txt"));
    expect(safeResolve(root, "/../../etc/passwd")).toBe(path.join(root, "etc", "passwd"));
  });
  it("blocks slash-less relative traversal", () => {
    expect(safeResolve(root, "../server.ts")).toBeNull();
    expect(safeResolve(root, "..")).toBeNull();
    expect(safeResolve(root, "../public2/x.js")).toBeNull();
  });
});

describe("contentTypeFor", () => {
  it("knows html, js and falls back to text/plain", () => {
    expect(contentTypeFor("a/index.html")).toBe("text/html");
    expect(contentTypeFor("a/math.js")).toBe("text/javascript");
    expect(contentTypeFor("a/readme.md")).toBe("text/plain");
  });
});

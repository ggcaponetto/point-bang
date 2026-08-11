import { describe, it, expect } from "vitest";
import path from "node:path";
import { safeResolve, contentTypeFor, normalizeUrlPath } from "../lib/static.ts";

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

describe("normalizeUrlPath", () => {
  it("maps the empty and root paths to index.html", () => {
    expect(normalizeUrlPath("/")).toBe("/index.html");
    expect(normalizeUrlPath("")).toBe("/index.html");
  });
  it("drops the query string and fragment", () => {
    expect(normalizeUrlPath("/buttons.json?v=2")).toBe("/buttons.json");
    expect(normalizeUrlPath("/math.js#top")).toBe("/math.js");
  });
  it("decodes percent-escapes", () => {
    expect(normalizeUrlPath("/my%20file.js")).toBe("/my file.js");
  });
  it("folds backslashes so Windows and Linux resolve the same file", () => {
    // On Windows "\" is a path separator and on Linux it is a filename byte;
    // without this the same request would reach two different files.
    expect(normalizeUrlPath("/a\\..\\..\\secret")).toBe("/secret");
  });
  it("rejects malformed escapes and embedded null bytes", () => {
    expect(normalizeUrlPath("/%zz")).toBeNull();
    expect(normalizeUrlPath("/a%00b")).toBeNull();
    expect(safeResolve(root, "/%zz")).toBeNull();
  });
});

describe("contentTypeFor", () => {
  it("knows the phone page's file kinds and falls back to text/plain", () => {
    expect(contentTypeFor("a/index.html")).toBe("text/html");
    expect(contentTypeFor("a/math.js")).toBe("text/javascript");
    expect(contentTypeFor("a/buttons.json")).toBe("application/json");
    expect(contentTypeFor("a/style.CSS")).toBe("text/css");
    expect(contentTypeFor("a/readme.md")).toBe("text/plain");
  });
});

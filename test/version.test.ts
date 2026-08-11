import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { VERSION } from "../lib/version.ts";

describe("VERSION", () => {
  it("matches package.json — the executable has no package.json to read", () => {
    const pkg = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json");
    expect(VERSION).toBe(JSON.parse(fs.readFileSync(pkg, "utf8")).version);
  });
});

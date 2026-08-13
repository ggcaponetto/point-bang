import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { diskAssets, seaAssets, PHONE_ASSETS } from "../lib/assets.ts";

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");

describe("diskAssets", () => {
  const src = diskAssets(PUBLIC);

  // PHONE_ASSETS only: editor.html is GENERATED (editor workspace build) and
  // legitimately absent on a fresh clone — the suite must stay green there.
  it("reads the real phone page files", async () => {
    for (const name of PHONE_ASSETS) expect((await src.read(name))?.length).toBeGreaterThan(0);
  });
  it("accepts a leading slash, the shape a request path has", async () => {
    expect((await src.read("/math.js"))?.length).toBeGreaterThan(0);
  });
  it("returns null for missing files instead of throwing", async () => {
    expect(await src.read("nope.js")).toBeNull();
  });
  it("refuses to escape its directory", async () => {
    expect(await src.read("../package.json")).toBeNull();
  });
});

describe("seaAssets", () => {
  const get = (key: string): ArrayBuffer => {
    if (key === "index.html") return new TextEncoder().encode("<page>").buffer as ArrayBuffer;
    throw new Error(`no asset ${key}`); // what sea.getRawAsset does
  };
  const src = seaAssets(get);

  it("reads an embedded file", async () => {
    expect((await src.read("index.html"))?.toString()).toBe("<page>");
  });
  it("strips the leading slash a request path carries", async () => {
    expect((await src.read("/index.html"))?.toString()).toBe("<page>");
  });
  it("serves only the known asset names", async () => {
    expect(await src.read("../../etc/passwd")).toBeNull();
    expect(await src.read("secrets.txt")).toBeNull();
  });
  it("survives a lookup that throws", async () => {
    expect(await src.read("math.js")).toBeNull();
  });
});

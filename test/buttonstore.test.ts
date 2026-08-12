import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createButtonStore } from "../lib/buttonstore.ts";
import type { AssetSource } from "../lib/assets.ts";

const tmpDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "btnstore-"));
const write = (dir: string, name: string, text: string): string => {
  const p = path.join(dir, name);
  fs.writeFileSync(p, text);
  return p;
};

const assetsWith = (text: string | null): AssetSource => ({
  async read(name) {
    return name === "buttons.json" && text !== null ? Buffer.from(text) : null;
  },
});

describe("createButtonStore", () => {
  it("reads the file when present — it wins over the asset copy", async () => {
    const file = write(tmpDir(), "buttons.json", '{"buttons":[]}');
    const store = createButtonStore({ file, explicit: false, assets: assetsWith("ASSET") });
    expect(await store.read()).toEqual({ text: '{"buttons":[]}', problem: null });
  });

  it("implicit missing file falls back to the asset copy silently (SEA first run)", async () => {
    const file = path.join(tmpDir(), "buttons.json"); // never written
    const store = createButtonStore({ file, explicit: false, assets: assetsWith("ASSET") });
    expect(await store.read()).toEqual({ text: "ASSET", problem: null });
  });

  it("explicit unreadable file is a problem, never a fallback", async () => {
    const file = path.join(os.tmpdir(), "nope", "buttons.json");
    const store = createButtonStore({ file, explicit: true, assets: assetsWith("ASSET") });
    const r = await store.read();
    expect(r.text).toBeNull();
    expect(r.problem).toContain("buttons disabled");
  });

  it("explicit non-.json file is refused — --buttons is CLI-controlled", async () => {
    const file = write(tmpDir(), "buttons.txt", '{"buttons":[]}');
    const store = createButtonStore({ file, explicit: true, assets: assetsWith("ASSET") });
    const r = await store.read();
    expect(r.text).toBeNull();
    expect(r.problem).toContain("must be a plain .json file");
  });

  it("no file at all: reads the assets, and write() refuses", async () => {
    const store = createButtonStore({ file: null, explicit: false, assets: assetsWith("ASSET") });
    expect(await store.read()).toEqual({ text: "ASSET", problem: null });
    await expect(store.write("x")).rejects.toThrow("no writable buttons.json location");
  });

  it("nothing anywhere: text null, no problem (buttons simply disabled)", async () => {
    const store = createButtonStore({ file: null, explicit: false, assets: assetsWith(null) });
    expect(await store.read()).toEqual({ text: null, problem: null });
  });

  it("writes atomically: content replaced, temp file gone", async () => {
    const dir = tmpDir();
    const file = write(dir, "buttons.json", "OLD");
    const store = createButtonStore({ file, explicit: false, assets: assetsWith(null) });
    await store.write("NEW");
    expect(fs.readFileSync(file, "utf8")).toBe("NEW");
    expect(fs.existsSync(`${file}.tmp`)).toBe(false);
    expect(await store.read()).toEqual({ text: "NEW", problem: null });
  });

  it("write refuses a non-.json target before touching the filesystem", async () => {
    const file = write(tmpDir(), "buttons.txt", "x");
    const store = createButtonStore({ file, explicit: true, assets: assetsWith(null) });
    await expect(store.write("y")).rejects.toThrow("plain .json");
    expect(fs.readFileSync(file, "utf8")).toBe("x"); // untouched
  });

  it("write surfaces IO failures (missing directory)", async () => {
    const file = path.join(os.tmpdir(), "btnstore-nodir", "sub", "buttons.json");
    const store = createButtonStore({ file, explicit: false, assets: assetsWith(null) });
    await expect(store.write("x")).rejects.toThrow();
  });
});

import { describe, it, expect, vi } from "vitest";
import path from "node:path";
import {
  sidecarAssets,
  nativeCacheDir,
  extractNative,
  loadKoffi,
  ADDON_ASSET,
  KOFFI_ASSET,
  type FsLike,
} from "../lib/native.ts";

function fakeFs(preexisting: Record<string, number> = {}) {
  const sizes = new Map(Object.entries(preexisting));
  const writes: string[] = [];
  const dirs: string[] = [];
  const fs: FsLike = {
    mkdirSync: (d) => void dirs.push(d),
    existsSync: (p) => sizes.has(p),
    statSync: (p) => ({ size: sizes.get(p) ?? 0 }),
    writeFileSync: (p, data) => {
      writes.push(p);
      sizes.set(p, data.length);
    },
  };
  return { fs, writes, dirs };
}

describe("sidecarAssets", () => {
  it("ships the VC++ runtime on Windows and nothing on Linux", () => {
    expect(sidecarAssets("win32")).toContain("vcruntime140.dll");
    expect(sidecarAssets("linux")).toEqual([]);
  });
});

describe("nativeCacheDir", () => {
  it("keys the directory by version, platform and arch", () => {
    expect(nativeCacheDir("1.2.3", "win32", "x64", "/tmp")).toBe(
      path.join("/tmp", "point-bang-native-1.2.3-win32-x64"),
    );
    // An upgraded build must never reuse the previous build's addon.
    expect(nativeCacheDir("1.2.3", "linux", "x64", "/tmp")).not.toBe(
      nativeCacheDir("1.2.4", "linux", "x64", "/tmp"),
    );
  });
});

describe("extractNative", () => {
  const read = (name: string) => Buffer.from(`bytes-of-${name}`);

  it("writes every asset and returns the addon path", () => {
    const { fs, writes, dirs } = fakeFs();
    const out = extractNative("/cache", [ADDON_ASSET, "a.dll"], read, fs);
    expect(dirs).toEqual(["/cache"]);
    expect(writes).toEqual([path.join("/cache", ADDON_ASSET), path.join("/cache", "a.dll")]);
    expect(out).toBe(path.join("/cache", ADDON_ASSET));
  });

  it("extracts the koffi addon under the name the SEA build embeds", () => {
    // build/sea.mjs adds the asset as "koffi.node"; the loader must ask for
    // the same key or the executable's pause hotkey dies at startup.
    const { fs } = fakeFs();
    expect(extractNative("/cache", [KOFFI_ASSET], read, fs)).toBe(
      path.join("/cache", "koffi.node"),
    );
  });

  it("leaves a same-size file alone so relaunches stay cheap", () => {
    const dest = path.join("/cache", ADDON_ASSET);
    const { fs, writes } = fakeFs({ [dest]: read(ADDON_ASSET).length });
    extractNative("/cache", [ADDON_ASSET], read, fs);
    expect(writes).toEqual([]);
  });

  it("rewrites when the cached file has a different size", () => {
    const dest = path.join("/cache", ADDON_ASSET);
    const { fs, writes } = fakeFs({ [dest]: 1 });
    extractNative("/cache", [ADDON_ASSET], read, fs);
    expect(writes).toEqual([dest]);
  });

  it("tolerates a locked file that already exists (Windows holds loaded DLLs)", () => {
    const dest = path.join("/cache", ADDON_ASSET);
    const { fs } = fakeFs({ [dest]: 1 });
    fs.writeFileSync = vi.fn(() => {
      throw new Error("EBUSY");
    });
    expect(() => extractNative("/cache", [ADDON_ASSET], read, fs)).not.toThrow();
  });

  it("still fails when the write fails and there is no usable copy", () => {
    const { fs } = fakeFs();
    fs.writeFileSync = vi.fn(() => {
      throw new Error("ENOSPC");
    });
    expect(() => extractNative("/cache", [ADDON_ASSET], read, fs)).toThrow("ENOSPC");
  });
});

describe("loadKoffi", () => {
  // Loading koffi itself needs no display — only USING it against libX11
  // does — so the real non-SEA path is safe to exercise even on headless CI.
  it("loads the real FFI in a checkout and memoizes it", async () => {
    const ffi = await loadKoffi();
    expect(typeof ffi.load).toBe("function");
    expect(await loadKoffi()).toBe(ffi);
  });
});

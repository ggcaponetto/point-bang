import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

/**
 * Loading the native addons — the two pieces of this project that cannot be
 * pure JavaScript: the libnut input driver and the koffi FFI (which reads
 * global key state for the pause hotkey, see `lib/hotkey`).
 *
 * Two very different situations for each:
 * - **npm checkout**: the package is on disk, so a plain `require` does the
 *   work.
 * - **single executable**: a SEA blob cannot contain a native addon, so the
 *   `.node` (plus the Windows CRT DLLs that sit beside libnut) travels as a
 *   SEA asset, gets written to a per-version cache dir on first run, and is
 *   then handed to `process.dlopen`. libuv opens with
 *   `LOAD_WITH_ALTERED_SEARCH_PATH` on Windows, so the DLLs are found
 *   precisely because they are siblings.
 *
 * @module
 */

/** The slice of the libnut addon this project actually calls. */
export interface LibNut {
  setMouseDelay(ms: number): void;
  setKeyboardDelay(ms: number): void;
  moveMouse(x: number, y: number): void;
  mouseClick(button?: string, double?: boolean): void;
  mouseToggle(down?: string, button?: string): void;
  keyToggle(key: string, down: string, modifier?: string[]): void;
  getScreenSize(): { width: number; height: number };
}

/** Asset key of the addon itself — always extracted first. */
export const ADDON_ASSET = "libnut.node";

/**
 * Files that must land next to the addon before it can be opened. Windows
 * builds of libnut link the VC++ runtime dynamically and ship it alongside;
 * on Linux the addon only needs system X11/XTest libraries, which are not
 * ours to distribute.
 */
export function sidecarAssets(platform: string = process.platform): string[] {
  return platform === "win32"
    ? [
        "msvcp140.dll",
        "vcruntime140.dll",
        "vcruntime140_1.dll",
        "api-ms-win-crt-heap-l1-1-0.dll",
        "api-ms-win-crt-runtime-l1-1-0.dll",
        "api-ms-win-crt-string-l1-1-0.dll",
      ]
    : [];
}

/**
 * Where extracted native files live. Keyed by version+platform+arch so an
 * upgraded executable never reuses the previous build's addon.
 */
export function nativeCacheDir(
  version: string,
  platform: string = process.platform,
  arch: string = process.arch,
  tmp: string = os.tmpdir(),
): string {
  return path.join(tmp, `point-bang-native-${version}-${platform}-${arch}`);
}

/** Minimal filesystem surface used by {@link extractNative}, injectable in tests. */
export interface FsLike {
  mkdirSync(dir: string, opts: { recursive: true }): unknown;
  existsSync(p: string): boolean;
  statSync(p: string): { size: number };
  writeFileSync(p: string, data: Buffer): void;
}

/**
 * Writes `names` into `dir` and returns the path of the first one (the addon).
 *
 * A file of the right size is left alone: relaunches must be cheap, and on
 * Windows a *running* second instance holds an exclusive lock on the loaded
 * DLLs — overwriting would fail for no benefit. A write that fails while the
 * file already exists is likewise tolerated for that reason.
 */
export function extractNative(
  dir: string,
  names: string[],
  read: (name: string) => Buffer,
  fsLike: FsLike = fs,
): string {
  fsLike.mkdirSync(dir, { recursive: true });
  for (const name of names) {
    const dest = path.join(dir, name);
    const data = read(name);
    if (fsLike.existsSync(dest) && fsLike.statSync(dest).size === data.length) continue;
    try {
      fsLike.writeFileSync(dest, data);
    } catch (e) {
      if (!fsLike.existsSync(dest)) throw e; // no usable copy — this is fatal
    }
  }
  return path.join(dir, names[0]);
}

/** Opens an already-extracted `.node` file as a CommonJS module. */
function dlopen<T>(file: string): T {
  const m = { exports: {} as T };
  process.dlopen(m, file);
  return m.exports;
}

let cached: LibNut | null = null;

/**
 * Loads the addon, memoized for the process lifetime.
 *
 * @param version Build identity for the extraction cache dir (SEA only).
 * @throws If the platform has no libnut build, or the addon fails to open —
 * on Linux that usually means X11 and XTest are missing (see the README).
 */
export async function loadLibNut(version = "0"): Promise<LibNut> {
  if (cached) return cached;
  const sea = await import("node:sea");
  if (sea.isSea()) {
    const names = [ADDON_ASSET, ...sidecarAssets()];
    const file = extractNative(nativeCacheDir(version), names, (n) =>
      Buffer.from(sea.getRawAsset(n) as ArrayBuffer),
    );
    cached = dlopen<LibNut>(file);
    return cached;
  }
  // Not bundled: esbuild is told to leave these packages external so this
  // resolves against node_modules at runtime, exactly as in a dev checkout.
  const require = createRequire(import.meta.url);
  cached = require(`@nut-tree-fork/libnut-${process.platform}`) as LibNut;
  return cached;
}

/** Asset key of the koffi FFI addon — used by the pause hotkey. */
export const KOFFI_ASSET = "koffi.node";

/** A function bound through koffi; argument/return typing happens per call site. */
type FfiFunc = (...args: unknown[]) => unknown;

/** A shared library opened by koffi (`user32.dll`, `libX11.so.6`, …). */
interface FfiLib {
  func(...spec: Array<string | string[]>): FfiFunc;
}

/** The slice of koffi this project calls (see `lib/hotkey`). */
export interface Ffi {
  load(path: string): FfiLib;
}

let cachedFfi: Ffi | null = null;

/**
 * Loads the koffi FFI addon, memoized, the same two ways as libnut:
 * `require("koffi")` in a checkout, extract + dlopen inside the single
 * executable. The raw `.node` exposes the very `load`/`func` surface the npm
 * wrapper re-exports, so both paths hand back the same API.
 */
export async function loadKoffi(version = "0"): Promise<Ffi> {
  if (cachedFfi) return cachedFfi;
  const sea = await import("node:sea");
  if (sea.isSea()) {
    // A subdirectory, NOT the shared cache dir: koffi must never sit beside
    // libnut's bundled VC++ runtime DLLs. LOAD_WITH_ALTERED_SEARCH_PATH would
    // satisfy koffi's CRT imports from those older siblings, and koffi —
    // built against a newer MSVC — access-violates on its first call under
    // them (verified crash: exit 0xC0000005 in `point-bang check`).
    const dir = path.join(nativeCacheDir(version), "koffi");
    const file = extractNative(dir, [KOFFI_ASSET], (n) =>
      Buffer.from(sea.getRawAsset(n) as ArrayBuffer),
    );
    cachedFfi = dlopen<Ffi>(file);
    return cachedFfi;
  }
  const require = createRequire(import.meta.url);
  cachedFfi = require("koffi") as Ffi;
  return cachedFfi;
}

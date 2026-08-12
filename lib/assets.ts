import fs from "node:fs/promises";
import { safeResolve } from "./static.ts";

/**
 * Where the phone page comes from.
 *
 * In a checkout it is `public/` on disk; in the single executable those files
 * are SEA assets baked into the binary. Both are read through the same tiny
 * interface so `startServer` never has to care which one it got.
 *
 * @module
 */

/** The files the phone page needs; also the SEA asset key list. */
export const PUBLIC_ASSETS = ["index.html", "math.js", "buttons.json", "transport.js"];

/** A read-only bundle of named files. */
export interface AssetSource {
  /** @returns The file's bytes, or `null` when it isn't part of the bundle. */
  read(name: string): Promise<Buffer | null>;
}

/**
 * Serves files from a directory, refusing anything that escapes it
 * (see {@link safeResolve}).
 */
export function diskAssets(dir: string): AssetSource {
  return {
    async read(name) {
      const file = safeResolve(dir, name);
      if (!file) return null;
      try {
        return await fs.readFile(file);
      } catch {
        return null;
      }
    },
  };
}

/**
 * Serves files baked into the executable.
 * @param get A `sea.getRawAsset`-shaped lookup; it throws for unknown keys.
 */
export function seaAssets(get: (key: string) => ArrayBuffer): AssetSource {
  return {
    async read(name) {
      // Asset keys are flat file names, so strip the leading slash a request
      // path carries. Anything with a directory component cannot be an asset.
      const key = name.replace(/^[/\\]+/, "");
      if (!PUBLIC_ASSETS.includes(key)) return null;
      try {
        return Buffer.from(get(key));
      } catch {
        return null;
      }
    },
  };
}

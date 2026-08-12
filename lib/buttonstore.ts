import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import type { AssetSource } from "./assets.ts";

/**
 * The single source of truth for buttons.json at runtime.
 *
 * One resolved file path is both the live-editor save target and the
 * preferred read source; the {@link AssetSource} copy (public/ on disk or the
 * SEA blob) is the read fallback. `GET /buttons.json` and the PC action map
 * both read THROUGH the store, so the phone and the PC can never disagree
 * about which config is in force — the old `--buttons` behavior (PC map only,
 * phone still served the asset copy) was exactly that disagreement.
 *
 * Write target resolution (see `createButtonStore` callers):
 * - dev checkout: `public/buttons.json` — same file the assets serve.
 * - single executable: `buttons.json` next to the exe (the certs/ pattern);
 *   absent = first run, the baked asset copy serves until the first save.
 * - explicit `--buttons`: that file, and an unreadable one stays a reported
 *   problem instead of silently falling back — the user named it on purpose.
 *
 * @module
 */

/** Result of a store read: config text, or a problem when a named file is unusable. */
interface ButtonStoreRead {
  /** The config text, or null when nothing is readable (problem or missing asset). */
  text: string | null;
  /** Set when an explicit `--buttons` file is unusable — reported, never bypassed. */
  problem: string | null;
}

/** Read/write access to the effective buttons.json. */
export interface ButtonStore {
  /** Save target; null = nowhere writable (injected assets without a file). */
  file: string | null;
  read(): Promise<ButtonStoreRead>;
  /** Atomic write (same-dir temp + rename). Throws on IO failure. */
  write(text: string): Promise<void>;
}

/**
 * The `--buttons` path guard, same rules `loadButtonConfig` enforced: the
 * canonical path must stay inside its stated directory (symlinks pointing
 * elsewhere are path injection) and must be a `.json` file.
 */
const guardedRead = (filePath: string): { text: string | null; problem: string | null } => {
  try {
    const dir = fsSync.realpathSync(path.dirname(filePath));
    const prefix = dir.endsWith(path.sep) ? dir : dir + path.sep;
    const resolved = fsSync.realpathSync(filePath);
    if (!resolved.startsWith(prefix) || path.extname(resolved).toLowerCase() !== ".json") {
      return {
        text: null,
        problem: `buttons config must be a plain .json file, got ${filePath} — buttons disabled`,
      };
    }
    return { text: fsSync.readFileSync(resolved, "utf8"), problem: null };
  } catch (e) {
    return {
      text: null,
      problem: `buttons.json unreadable (${(e as Error).message}) — buttons disabled`,
    };
  }
};

/** Builds the store; see the module doc for how `file`/`explicit` are chosen. */
export function createButtonStore(opts: {
  file: string | null;
  /** True only for a user-named `--buttons` file (no silent asset fallback). */
  explicit: boolean;
  assets: AssetSource;
}): ButtonStore {
  return {
    file: opts.file,
    async read() {
      if (opts.file) {
        const r = guardedRead(opts.file);
        if (r.text !== null) return { text: r.text, problem: null };
        if (opts.explicit) return { text: null, problem: r.problem };
        // implicit default path missing (SEA first run) — the asset copy serves
      }
      const data = await opts.assets.read("buttons.json");
      return { text: data ? data.toString("utf8") : null, problem: null };
    },
    async write(text) {
      if (!opts.file) throw new Error("no writable buttons.json location");
      // Validate the target path BEFORE touching the filesystem, the same
      // shape as the read guard: resolve the real parent directory, re-join
      // the bare basename (kills traversal segments), require the result to
      // stay inside that directory and to be a .json file — a `--buttons`
      // value can never write outside its stated directory.
      const dir = await fs.realpath(path.dirname(opts.file));
      const prefix = dir.endsWith(path.sep) ? dir : dir + path.sep;
      const target = path.join(dir, path.basename(opts.file));
      if (!target.startsWith(prefix) || path.extname(target).toLowerCase() !== ".json")
        throw new Error(`buttons config must be a plain .json file, got ${opts.file}`);
      // Same-dir temp + rename: a crash mid-write can never leave a torn
      // config, and rename on the same volume is atomic on Windows and Linux.
      const tmp = `${target}.tmp`;
      await fs.writeFile(tmp, text, "utf8");
      await fs.rename(tmp, target);
    },
  };
}

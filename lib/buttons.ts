import fs from "node:fs";
import path from "node:path";
import { normalizeButtonRect } from "../public/math.js";
import type { MouseButton, MouseLike } from "./cursor.ts";

/**
 * Configurable button system (protocol v2, additive).
 *
 * The phone renders up to 20 buttons from `public/buttons.json` and sends
 * `{"type":"button","id":"b1","down":true}`. The SAME file maps each id to a
 * PC action here. Actions:
 * - `key:<combo>` — e.g. `key:r`, `key:enter`, `key:ctrl+shift+f`
 * - `mouse:left` | `mouse:right` | `mouse:middle`
 * - `""` — unassigned (button does nothing PC-side)
 *
 * down=true presses, down=false releases — so holds work (autofire, ducking).
 *
 * An optional `rect` per button ({x,y,w,h} in % of the screen) places it on
 * the phone overlay. Only the phone uses it, but a malformed one is reported
 * here at load so a mispositioned button is a log line, not a mystery.
 *
 * @module
 */

/** Everything the server needs from a keyboard; implemented in `lib/input`. */
export interface KeyboardLike {
  pressKeys(keys: string[]): Promise<void>;
  releaseKeys(keys: string[]): Promise<void>;
}

/** A parsed button action: a key combo or a mouse button. */
export type ButtonAction = { kind: "key"; keys: string[] } | { kind: "mouse"; button: MouseButton };

// Names below are libnut's own vocabulary — what `lib/input` hands to
// keyToggle verbatim. Aliases cover the spellings people actually type;
// anything not resolvable here is rejected at config load rather than
// throwing mid-game on the first press.
const KEY_ALIASES: Record<string, string> = {
  ctrl: "control",
  control: "control",
  shift: "shift",
  alt: "alt",
  option: "alt",
  // These are three genuinely different keys to libnut, so keep them apart
  // instead of collapsing everything onto one "super".
  win: "win",
  cmd: "cmd",
  command: "cmd",
  meta: "meta",
  super: "meta",
  enter: "enter",
  return: "return",
  esc: "escape",
  escape: "escape",
  space: "space",
  tab: "tab",
  backspace: "backspace",
  delete: "delete",
  del: "delete",
  insert: "insert",
  ins: "insert",
  up: "up",
  down: "down",
  left: "left",
  right: "right",
  home: "home",
  end: "end",
  pageup: "pageup",
  pgup: "pageup",
  pagedown: "pagedown",
  pgdn: "pagedown",
  capslock: "caps_lock",
  numlock: "num_lock",
  scrolllock: "scroll_lock",
  printscreen: "printscreen",
  menu: "menu",
};

// Punctuation libnut addresses by the character itself. "+" is missing on
// purpose: it is the combo separator.
const PUNCTUATION = new Set(["`", "-", "=", "[", "]", "\\", ";", "'", ",", ".", "/"]);

/**
 * Resolves one user-typed key name to its canonical (libnut) spelling, or
 * null for anything unknown. Shared with the pause hotkey (`lib/hotkey`) so
 * combos everywhere use the same vocabulary.
 */
export function normalizeKey(raw: string): string | null {
  const k = raw.trim().toLowerCase();
  if (KEY_ALIASES[k]) return KEY_ALIASES[k];
  if (/^[a-z0-9]$/.test(k)) return k;
  if (/^f([1-9]|1[0-9]|2[0-4])$/.test(k)) return k;
  if (/^numpad[0-9]$/.test(k)) return `numpad_${k.slice(6)}`;
  if (PUNCTUATION.has(k)) return k;
  return null;
}

/**
 * Parses an action spec like `key:ctrl+shift+f` or `mouse:right`.
 * @returns The parsed action, or `null` for unknown keys/malformed specs.
 */
export function parseAction(spec: string): ButtonAction | null {
  if (spec.startsWith("mouse:")) {
    const button = spec.slice("mouse:".length);
    if (button === "left" || button === "right" || button === "middle")
      return { kind: "mouse", button };
    return null;
  }
  if (spec.startsWith("key:")) {
    const parts = spec.slice("key:".length).split("+");
    const keys: string[] = [];
    for (const part of parts) {
      const k = normalizeKey(part);
      if (!k) return null;
      keys.push(k);
    }
    return keys.length ? { kind: "key", keys } : null;
  }
  return null;
}

interface ButtonDef {
  id: string;
  label: string;
  action: string;
  visible: boolean;
  rect?: unknown;
}

/** Result of loading buttons.json: the id→action map plus any config problems. */
export interface ButtonConfig {
  actions: Map<string, ButtonAction>;
  problems: string[];
}

/**
 * Loads and validates `buttons.json` from disk. Unreadable files or bad
 * actions are reported in `problems`, never thrown — buttons degrade, the gun
 * keeps working.
 *
 * `filePath` comes from the CLI (`--buttons`), so it is canonicalized and
 * pinned to a `.json` file before the read (path-injection guard).
 */
export function loadButtonConfig(filePath: string): ButtonConfig {
  try {
    const resolved = fs.realpathSync(filePath);
    if (path.extname(resolved).toLowerCase() !== ".json") {
      return {
        actions: new Map(),
        problems: [`buttons config must be a .json file, got ${filePath} — buttons disabled`],
      };
    }
    return parseButtonConfig(fs.readFileSync(resolved, "utf8"));
  } catch (e) {
    return {
      actions: new Map(),
      problems: [`buttons.json unreadable (${(e as Error).message}) — buttons disabled`],
    };
  }
}

/**
 * Validates already-read `buttons.json` text — the form the single executable
 * uses, where the config is a SEA asset rather than a file.
 */
export function parseButtonConfig(text: string): ButtonConfig {
  const actions = new Map<string, ButtonAction>();
  const problems: string[] = [];
  let defs: ButtonDef[];
  try {
    defs = JSON.parse(text).buttons ?? [];
  } catch (e) {
    return {
      actions,
      problems: [`buttons.json unreadable (${(e as Error).message}) — buttons disabled`],
    };
  }
  for (const d of defs) {
    if (typeof d.id !== "string" || !d.id) {
      problems.push(`button without id skipped`);
      continue;
    }
    if (d.rect !== undefined && !normalizeButtonRect(d.rect))
      problems.push(`button ${d.id}: bad rect ignored (need {x,y,w,h} in % of the screen)`);
    if (!d.action) continue; // unassigned on purpose
    const action = parseAction(d.action);
    if (!action) {
      problems.push(`button ${d.id}: unknown action "${d.action}"`);
      continue;
    }
    actions.set(d.id, action);
  }
  return { actions, problems };
}

/**
 * Builds the handler that turns `(id, down)` into device input. Key combos
 * press in declared order (modifiers first) and release in reverse.
 * @returns An async executor resolving to `false` when the id has no action.
 */
export function createButtonExecutor(
  actions: Map<string, ButtonAction>,
  mouse: MouseLike,
  keyboard: KeyboardLike,
): (id: string, down: boolean) => Promise<boolean> {
  return async (id, down) => {
    const a = actions.get(id);
    if (!a) return false;
    if (a.kind === "mouse") {
      if (down) await mouse.press(a.button);
      else await mouse.release(a.button);
    } else {
      // press in declared order (modifiers first), release in reverse
      if (down) await keyboard.pressKeys(a.keys);
      else await keyboard.releaseKeys([...a.keys].reverse());
    }
    return true;
  };
}

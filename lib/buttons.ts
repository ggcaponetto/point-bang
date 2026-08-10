import fs from "node:fs";
import type { MouseButton, MouseLike } from "./cursor.ts";

// Button system (protocol v2, additive): the phone renders up to 20 buttons
// from public/buttons.json and sends {"type":"button","id":"b1","down":true}.
// The SAME file maps each id to a PC action here. Actions:
//   "key:<combo>"  e.g. "key:r", "key:enter", "key:ctrl+shift+f"
//   "mouse:left" | "mouse:right" | "mouse:middle"
//   ""             unassigned (button does nothing PC-side)
// down=true presses, down=false releases — so holds work (autofire, ducking).

export interface KeyboardLike {
  pressKeys(keys: string[]): Promise<void>;
  releaseKeys(keys: string[]): Promise<void>;
}

export type ButtonAction = { kind: "key"; keys: string[] } | { kind: "mouse"; button: MouseButton };

// Normalized key names — must match nut-js Key enum members (validated again
// at adapter creation). Aliases cover common spellings.
const KEY_ALIASES: Record<string, string> = {
  ctrl: "LeftControl",
  control: "LeftControl",
  shift: "LeftShift",
  alt: "LeftAlt",
  win: "LeftSuper",
  meta: "LeftSuper",
  super: "LeftSuper",
  cmd: "LeftSuper",
  enter: "Enter",
  return: "Enter",
  esc: "Escape",
  escape: "Escape",
  space: "Space",
  tab: "Tab",
  backspace: "Backspace",
  delete: "Delete",
  del: "Delete",
  up: "Up",
  down: "Down",
  left: "Left",
  right: "Right",
  home: "Home",
  end: "End",
  pageup: "PageUp",
  pagedown: "PageDown",
};

function normalizeKey(raw: string): string | null {
  const k = raw.trim().toLowerCase();
  if (KEY_ALIASES[k]) return KEY_ALIASES[k];
  if (/^[a-z]$/.test(k)) return k.toUpperCase();
  if (/^[0-9]$/.test(k)) return `Num${k}`;
  if (/^f([1-9]|1[0-9]|2[0-4])$/.test(k)) return `F${k.slice(1)}`;
  return null;
}

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
}

export interface ButtonConfig {
  actions: Map<string, ButtonAction>;
  problems: string[];
}

export function loadButtonConfig(filePath: string): ButtonConfig {
  const actions = new Map<string, ButtonAction>();
  const problems: string[] = [];
  let defs: ButtonDef[];
  try {
    defs = JSON.parse(fs.readFileSync(filePath, "utf8")).buttons ?? [];
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

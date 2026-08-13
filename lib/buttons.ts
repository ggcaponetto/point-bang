import { normalizeButtonRect, normalizeEdge, normalizePad, parseAction } from "../public/math.js";
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

// The action vocabulary (normalizeKey, parseAction, the alias tables) lives
// in public/math.js since 2026-08-12 so the button editor page validates
// specs with the exact same code. Re-exported here: lib/hotkey and the tests
// keep their import site, and this module stays the buttons API.
export { normalizeKey, parseAction } from "../public/math.js";

interface ButtonDef {
  id: string;
  label: string;
  action: string;
  visible: boolean;
  rect?: unknown;
  /** Phone-side haptics: absent/true = default tick, false/0 = off, number = ms. */
  vibrate?: unknown;
  /** Phone-side edge gesture: aiming past this screen edge presses the button. */
  edge?: unknown;
  /** Phone-side physical trigger: a gamepad button index, or "any". */
  pad?: unknown;
}

/** Whether a `vibrate` config value is one of the shapes the phone accepts. */
const usableVibrate = (v: unknown): boolean =>
  typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v) && v >= 0);

/** Result of loading buttons.json: the id→action map plus any config problems. */
export interface ButtonConfig {
  actions: Map<string, ButtonAction>;
  problems: string[];
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
  const edgesSeen = new Set<string>();
  for (const d of defs) {
    if (typeof d.id !== "string" || !d.id) {
      problems.push(`button without id skipped`);
      continue;
    }
    problems.push(...defProblems(d, edgesSeen));
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
 * The phone-side config verdicts for one entry (rect, vibrate, edge, pad) —
 * validated at load so a typo shows up at server start instead of silently
 * changing the feel. `edgesSeen` carries the one-button-per-edge rule across
 * entries. Order matters: tests (and the editor's mirror) pin these strings.
 */
function defProblems(d: ButtonDef, edgesSeen: Set<string>): string[] {
  const problems: string[] = [];
  if (d.rect !== undefined && !normalizeButtonRect(d.rect))
    problems.push(`button ${d.id}: bad rect ignored (need {x,y,w,h} in % of the screen)`);
  if (d.vibrate !== undefined && !usableVibrate(d.vibrate))
    problems.push(`button ${d.id}: bad vibrate ignored (need true/false or a pulse in ms)`);
  if (d.edge !== undefined) {
    const edge = normalizeEdge(d.edge);
    if (!edge) problems.push(`button ${d.id}: bad edge ignored (need left/right/top/bottom)`);
    else if (edgesSeen.has(edge)) problems.push(`button ${d.id}: edge ${edge} already assigned`);
    else edgesSeen.add(edge);
  }
  if (d.pad !== undefined && normalizePad(d.pad) === null)
    problems.push(`button ${d.id}: bad pad ignored (need a gamepad button index or "any")`);
  return problems;
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
    } else if (down) {
      // press in declared order (modifiers first)…
      await keyboard.pressKeys(a.keys);
    } else {
      // …release in reverse
      await keyboard.releaseKeys([...a.keys].reverse());
    }
    return true;
  };
}

// Pure logic for the button editor — the typed port of the old
// public/editor.js. Framework-free on purpose: vitest gates it at 90%+,
// the React components stay thin. The problem strings mirror the server's
// save verdicts in lib/buttons.ts BYTE FOR BYTE — both sides pin them in
// tests, so never reword one without the other.

import {
  parseAction,
  normalizeButtonRect,
  normalizeEdge,
  normalizePad,
  normalizeKey,
  listKeys,
} from "../../public/math.js";
import type { Rect, Handle, ButtonsConfig, DecomposedAction } from "./types";

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
/** Snap to whole percent — the shipped config uses integer rects. */
const snap = (v: number) => Math.round(v);

// Same shapes lib/buttons accepts — keep in sync with `usableVibrate` there.
const usableVibrate = (v: unknown) =>
  typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v) && v >= 0);

/** Moves a rect by a % delta, kept fully on screen, snapped to whole percent. */
export function clampRectMove(rect: Rect, dxPct: number, dyPct: number): Rect {
  return {
    ...rect,
    x: snap(clamp(rect.x + dxPct, 0, 100 - rect.w)),
    y: snap(clamp(rect.y + dyPct, 0, 100 - rect.h)),
  };
}

/**
 * Resizes a rect by dragging one corner handle. The dragged edges move, the
 * opposite ones stay put; the rect never leaves the screen or shrinks below
 * `minPct` in either dimension.
 */
export function resizeRect(
  rect: Rect,
  handle: Handle,
  dxPct: number,
  dyPct: number,
  minPct = 4,
): Rect {
  let { x, y, w, h } = rect;
  if (handle.includes("w")) {
    const nx = clamp(x + dxPct, 0, x + w - minPct);
    w = x + w - nx;
    x = nx;
  }
  if (handle.includes("e")) w = clamp(w + dxPct, minPct, 100 - x);
  if (handle.includes("n")) {
    const ny = clamp(y + dyPct, 0, y + h - minPct);
    h = y + h - ny;
    y = ny;
  }
  if (handle.includes("s")) h = clamp(h + dyPct, minPct, 100 - y);
  return { ...rect, x: snap(x), y: snap(y), w: snap(w), h: snap(h) };
}

/** Converts a pointer position to frame-relative percent coordinates. */
export function pointerToPct(
  clientX: number,
  clientY: number,
  frame: { left: number; top: number; width: number; height: number },
): { x: number; y: number } {
  return {
    x: ((clientX - frame.left) / frame.width) * 100,
    y: ((clientY - frame.top) / frame.height) * 100,
  };
}

/**
 * What a pointer at (px,py)% lands on: a corner handle beats the body, the
 * topmost (last-rendered) button beats the ones under it. Buttons without a
 * usable rect never hit. `buttons` is in render order.
 */
export function hitTest(
  buttons: Array<{ id: string; rect: Rect | null }>,
  px: number,
  py: number,
  handlePct = 2,
): { id: string; part: Handle | "body" } | null {
  for (let i = buttons.length - 1; i >= 0; i--) {
    const { id, rect } = buttons[i];
    if (!rect) continue;
    const corners: [Handle, number, number][] = [
      ["nw", rect.x, rect.y],
      ["ne", rect.x + rect.w, rect.y],
      ["sw", rect.x, rect.y + rect.h],
      ["se", rect.x + rect.w, rect.y + rect.h],
    ];
    for (const [part, cx, cy] of corners)
      if (Math.abs(px - cx) <= handlePct && Math.abs(py - cy) <= handlePct) return { id, part };
    if (px >= rect.x && px <= rect.x + rect.w && py >= rect.y && py <= rect.y + rect.h)
      return { id, part: "body" };
  }
  return null;
}

/**
 * Returns a new config with one button patched — the original is untouched,
 * and every key this editor does not understand (the `"//"` doc string,
 * future per-button fields) rides along unchanged. Setting a patch value to
 * `undefined` removes it on serialize (JSON drops undefined).
 */
export function updateButton(
  config: ButtonsConfig,
  id: string,
  patch: Record<string, unknown>,
): ButtonsConfig {
  return {
    ...config,
    buttons: config.buttons.map((b) => (b.id === id ? { ...b, ...patch } : b)),
  };
}

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * A free spot for a newly placed button: scans the screen in coarse steps for
 * the first w×h rect that overlaps none of the existing ones (reading order,
 * top-left first), so repeated "add button" clicks never stack new buttons on
 * top of each other. Falls back to dead center when the screen is full.
 */
export function nextFreeRect(rects: Rect[], w = 20, h = 16): Rect {
  for (let y = 0; y + h <= 100; y += 7) {
    for (let x = 0; x + w <= 100; x += 7) {
      const candidate = { x, y, w, h };
      if (!rects.some((r) => overlaps(candidate, r))) return candidate;
    }
  }
  return { x: 40, y: 42, w, h };
}

/** The per-entry checks behind {@link configProblems}. */
function entryProblems(d: Record<string, unknown>, id: string): string[] {
  const problems: string[] = [];
  if (d.rect !== undefined && !normalizeButtonRect(d.rect))
    problems.push(`button ${id}: bad rect ignored (need {x,y,w,h} in % of the screen)`);
  if (d.vibrate !== undefined && !usableVibrate(d.vibrate))
    problems.push(`button ${id}: bad vibrate ignored (need true/false or a pulse in ms)`);
  if (d.edge !== undefined && !normalizeEdge(d.edge))
    problems.push(`button ${id}: bad edge ignored (need left/right/top/bottom/any)`);
  if (d.pad !== undefined && normalizePad(d.pad) === null)
    problems.push(`button ${id}: bad pad ignored (need a gamepad button index or "any")`);
  if (!d.action) return problems;
  if (typeof d.action !== "string") {
    problems.push(`button ${id}: unknown action ${JSON.stringify(d.action)}`);
  } else if (!parseAction(d.action)) {
    problems.push(`button ${id}: unknown action "${d.action}"`);
  }
  return problems;
}

/**
 * Resets one button to its pristine unused-slot state: no action, hidden,
 * default label, and every optional field (rect/vibrate/edge/pad) removed.
 * The slot itself stays — ids b0..b19 are the fixed vocabulary, so "delete"
 * means "back to factory empty". Unknown per-button fields are dropped on
 * purpose; unknown config-level keys are untouched.
 */
export function resetButton(config: ButtonsConfig, id: string): ButtonsConfig {
  return {
    ...config,
    buttons: config.buttons.map((b) =>
      b.id === id ? { id, label: id.toUpperCase(), action: "", visible: false } : b,
    ),
  };
}

/**
 * Client-side mirror of the server's save verdicts (lib/buttons
 * parseButtonConfig, via the SAME math.js validators) plus a duplicate-id
 * check the server tolerates but a config should not contain. Empty array =
 * the save will be accepted.
 */
export function configProblems(config: unknown): string[] {
  const c = config as { buttons?: unknown } | null;
  if (typeof c !== "object" || !Array.isArray(c?.buttons))
    return ['config must be {"buttons": [...]}'];
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const entry of c.buttons as unknown[]) {
    const d = (entry ?? {}) as Record<string, unknown>;
    if (typeof d.id !== "string" || !d.id) {
      problems.push("button without id skipped");
      continue;
    }
    if (seen.has(d.id)) problems.push(`button ${d.id}: duplicate id`);
    seen.add(d.id);
    problems.push(...entryProblems(d, d.id));
  }
  return problems;
}

// ==================== action builder ====================
// The structured UI composes/decomposes `key:...`/`mouse:...` specs. The
// stored format is untouched — these are pure translations for the form.

/** The four checkbox modifiers, in the fixed order specs are composed in. */
const BUILDER_MODS = ["ctrl", "shift", "alt", "win"];

/**
 * Canonical spelling -> the listKeys INPUT spelling. Built FROM listKeys()
 * so it can never drift from the vocabulary (and it sidesteps the
 * canonical-not-reparseable trap by construction).
 */
const canonicalToSpelling = (): Map<string, string> => {
  const map = new Map<string, string>();
  for (const g of listKeys())
    for (const k of g.keys) {
      const c = normalizeKey(k) as string;
      if (!map.has(c)) map.set(c, k);
    }
  return map;
};

/**
 * Builder state -> action spec. `mods` are checkbox names in any order
 * (composed in the fixed ctrl,shift,alt,win order); `key` is a listKeys
 * spelling or "" for none. Returns "" (unassigned) when there is nothing
 * to press.
 */
export function composeAction(
  kind: "none" | "mouse" | "key",
  mouseBtn: "left" | "right" | "middle",
  mods: string[],
  key: string,
): string {
  if (kind === "mouse") return `mouse:${mouseBtn}`;
  if (kind !== "key") return "";
  const parts = [...BUILDER_MODS.filter((m) => mods.includes(m)), ...(key ? [key] : [])];
  return parts.length ? `key:${parts.join("+")}` : "";
}

/**
 * Sorts a combo's canonical parts into checkbox modifiers + one main key.
 * Null = not representable by the builder: a non-modifier anywhere but last,
 * a repeated modifier, or a canonical with no builder spelling (cmd/meta in
 * a modifier position falls out here — they are main keys to the builder).
 */
function classifyKeyParts(
  canonicals: string[],
  spelling: Map<string, string>,
): { mods: string[]; key: string } | null {
  const modCanon = new Set(["control", "shift", "alt", "win"]);
  const mods: string[] = [];
  let key = "";
  for (let i = 0; i < canonicals.length; i++) {
    const canon = canonicals[i];
    const isMod = modCanon.has(canon);
    if (!isMod && i < canonicals.length - 1) return null; // main key must be last
    if (isMod) {
      const m = spelling.get(canon) as string;
      if (mods.includes(m)) return null;
      mods.push(m);
    } else {
      key = spelling.get(canon) ?? "";
      if (!key) return null;
    }
  }
  return { mods, key };
}

/**
 * Action spec -> builder state, for populating the form from an existing
 * action. `kind: "raw"` marks a spec the 4-checkbox + 1-key builder cannot
 * represent (several main keys, cmd/meta used as a modifier, unknown keys) —
 * the UI falls back to the advanced text row for those. Aliases normalize to
 * builder spellings (`control` -> `ctrl`, `pgup` -> `pageup`); modifier
 * order normalizes on the next edit, the stored string is untouched until
 * the user actually changes something.
 */
export function decomposeAction(spec: string | undefined): DecomposedAction {
  if (!spec) return { kind: "none" };
  const parsed = parseAction(spec);
  if (!parsed) return { kind: "raw" };
  if (parsed.kind === "mouse") return { kind: "mouse", button: parsed.button };
  const result = classifyKeyParts(parsed.keys, canonicalToSpelling());
  return result ? { kind: "key", ...result } : { kind: "raw" };
}

/** Vibrate config value -> the feedback form's state. */
export function decomposeVibrate(v: unknown): { mode: "default" | "off" | "custom"; ms: number } {
  if (v === undefined || v === true) return { mode: "default", ms: 10 };
  if (v === false || v === 0) return { mode: "off", ms: 10 };
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return { mode: "custom", ms: v };
  return { mode: "default", ms: 10 };
}

/**
 * Parses the vibrate inspector field: "" = default (absent), "true"/"false",
 * or a pulse in ms. Returns {vibrate: undefined} to delete the key,
 * {vibrate} to set it, null for unusable input.
 */
export function parseVibrateField(text: string): { vibrate?: unknown } | null {
  const t = text.trim().toLowerCase();
  if (t === "") return { vibrate: undefined };
  if (t === "true") return { vibrate: true };
  if (t === "false") return { vibrate: false };
  const n = Number(t);
  if (Number.isFinite(n) && n >= 0) return { vibrate: n };
  return null;
}

/**
 * Parses the gamepad-button inspector field: "" = none (key removed), "any"
 * = every physical button, or a button index. Null for unusable input.
 */
export function parsePadField(text: string): { pad?: unknown } | null {
  const t = text.trim().toLowerCase();
  if (t === "") return { pad: undefined };
  if (t === "any") return { pad: "any" };
  const n = Number(t);
  if (Number.isInteger(n) && n >= 0) return { pad: n };
  return null;
}

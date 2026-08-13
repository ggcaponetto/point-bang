// Pure logic for the button editor page (editor.html). Plain JS ES module on
// purpose, the math.js deal: Chrome loads it directly, vitest imports it for
// tests, JSDoc types are checked by `npm run typecheck`. The DOM glue stays in
// editor.html — everything with behavior worth testing lives here.

import { parseAction, normalizeButtonRect, normalizeEdge, normalizePad } from "./math.js";

/** @typedef {{ x: number, y: number, w: number, h: number }} Rect */
/** @typedef {"nw" | "ne" | "sw" | "se"} Handle */

/** @param {number} v @param {number} lo @param {number} hi */
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
/** Snap to whole percent — the shipped config uses integer rects. @param {number} v */
const snap = (v) => Math.round(v);

// Same shapes lib/buttons accepts — keep in sync with `usableVibrate` there.
/** @param {unknown} v */
const usableVibrate = (v) =>
  typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v) && v >= 0);

/**
 * Moves a rect by a % delta, kept fully on screen, snapped to whole percent.
 * @param {Rect} rect @param {number} dxPct @param {number} dyPct
 * @returns {Rect}
 */
export function clampRectMove(rect, dxPct, dyPct) {
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
 * @param {Rect} rect @param {Handle} handle @param {number} dxPct @param {number} dyPct
 * @param {number} [minPct]
 * @returns {Rect}
 */
export function resizeRect(rect, handle, dxPct, dyPct, minPct = 4) {
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

/**
 * Converts a pointer position to frame-relative percent coordinates.
 * @param {number} clientX @param {number} clientY
 * @param {{ left: number, top: number, width: number, height: number }} frame
 * @returns {{ x: number, y: number }}
 */
export function pointerToPct(clientX, clientY, frame) {
  return {
    x: ((clientX - frame.left) / frame.width) * 100,
    y: ((clientY - frame.top) / frame.height) * 100,
  };
}

/**
 * What a pointer at (px,py)% lands on: a corner handle beats the body, the
 * topmost (last-rendered) button beats the ones under it. Buttons without a
 * usable rect never hit.
 * @param {Array<{ id: string, rect: Rect | null }>} buttons in render order
 * @param {number} px @param {number} py @param {number} [handlePct] grab radius
 * @returns {{ id: string, part: Handle | "body" } | null}
 */
export function hitTest(buttons, px, py, handlePct = 2) {
  for (let i = buttons.length - 1; i >= 0; i--) {
    const { id, rect } = buttons[i];
    if (!rect) continue;
    /** @type {[Handle, number, number][]} */
    const corners = [
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
 * @param {{ buttons: Array<Record<string, unknown>> }} config
 * @param {string} id @param {Record<string, unknown>} patch
 */
export function updateButton(config, id, patch) {
  return {
    ...config,
    buttons: config.buttons.map((b) => (b.id === id ? { ...b, ...patch } : b)),
  };
}

/** @param {Rect} a @param {Rect} b */
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * A free spot for a newly placed button: scans the screen in coarse steps for
 * the first w×h rect that overlaps none of the existing ones (reading order,
 * top-left first), so repeated "add button" clicks never stack new buttons on
 * top of each other. Falls back to dead center when the screen is full.
 * @param {Rect[]} rects existing button rects
 * @param {number} [w] @param {number} [h]
 * @returns {Rect}
 */
export function nextFreeRect(rects, w = 20, h = 16) {
  for (let y = 0; y + h <= 100; y += 7) {
    for (let x = 0; x + w <= 100; x += 7) {
      const candidate = { x, y, w, h };
      if (!rects.some((r) => overlaps(candidate, r))) return candidate;
    }
  }
  return { x: 40, y: 42, w, h };
}

/**
 * The per-entry checks behind {@link configProblems}.
 * @param {Record<string, unknown>} d @param {string} id
 * @returns {string[]}
 */
function entryProblems(d, id) {
  const problems = [];
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
 * Client-side mirror of the server's save verdicts (lib/buttons
 * parseButtonConfig, via the SAME math.js validators) plus a duplicate-id
 * check the server tolerates but a config should not contain. Empty array =
 * the save will be accepted.
 * @param {unknown} config
 * @returns {string[]}
 */
export function configProblems(config) {
  const c = /** @type {{ buttons?: unknown } | null} */ (config);
  if (typeof c !== "object" || !Array.isArray(c?.buttons))
    return ['config must be {"buttons": [...]}'];
  const problems = [];
  const seen = new Set();
  for (const entry of /** @type {unknown[]} */ (c.buttons)) {
    const d = /** @type {Record<string, unknown>} */ (entry ?? {});
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

/**
 * Parses the vibrate inspector field: "" = default (absent), "true"/"false",
 * or a pulse in ms. Returns {} to delete the key, {vibrate} to set it, null
 * for unusable input.
 * @param {string} text
 * @returns {{ vibrate?: unknown } | null}
 */
export function parseVibrateField(text) {
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
 * @param {string} text
 * @returns {{ pad?: unknown } | null}
 */
export function parsePadField(text) {
  const t = text.trim().toLowerCase();
  if (t === "") return { pad: undefined };
  if (t === "any") return { pad: "any" };
  const n = Number(t);
  if (Number.isInteger(n) && n >= 0) return { pad: n };
  return null;
}

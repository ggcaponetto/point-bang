// Pure math for the lightgun phone page. Plain JS ES module on purpose: the
// page must stay buildless (Chrome loads this directly), while vitest imports
// it for tests. Typed via JSDoc, checked by `npm run typecheck`.

/** @typedef {[number, number, number]} Vec3 */
/** @typedef {{ origin: Vec3, right: Vec3, down: Vec3 }} Plane */

export const V = {
  /** @param {Vec3} a @param {Vec3} b @returns {Vec3} */
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  /** @param {Vec3} a @param {Vec3} b @returns {Vec3} */
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  /** @param {Vec3} a @param {number} s @returns {Vec3} */
  scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  /** @param {Vec3} a @param {Vec3} b */
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  /** @param {Vec3} a @param {Vec3} b @returns {Vec3} */
  cross: (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ],
  /** @param {Vec3} a */
  len: (a) => Math.hypot(a[0], a[1], a[2]),
};

/**
 * Phone camera looks along -Z of its pose.
 * @param {{ x: number, y: number, z: number, w: number }} q
 * @returns {Vec3}
 */
export function forwardFromQuat(q) {
  return [
    -2 * (q.x * q.z + q.w * q.y),
    -2 * (q.y * q.z - q.w * q.x),
    -(1 - 2 * (q.x * q.x + q.y * q.y)),
  ];
}

/**
 * Closest point between two rays (midpoint of the shortest segment).
 * Returns null when rays are near-parallel: capture positions too similar.
 * @param {Vec3} p1 @param {Vec3} d1 @param {Vec3} p2 @param {Vec3} d2
 * @returns {{ point: Vec3, gap: number } | null}
 */
export function closestPointTwoRays(p1, d1, p2, d2) {
  const r = V.sub(p1, p2);
  const a = V.dot(d1, d1),
    b = V.dot(d1, d2),
    c = V.dot(d2, d2);
  const d = V.dot(d1, r),
    e = V.dot(d2, r);
  const den = a * c - b * b;
  if (Math.abs(den) < 1e-8) return null;
  const t1 = (b * e - c * d) / den,
    t2 = (a * e - b * d) / den;
  const q1 = V.add(p1, V.scale(d1, t1)),
    q2 = V.add(p2, V.scale(d2, t2));
  return { point: V.scale(V.add(q1, q2), 0.5), gap: V.len(V.sub(q1, q2)) };
}

/**
 * Screen plane from the three calibrated corners (TL, TR, BL).
 * @param {Vec3} tl @param {Vec3} tr @param {Vec3} bl
 * @returns {Plane}
 */
export function planeFromCorners(tl, tr, bl) {
  return { origin: tl, right: V.sub(tr, tl), down: V.sub(bl, tl) };
}

/**
 * Measured aspect ratio |right|/|down| — sanity check against the monitor's
 * real aspect (green if within 8%).
 * @param {Vec3} tl @param {Vec3} tr @param {Vec3} bl
 */
export function aspectFromCorners(tl, tr, bl) {
  return V.len(V.sub(tr, tl)) / V.len(V.sub(bl, tl));
}

/**
 * Aim ray -> plane -> normalized screen coords plus the ray distance `t`
 * (in ray-direction lengths — comparable across planes for the SAME ray,
 * which is all nearest-plane picking needs). u,v are NOT clamped: values
 * outside 0..1 are sent on purpose (off-screen reload gesture).
 * Returns null when aiming away from or parallel to the screen plane.
 * @param {Plane} plane @param {Vec3} pos @param {Vec3} dir
 * @returns {{ u: number, v: number, t: number } | null}
 */
export function intersectUVT(plane, pos, dir) {
  const n = V.cross(plane.right, plane.down);
  const denom = V.dot(dir, n);
  if (Math.abs(denom) <= 1e-6) return null;
  const t = V.dot(V.sub(plane.origin, pos), n) / denom;
  if (t <= 0) return null;
  const hit = V.add(pos, V.scale(dir, t));
  const rel = V.sub(hit, plane.origin);
  return {
    u: V.dot(rel, plane.right) / V.dot(plane.right, plane.right),
    v: V.dot(rel, plane.down) / V.dot(plane.down, plane.down),
    t,
  };
}

/**
 * Single-plane form of {@link intersectUVT} — the original public shape.
 * @param {Plane} plane @param {Vec3} pos @param {Vec3} dir
 * @returns {{ u: number, v: number } | null}
 */
export function intersectUV(plane, pos, dir) {
  const r = intersectUVT(plane, pos, dir);
  return r ? { u: r.u, v: r.v } : null;
}

/**
 * Picks which calibrated monitor plane the aim ray hits: among planes whose
 * intersection lands inside [0..1]² the NEAREST (smallest t) wins — with
 * per-monitor calibration the planes are physically separate surfaces
 * (bezels, angled monitors), so proximity along the ray is the tiebreak.
 * Returns null when no plane is hit inside its bounds; the caller keeps the
 * last-active monitor for off-screen (reload-gesture) values.
 *
 * Sparse/uncalibrated entries in `planes` are skipped, so the array can be
 * indexed by monitor while calibration is still in progress.
 * @param {Array<Plane | null>} planes @param {Vec3} pos @param {Vec3} dir
 * @returns {{ m: number, u: number, v: number } | null} `m` is 1-based.
 */
export function pickPlaneUV(planes, pos, dir) {
  /** @type {{ m: number, u: number, v: number } | null} */
  let best = null;
  let bestT = Infinity;
  for (let i = 0; i < planes.length; i++) {
    const plane = planes[i];
    if (!plane) continue;
    const hit = intersectUVT(plane, pos, dir);
    if (!hit || hit.u < 0 || hit.u > 1 || hit.v < 0 || hit.v > 1) continue;
    if (hit.t < bestT) {
      bestT = hit.t;
      best = { m: i + 1, u: hit.u, v: hit.v };
    }
  }
  return best;
}

/**
 * Reassigns which monitor a calibrated plane belongs to by swapping slots
 * `a`,`b` (0-based) IN PLACE across every parallel per-monitor array the
 * caller keeps (calibs, planes, filters, offsets — the aim `m` tag is just
 * index+1, so swapping the entries swaps the mapping; the server needs no
 * awareness). `calibs` must be among the swapped arrays: planes are rebuilt
 * from it every frame, so permuting `planes` alone would be undone next frame.
 * Returns the remapped 1-based active monitor. No-op (arrays untouched,
 * `active` returned verbatim) when `a === b` or either index is unusable.
 * @param {unknown[][]} arrays @param {number} a @param {number} b
 * @param {number | null} active
 * @returns {number | null}
 */
export function swapMonitorSlots(arrays, a, b, active) {
  const len = arrays[0]?.length ?? 0;
  const bad = (/** @type {number} */ i) => !Number.isInteger(i) || i < 0 || i >= len;
  if (a === b || bad(a) || bad(b)) return active;
  for (const arr of arrays) {
    const tmp = arr[a];
    arr[a] = arr[b];
    arr[b] = tmp;
  }
  return active === a + 1 ? b + 1 : active === b + 1 ? a + 1 : active;
}

/**
 * Button placement from buttons.json: `rect` is `{x,y,w,h}` in percent of the
 * screen, origin top-left. Returns a copy clamped to stay on screen, or null
 * when the value is not a usable rect (the button falls back to the strip).
 * @param {unknown} rect
 * @returns {{ x: number, y: number, w: number, h: number } | null}
 */
export function normalizeButtonRect(rect) {
  if (typeof rect !== "object" || rect === null) return null;
  const { x, y, w, h } = /** @type {{ x?: unknown, y?: unknown, w?: unknown, h?: unknown }} */ (
    rect
  );
  if (
    typeof x !== "number" ||
    typeof y !== "number" ||
    typeof w !== "number" ||
    typeof h !== "number" ||
    ![x, y, w, h].every(Number.isFinite)
  )
    return null;
  const cx = Math.min(Math.max(x, 0), 100);
  const cy = Math.min(Math.max(y, 0), 100);
  const cw = Math.min(w, 100 - cx);
  const ch = Math.min(h, 100 - cy);
  if (cw <= 0 || ch <= 0) return null;
  return { x: cx, y: cy, w: cw, h: ch };
}

/**
 * Haptic pulse length for a button's `vibrate` config value, in ms.
 * Absent/`true` → the default tick; `false`/`0` → 0 (off); a number → that
 * many ms, clamped to 100 (this is a trigger click, not a phone call).
 * Anything else is unusable → 0, and the SERVER reports it (lib/buttons) so
 * a typo is a log line, not a mystery — same contract as button rects.
 * @param {unknown} v @param {number} [defaultMs]
 * @returns {number} pulse length in ms; 0 = no vibration
 */
export function normalizeVibrate(v, defaultMs = 10) {
  if (v === undefined || v === true) return defaultMs;
  if (v === false) return 0;
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return 0;
  return Math.min(Math.round(v), 100);
}

// ==================== button actions ====================
// Shared vocabulary: the PC executor (lib/buttons) and the button editor page
// validate action specs with the SAME functions, so a combo the editor accepts
// can never be rejected at server load. Moved here from lib/buttons (2026-08-12)
// exactly like normalizeButtonRect/normalizeVibrate before it.

// Names below are libnut's own vocabulary — what `lib/input` hands to
// keyToggle verbatim. Aliases cover the spellings people actually type;
// anything not resolvable here is rejected at config load rather than
// throwing mid-game on the first press.
/** @type {Record<string, string>} */
const KEY_ALIASES = {
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
 * A parsed button action: a key combo or a mouse button.
 * @typedef {{ kind: "key", keys: string[] } | { kind: "mouse", button: "left" | "right" | "middle" }} ButtonAction
 */

/**
 * Resolves one user-typed key name to its canonical (libnut) spelling, or
 * null for anything unknown. Shared with the pause hotkey (`lib/hotkey`) so
 * combos everywhere use the same vocabulary.
 * @param {string} raw
 * @returns {string | null}
 */
export function normalizeKey(raw) {
  const k = raw.trim().toLowerCase();
  if (KEY_ALIASES[k]) return KEY_ALIASES[k];
  if (/^[a-z0-9]$/.test(k)) return k;
  if (/^f([1-9]|1\d|2[0-4])$/.test(k)) return k;
  if (/^numpad\d$/.test(k)) return `numpad_${k.slice(6)}`;
  if (PUNCTUATION.has(k)) return k;
  return null;
}

/**
 * Parses an action spec like `key:ctrl+shift+f` or `mouse:right`.
 * @param {string} spec
 * @returns {ButtonAction | null} The parsed action, or `null` for unknown keys/malformed specs.
 */
export function parseAction(spec) {
  if (spec.startsWith("mouse:")) {
    const button = spec.slice("mouse:".length);
    if (button === "left" || button === "right" || button === "middle")
      return { kind: "mouse", button };
    return null;
  }
  if (spec.startsWith("key:")) {
    const parts = spec.slice("key:".length).split("+");
    /** @type {string[]} */
    const keys = [];
    for (const part of parts) {
      const k = normalizeKey(part);
      if (!k) return null;
      keys.push(k);
    }
    return keys.length ? { kind: "key", keys } : null;
  }
  return null;
}

/**
 * One Euro filter: adaptive low-pass — smooth when slow, responsive when
 * flicking. At-rest lag ≈ 1/(2π·minCutoff) seconds.
 */
export class OneEuro {
  /** @param {number} [minCutoff] @param {number} [beta] @param {number} [dCutoff] */
  constructor(minCutoff = 1.0, beta = 0.05, dCutoff = 1.0) {
    this.mc = minCutoff;
    this.beta = beta;
    this.dc = dCutoff;
    /** @type {number | null} */ this.x = null;
    this.dx = 0;
    /** @type {number | null} */ this.t = null;
  }
  /** @param {number} cut @param {number} dt */
  alpha(cut, dt) {
    const tau = 1 / (2 * Math.PI * cut);
    return 1 / (1 + tau / dt);
  }
  /** @param {number} x @param {number} t timestamp in ms */
  filter(x, t) {
    if (this.t === null || this.x === null) {
      this.t = t;
      this.x = x;
      return x;
    }
    const dt = Math.max((t - this.t) / 1000, 1e-4);
    this.t = t;
    const dxRaw = (x - this.x) / dt;
    const aD = this.alpha(this.dc, dt);
    this.dx = aD * dxRaw + (1 - aD) * this.dx;
    const cut = this.mc + this.beta * Math.abs(this.dx);
    const a = this.alpha(cut, dt);
    this.x = a * x + (1 - a) * this.x;
    return this.x;
  }
  reset() {
    this.x = null;
    this.dx = 0;
    this.t = null;
  }
}

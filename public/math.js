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
 * Aim ray -> plane -> normalized screen coords. u,v are NOT clamped: values
 * outside 0..1 are sent on purpose (future off-screen reload gesture).
 * Returns null when aiming away from or parallel to the screen plane.
 * @param {Plane} plane @param {Vec3} pos @param {Vec3} dir
 * @returns {{ u: number, v: number } | null}
 */
export function intersectUV(plane, pos, dir) {
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
  };
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

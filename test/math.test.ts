import { describe, it, expect } from "vitest";
import {
  V,
  forwardFromQuat,
  closestPointTwoRays,
  planeFromCorners,
  aspectFromCorners,
  intersectUV,
  intersectUVT,
  pickPlaneUV,
  swapMonitorSlots,
  normalizeButtonRect,
  normalizeVibrate,
  normalizeEdge,
  normalizePad,
  EdgeGesture,
  diffPressed,
  OneEuro,
} from "../public/math.js";

const close = (a: number[], b: number[], eps = 1e-9) =>
  a.forEach((x, i) => expect(x).toBeCloseTo(b[i], eps < 1e-6 ? 9 : 5));

describe("V (vec3)", () => {
  it("sub/add/scale", () => {
    close(V.sub([3, 2, 1], [1, 1, 1]), [2, 1, 0]);
    close(V.add([1, 2, 3], [4, 5, 6]), [5, 7, 9]);
    close(V.scale([1, -2, 3], 2), [2, -4, 6]);
  });
  it("dot/cross/len", () => {
    expect(V.dot([1, 2, 3], [4, 5, 6])).toBe(32);
    close(V.cross([1, 0, 0], [0, 1, 0]), [0, 0, 1]);
    expect(V.len([3, 4, 0])).toBe(5);
  });
});

describe("forwardFromQuat", () => {
  it("identity quat looks along -Z", () => {
    close(forwardFromQuat({ x: 0, y: 0, z: 0, w: 1 }), [0, 0, -1]);
  });
  it("90° yaw about Y rotates forward to -X", () => {
    const s = Math.SQRT1_2;
    close(forwardFromQuat({ x: 0, y: s, z: 0, w: s }), [-1, 0, 0]);
  });
  it("90° pitch up about X rotates forward to +Y", () => {
    const s = Math.SQRT1_2;
    close(forwardFromQuat({ x: s, y: 0, z: 0, w: s }), [0, 1, 0]);
  });
});

describe("closestPointTwoRays", () => {
  it("finds an exact intersection with zero gap", () => {
    const res = closestPointTwoRays([0, 0, 0], [1, 0, 0], [5, 5, 0], [0, -1, 0])!;
    close(res.point, [5, 0, 0]);
    expect(res.gap).toBeCloseTo(0, 9);
  });
  it("returns midpoint and gap for skew rays", () => {
    const res = closestPointTwoRays([0, 0, 0], [1, 0, 0], [5, 5, 1], [0, -1, 0])!;
    close(res.point, [5, 0, 0.5]);
    expect(res.gap).toBeCloseTo(1, 9);
  });
  it("rejects near-parallel rays", () => {
    expect(closestPointTwoRays([0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 0, 0])).toBeNull();
  });
  it("works with unnormalized directions", () => {
    const res = closestPointTwoRays([0, 0, 0], [2, 0, 0], [5, 5, 0], [0, -3, 0])!;
    close(res.point, [5, 0, 0]);
  });
});

describe("plane helpers", () => {
  const tl: [number, number, number] = [0, 1, -2];
  const tr: [number, number, number] = [0.4, 1, -2];
  const bl: [number, number, number] = [0, 0.775, -2];

  it("planeFromCorners builds origin/right/down", () => {
    const p = planeFromCorners(tl, tr, bl);
    close(p.origin, tl);
    close(p.right, [0.4, 0, 0]);
    close(p.down, [0, -0.225, 0]);
  });

  it("aspectFromCorners measures |right|/|down|", () => {
    expect(aspectFromCorners(tl, tr, bl)).toBeCloseTo(16 / 9, 9);
  });

  describe("intersectUV", () => {
    const p = planeFromCorners(tl, tr, bl);
    it("maps screen center aim to (0.5, 0.5)", () => {
      const uv = intersectUV(p, [0.2, 0.8875, 0], [0, 0, -1])!;
      expect(uv.u).toBeCloseTo(0.5, 9);
      expect(uv.v).toBeCloseTo(0.5, 9);
    });
    it("maps top-left corner aim to (0, 0)", () => {
      const uv = intersectUV(p, [0, 1, 0], [0, 0, -1])!;
      expect(uv.u).toBeCloseTo(0, 9);
      expect(uv.v).toBeCloseTo(0, 9);
    });
    it("does NOT clamp off-screen aim (future reload gesture)", () => {
      const uv = intersectUV(p, [-0.4, 1, 0], [0, 0, -1])!;
      expect(uv.u).toBeCloseTo(-1, 9);
    });
    it("returns null when aiming away from the plane", () => {
      expect(intersectUV(p, [0.2, 0.9, 0], [0, 0, 1])).toBeNull();
    });
    it("returns null when aiming parallel to the plane", () => {
      expect(intersectUV(p, [0.2, 0.9, 0], [1, 0, 0])).toBeNull();
    });
  });

  describe("intersectUVT", () => {
    it("also reports the ray distance t", () => {
      const p = planeFromCorners(tl, tr, bl);
      const hit = intersectUVT(p, [0.2, 0.8875, 0], [0, 0, -1])!;
      expect(hit.u).toBeCloseTo(0.5, 9);
      expect(hit.v).toBeCloseTo(0.5, 9);
      expect(hit.t).toBeCloseTo(2, 9); // plane at z=-2, unit ray from z=0
    });
  });

  describe("pickPlaneUV", () => {
    // Two side-by-side "monitors" at z=-2 with a physical bezel gap between
    // them (0.4..0.5 has no plane), like the real dual-monitor setup.
    const left = planeFromCorners(tl, tr, bl);
    const right = planeFromCorners([0.5, 1, -2], [0.9, 1, -2], [0.5, 0.775, -2]);

    it("routes aim to the plane it lands inside, 1-based", () => {
      const l = pickPlaneUV([left, right], [0.2, 0.8875, 0], [0, 0, -1])!;
      expect(l).toMatchObject({ m: 1 });
      const r = pickPlaneUV([left, right], [0.7, 0.8875, 0], [0, 0, -1])!;
      expect(r.m).toBe(2);
      expect(r.u).toBeCloseTo(0.5, 9);
      expect(r.v).toBeCloseTo(0.5, 9);
    });

    it("returns null in the bezel gap and off both planes", () => {
      expect(pickPlaneUV([left, right], [0.45, 0.8875, 0], [0, 0, -1])).toBeNull();
      expect(pickPlaneUV([left, right], [5, 5, 0], [0, 0, -1])).toBeNull();
    });

    it("prefers the nearest plane when both are hit (angled monitor in front)", () => {
      // a second surface closer to the viewer, overlapping the left one
      const near = planeFromCorners([0, 1, -1], [0.4, 1, -1], [0, 0.775, -1]);
      const hit = pickPlaneUV([left, near], [0.2, 0.8875, 0], [0, 0, -1])!;
      expect(hit.m).toBe(2);
    });

    it("skips uncalibrated (null) slots while calibration is in progress", () => {
      const hit = pickPlaneUV([null, right], [0.7, 0.8875, 0], [0, 0, -1])!;
      expect(hit.m).toBe(2);
      expect(pickPlaneUV([null, null], [0.2, 0.8875, 0], [0, 0, -1])).toBeNull();
    });
  });
});

describe("swapMonitorSlots", () => {
  // Mirrors the phone's four parallel per-monitor arrays.
  const fresh = () => [
    ["calibA", "calibB", "calibC"],
    ["planeA", "planeB", "planeC"],
    ["filtA", "filtB", "filtC"],
    ["offA", "offB", "offC"],
  ];

  it("swaps slots a,b in every parallel array", () => {
    const arrays = fresh();
    swapMonitorSlots(arrays, 0, 2, null);
    expect(arrays).toEqual([
      ["calibC", "calibB", "calibA"],
      ["planeC", "planeB", "planeA"],
      ["filtC", "filtB", "filtA"],
      ["offC", "offB", "offA"],
    ]);
  });

  it("remaps the active monitor across the swap", () => {
    expect(swapMonitorSlots(fresh(), 0, 1, 1)).toBe(2);
    expect(swapMonitorSlots(fresh(), 0, 1, 2)).toBe(1);
    expect(swapMonitorSlots(fresh(), 0, 1, 3)).toBe(3); // uninvolved slot
    expect(swapMonitorSlots(fresh(), 0, 1, null)).toBeNull(); // nothing aimed yet
  });

  it("is a no-op on a===b or an unusable index", () => {
    for (const [a, b] of [
      [1, 1],
      [-1, 0],
      [0, 3],
      [0.5, 1],
      [NaN, 1],
    ]) {
      const arrays = fresh();
      expect(swapMonitorSlots(arrays, a, b, 2)).toBe(2);
      expect(arrays).toEqual(fresh());
    }
    expect(swapMonitorSlots([], 0, 1, 1)).toBe(1); // no arrays at all
  });
});

describe("normalizeEdge / normalizePad", () => {
  it("canonicalizes edges (incl. any), rejects everything else", () => {
    for (const e of ["left", "right", "top", "bottom", "any"]) expect(normalizeEdge(e)).toBe(e);
    for (const bad of ["up", "LEFT", "ANY", "", 1, null, undefined, {}])
      expect(normalizeEdge(bad)).toBeNull();
  });
  it("accepts a button index or any, rejects everything else", () => {
    expect(normalizePad(0)).toBe(0);
    expect(normalizePad(7)).toBe(7);
    expect(normalizePad("any")).toBe("any");
    for (const bad of [-1, 1.5, "0", "ANY", true, null, undefined])
      expect(normalizePad(bad)).toBeNull();
  });
});

describe("EdgeGesture", () => {
  const uv = (u: number, v: number) => ({ u, v });

  it("fires after the hold, releases the instant aim comes back", () => {
    const g = new EdgeGesture(150, 0.1);
    expect(g.update(uv(0.5, 0.5), 0)).toEqual([]);
    expect(g.update(uv(1.2, 0.5), 10)).toEqual([]); // candidate starts
    expect(g.update(uv(1.25, 0.5), 100)).toEqual([]); // still holding
    expect(g.update(uv(1.2, 0.5), 170)).toEqual([{ edge: "right", down: true }]);
    expect(g.update(uv(1.3, 0.5), 300)).toEqual([]); // held, no repeat
    expect(g.update(uv(0.9, 0.5), 310)).toEqual([{ edge: "right", down: false }]);
  });

  it("does not fire on a brush past the edge shorter than the hold", () => {
    const g = new EdgeGesture(150, 0.1);
    g.update(uv(-0.2, 0.5), 0);
    expect(g.update(uv(0.5, 0.5), 100)).toEqual([]); // back inside before 150ms
    expect(g.update(uv(-0.2, 0.5), 110)).toEqual([]); // timer restarted
    expect(g.update(uv(-0.2, 0.5), 200)).toEqual([]);
    expect(g.update(uv(-0.2, 0.5), 270)).toEqual([{ edge: "left", down: true }]);
  });

  it("stays quiet inside the margin (ordinary edge-of-screen play)", () => {
    const g = new EdgeGesture(150, 0.1);
    for (const [u, v, t] of [
      [1.05, 0.5, 0],
      [-0.1, 0.5, 100],
      [0.5, 1.09, 200],
      [1.05, 0.5, 400],
    ])
      expect(g.update(uv(u, v), t)).toEqual([]);
  });

  it("picks the dominant axis on a corner", () => {
    const g = new EdgeGesture(0, 0.1); // no hold, classification only
    expect(g.update(uv(1.5, 1.2), 0)).toEqual([{ edge: "right", down: true }]);
    const g2 = new EdgeGesture(0, 0.1);
    expect(g2.update(uv(0.5, -0.9), 0)).toEqual([{ edge: "top", down: true }]);
  });

  it("crossing to another edge releases, then re-arms with a fresh hold", () => {
    const g = new EdgeGesture(150, 0.1);
    g.update(uv(1.2, 0.5), 0);
    g.update(uv(1.2, 0.5), 200); // right is down
    expect(g.update(uv(-0.3, 0.5), 210)).toEqual([{ edge: "right", down: false }]);
    expect(g.update(uv(-0.3, 0.5), 300)).toEqual([]); // left still holding
    expect(g.update(uv(-0.3, 0.5), 400)).toEqual([{ edge: "left", down: true }]);
  });

  it("losing aim releases, and flush releases whatever is held", () => {
    const g = new EdgeGesture(150, 0.1);
    g.update(uv(0.5, 1.3), 0);
    g.update(uv(0.5, 1.3), 200); // bottom is down
    expect(g.update(null, 210)).toEqual([{ edge: "bottom", down: false }]);

    const g2 = new EdgeGesture(150, 0.1);
    g2.update(uv(0.5, 1.3), 0);
    g2.update(uv(0.5, 1.3), 200);
    expect(g2.flush()).toEqual([{ edge: "bottom", down: false }]);
    expect(g2.flush()).toEqual([]); // idempotent
  });
});

describe("diffPressed", () => {
  it("emits transitions only, in index order", () => {
    expect(diffPressed([], [])).toEqual([]);
    expect(diffPressed([false, false], [true, false])).toEqual([{ index: 0, down: true }]);
    expect(diffPressed([true, true], [true, false])).toEqual([{ index: 1, down: false }]);
    expect(diffPressed([false, true], [true, false])).toEqual([
      { index: 0, down: true },
      { index: 1, down: false },
    ]);
  });
  it("treats a vanished device's buttons as released (length mismatch)", () => {
    expect(diffPressed([true, true], [])).toEqual([
      { index: 0, down: false },
      { index: 1, down: false },
    ]);
    expect(diffPressed([], [undefined as unknown as boolean, true])).toEqual([
      { index: 1, down: true },
    ]);
  });
});

describe("normalizeVibrate", () => {
  it("absent/true = the default tick, false/0 = off", () => {
    expect(normalizeVibrate(undefined)).toBe(10);
    expect(normalizeVibrate(true)).toBe(10);
    expect(normalizeVibrate(undefined, 7)).toBe(7);
    expect(normalizeVibrate(false)).toBe(0);
    expect(normalizeVibrate(0)).toBe(0);
  });
  it("numbers are ms, rounded and capped — a click, not a phone call", () => {
    expect(normalizeVibrate(5)).toBe(5);
    expect(normalizeVibrate(7.6)).toBe(8);
    expect(normalizeVibrate(250)).toBe(100);
  });
  it("garbage is silent (the server reports it, the phone must not buzz)", () => {
    for (const bad of ["loud", NaN, -5, Infinity, {}, null]) {
      expect(normalizeVibrate(bad)).toBe(0);
    }
  });
});

describe("normalizeButtonRect", () => {
  it("passes a good rect through", () => {
    expect(normalizeButtonRect({ x: 2, y: 30, w: 44, h: 30 })).toEqual({
      x: 2,
      y: 30,
      w: 44,
      h: 30,
    });
  });
  it("clamps a rect back onto the screen", () => {
    expect(normalizeButtonRect({ x: -10, y: 90, w: 50, h: 50 })).toEqual({
      x: 0,
      y: 90,
      w: 50,
      h: 10,
    });
  });
  it("rejects non-objects and missing/non-numeric fields", () => {
    expect(normalizeButtonRect(undefined)).toBeNull();
    expect(normalizeButtonRect(null)).toBeNull();
    expect(normalizeButtonRect("2,30,44,30")).toBeNull();
    expect(normalizeButtonRect({ x: 2, y: 30, w: 44 })).toBeNull();
    expect(normalizeButtonRect({ x: "2", y: 30, w: 44, h: 30 })).toBeNull();
    expect(normalizeButtonRect({ x: NaN, y: 30, w: 44, h: 30 })).toBeNull();
  });
  it("rejects empty and fully off-screen rects", () => {
    expect(normalizeButtonRect({ x: 2, y: 30, w: 0, h: 30 })).toBeNull();
    expect(normalizeButtonRect({ x: 2, y: 30, w: 44, h: -5 })).toBeNull();
    expect(normalizeButtonRect({ x: 100, y: 30, w: 44, h: 30 })).toBeNull();
    expect(normalizeButtonRect({ x: 2, y: 120, w: 44, h: 30 })).toBeNull();
  });
});

describe("OneEuro", () => {
  it("returns the first sample unfiltered", () => {
    expect(new OneEuro().filter(0.7, 0)).toBe(0.7);
  });
  it("converges to a constant input", () => {
    const f = new OneEuro(1, 0, 1);
    let out = f.filter(0, 0);
    for (let t = 16; t < 5000; t += 16) out = f.filter(1, t);
    expect(out).toBeCloseTo(1, 3);
  });
  it("higher minCutoff responds faster (less rest lag)", () => {
    const slow = new OneEuro(1, 0, 1);
    const fast = new OneEuro(6, 0, 1);
    slow.filter(0, 0);
    fast.filter(0, 0);
    let a = 0,
      b = 0;
    for (let t = 16; t <= 160; t += 16) {
      a = slow.filter(1, t);
      b = fast.filter(1, t);
    }
    expect(b).toBeGreaterThan(a);
  });
  it("beta makes fast motion track closer than beta=0", () => {
    const noBeta = new OneEuro(1, 0, 1);
    const withBeta = new OneEuro(1, 0.5, 1);
    noBeta.filter(0, 0);
    withBeta.filter(0, 0);
    let a = 0,
      b = 0;
    for (let t = 16; t <= 96; t += 16) {
      a = noBeta.filter(t / 100, t);
      b = withBeta.filter(t / 100, t);
    }
    expect(Math.abs(b - 0.96)).toBeLessThan(Math.abs(a - 0.96));
  });
  it("clamps non-increasing timestamps instead of dividing by zero", () => {
    const f = new OneEuro();
    f.filter(0, 100);
    expect(Number.isFinite(f.filter(1, 100))).toBe(true);
  });
  it("reset() forgets state", () => {
    const f = new OneEuro();
    f.filter(0.2, 0);
    f.filter(0.4, 16);
    f.reset();
    expect(f.filter(0.9, 32)).toBe(0.9);
  });
});

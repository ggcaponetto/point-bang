/**
 * WebSocket wire protocol between the phone and the PC server.
 *
 * v1 is FROZEN — fields are extended, never changed. `u`,`v` are proportions
 * of the physical screen (origin top-left), `t` is the phone's `Date.now()`,
 * `q` is tracking confidence (1 good / 0.5 limited).
 *
 * @module
 */

interface AimMsg {
  type: "aim";
  u: number;
  v: number;
  t?: number;
  q?: number;
  /** v2 additive: 1-based monitor index (per-monitor calibration). */
  m?: number;
  /**
   * v2 additive: 1 while the phone's multi-monitor calibration is still
   * incomplete — the server must NOT apply this sample (the cursor is parked
   * on the calibration target monitor). Resuming is the absence of the tag,
   * so a lost message can never wedge aim (the DataChannel is unreliable).
   */
  cal?: 1;
}
interface FireMsg {
  type: "fire";
}
interface CalibMsg {
  type: "calib";
  /** `"corner"` = a captured corner; `"target"` (v2 additive) = "about to
   *  capture corners of monitor `m`" — the server parks the cursor there. */
  stage: string;
  i?: number;
  x?: number;
  y?: number;
  z?: number;
  /** v2 additive: 1-based monitor index — `i` stays the corner index. */
  m?: number;
}
interface StateMsg {
  type: "state";
  tracking: "good" | "limited" | "lost";
}
// v2 (additive): configurable buttons, see lib/buttons.ts
interface ButtonMsg {
  type: "button";
  id: string;
  down: boolean;
}

/** Every message a phone client may send, v1 + v2. */
export type ClientMsg = AimMsg | FireMsg | CalibMsg | StateMsg | ButtonMsg;

/**
 * Parses and validates a raw WebSocket payload.
 *
 * @returns The typed message, or `null` for anything that isn't a valid
 * message — the server must never crash on garbage input.
 */
export function parseMessage(raw: string | Buffer): ClientMsg | null {
  let d: unknown;
  try {
    d = JSON.parse(raw.toString());
  } catch {
    return null;
  }
  if (typeof d !== "object" || d === null) return null;
  const m = d as Record<string, unknown>;
  switch (m.type) {
    case "aim":
      if (typeof m.u !== "number" || typeof m.v !== "number") return null;
      // a malformed monitor index is dropped, not the whole sample
      if (m.m !== undefined && (!Number.isInteger(m.m) || (m.m as number) < 1)) delete m.m;
      // same treatment for the calibration tag: only the literal 1 counts
      if (m.cal !== undefined && m.cal !== 1) delete m.cal;
      return m as unknown as AimMsg;
    case "fire":
      return { type: "fire" };
    case "calib":
      if (typeof m.stage !== "string") return null;
      if (m.m !== undefined && (!Number.isInteger(m.m) || (m.m as number) < 1)) delete m.m;
      return m as unknown as CalibMsg;
    case "state":
      if (m.tracking !== "good" && m.tracking !== "limited" && m.tracking !== "lost") return null;
      return m as unknown as StateMsg;
    case "button":
      if (typeof m.id !== "string" || typeof m.down !== "boolean") return null;
      return m as unknown as ButtonMsg;
    default:
      return null;
  }
}

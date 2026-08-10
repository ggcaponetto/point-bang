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
}
interface FireMsg {
  type: "fire";
}
interface CalibMsg {
  type: "calib";
  stage: string;
  i?: number;
  x?: number;
  y?: number;
  z?: number;
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
      return m as unknown as AimMsg;
    case "fire":
      return { type: "fire" };
    case "calib":
      if (typeof m.stage !== "string") return null;
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

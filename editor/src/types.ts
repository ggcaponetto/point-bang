// Shared editor types. Deliberately tolerant: buttons.json is user-owned and
// the contract is "unknown keys ride along unchanged" — the config-level
// "//" doc string and any future per-button field must survive every edit.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Handle = "nw" | "ne" | "sw" | "se";

export type ButtonDef = {
  id: string;
  label?: string;
  action?: string;
  visible?: boolean;
  // loaded JSON is untrusted — narrowing happens through the math.js
  // normalizers, never through the type
  rect?: unknown;
  vibrate?: unknown;
  edge?: unknown;
  pad?: unknown;
} & Record<string, unknown>;

export type ButtonsConfig = { buttons: ButtonDef[] } & Record<string, unknown>;

export type DecomposedAction =
  | { kind: "none" }
  | { kind: "mouse"; button: "left" | "right" | "middle" }
  | { kind: "key"; mods: string[]; key: string }
  | { kind: "raw" };

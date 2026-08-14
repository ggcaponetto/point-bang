import { normalizeKey } from "./buttons.ts";
import type { Ffi } from "./native.ts";

/**
 * The pause hotkey: a PC-side key combination (default `shift+s`) that
 * toggles tracking on and off, so the real mouse can be used mid-session and
 * the gun resumed afterwards — no reconnecting, no recalibrating.
 *
 * Key state is read by **polling snapshots**, not by installing hooks:
 * `GetAsyncKeyState` on Windows, `XQueryKeymap` on X11, and
 * `CGEventSourceKeyState` on macOS — all passive, all global (they see the
 * combo even while a fullscreen game has focus). Nothing is grabbed or
 * swallowed: the focused app still receives the combo, so pick one your game
 * ignores. Combos use the same key vocabulary as buttons.json (`shift+s`,
 * `ctrl+f12`, …), though only keys with stable virtual-key / keysym / kVK
 * mappings are watchable — punctuation is rejected here because its codes
 * are layout-dependent.
 *
 * @module
 */

/** Parses `"shift+s"` into canonical key names; null when any part is unknown. */
export function parseCombo(spec: string): string[] | null {
  const keys: string[] = [];
  for (const part of spec.split("+")) {
    const k = normalizeKey(part);
    if (!k) return null;
    if (!keys.includes(k)) keys.push(k);
  }
  return keys.length ? keys : null;
}

// Windows virtual-key codes. A canonical key may match several physical keys
// (either shift, either win key) — the combo counts if ANY of them is down.
const WIN_VK: Record<string, number[]> = {
  shift: [0x10],
  control: [0x11],
  alt: [0x12],
  win: [0x5b, 0x5c],
  cmd: [0x5b, 0x5c],
  meta: [0x5b, 0x5c],
  space: [0x20],
  enter: [0x0d],
  return: [0x0d],
  tab: [0x09],
  escape: [0x1b],
  backspace: [0x08],
  delete: [0x2e],
  insert: [0x2d],
  home: [0x24],
  end: [0x23],
  pageup: [0x21],
  pagedown: [0x22],
  up: [0x26],
  down: [0x28],
  left: [0x25],
  right: [0x27],
};

function winVks(key: string): number[] | null {
  if (WIN_VK[key]) return WIN_VK[key];
  if (/^[a-z]$/.test(key)) return [0x41 + (key.codePointAt(0) ?? 0) - 97];
  if (/^\d$/.test(key)) return [0x30 + (key.codePointAt(0) ?? 0) - 48];
  const f = /^f([1-9]|1\d|2[0-4])$/.exec(key);
  if (f) return [0x70 + Number(f[1]) - 1];
  const np = /^numpad_(\d)$/.exec(key);
  if (np) return [0x60 + Number(np[1])];
  return null;
}

// X11 keysym names, fed to XStringToKeysym verbatim.
const X_KEYSYM: Record<string, string[]> = {
  shift: ["Shift_L", "Shift_R"],
  control: ["Control_L", "Control_R"],
  alt: ["Alt_L", "Alt_R"],
  win: ["Super_L", "Super_R"],
  cmd: ["Super_L", "Super_R"],
  meta: ["Super_L", "Super_R"],
  space: ["space"],
  enter: ["Return"],
  return: ["Return"],
  tab: ["Tab"],
  escape: ["Escape"],
  backspace: ["BackSpace"],
  delete: ["Delete"],
  insert: ["Insert"],
  home: ["Home"],
  end: ["End"],
  pageup: ["Prior"],
  pagedown: ["Next"],
  up: ["Up"],
  down: ["Down"],
  left: ["Left"],
  right: ["Right"],
};

function xKeysyms(key: string): string[] | null {
  if (X_KEYSYM[key]) return X_KEYSYM[key];
  if (/^[a-z0-9]$/.test(key)) return [key];
  const f = /^f([1-9]|1\d|2[0-4])$/.exec(key);
  if (f) return [`F${f[1]}`];
  const np = /^numpad_(\d)$/.exec(key);
  if (np) return [`KP_${np[1]}`];
  return null;
}

// macOS kVK_* virtual keycodes (Carbon Events.h). Like X keycodes these are
// POSITIONAL — the letter names describe the ANSI layout — which is exactly
// the stable-across-layouts property the watcher needs. Left/right modifier
// pairs both count, mirroring WIN_VK/X_KEYSYM.
const MAC_VK: Record<string, number[]> = {
  shift: [0x38, 0x3c],
  control: [0x3b, 0x3e],
  alt: [0x3a, 0x3d], // Option
  win: [0x37, 0x36], // Command — same win/cmd/meta collapse as the other tables
  cmd: [0x37, 0x36],
  meta: [0x37, 0x36],
  space: [0x31],
  enter: [0x24, 0x4c], // Return + keypad Enter, parity with VK_RETURN covering both
  return: [0x24, 0x4c],
  tab: [0x30],
  escape: [0x35],
  backspace: [0x33], // the Mac "delete" key = PC backspace
  delete: [0x75], // kVK_ForwardDelete
  insert: [0x72], // kVK_Help — the PC Insert position on full-size boards
  home: [0x73],
  end: [0x77],
  pageup: [0x74],
  pagedown: [0x79],
  up: [0x7e],
  down: [0x7d],
  left: [0x7b],
  right: [0x7c],
};

// Non-contiguous on purpose — macOS letter/digit codes follow no arithmetic.
const MAC_LETTER: Record<string, number> = {
  a: 0x00,
  b: 0x0b,
  c: 0x08,
  d: 0x02,
  e: 0x0e,
  f: 0x03,
  g: 0x05,
  h: 0x04,
  i: 0x22,
  j: 0x26,
  k: 0x28,
  l: 0x25,
  m: 0x2e,
  n: 0x2d,
  o: 0x1f,
  p: 0x23,
  q: 0x0c,
  r: 0x0f,
  s: 0x01,
  t: 0x11,
  u: 0x20,
  v: 0x09,
  w: 0x0d,
  x: 0x07,
  y: 0x10,
  z: 0x06,
};
const MAC_DIGIT: Record<string, number> = {
  "1": 0x12,
  "2": 0x13,
  "3": 0x14,
  "4": 0x15,
  "5": 0x17,
  "6": 0x16,
  "7": 0x1a,
  "8": 0x1c,
  "9": 0x19,
  "0": 0x1d,
};
// f1..f20 — f21-f24 do not exist on macOS and are rejected like punctuation.
// prettier-ignore
const MAC_FKEY = [
  0x7a, 0x78, 0x63, 0x76, 0x60, 0x61, 0x62, 0x64, 0x65, 0x6d,
  0x67, 0x6f, 0x69, 0x6b, 0x71, 0x6a, 0x40, 0x4f, 0x50, 0x5a,
];
// numpad_0..9 — note 8/9 skip 0x5a (that's kVK_F20)
// prettier-ignore
const MAC_NUMPAD = [0x52, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5b, 0x5c];

function darwinVks(key: string): number[] | null {
  if (MAC_VK[key]) return MAC_VK[key];
  if (key in MAC_LETTER) return [MAC_LETTER[key]];
  if (key in MAC_DIGIT) return [MAC_DIGIT[key]];
  const f = /^f([1-9]|1\d|20)$/.exec(key);
  if (f) return [MAC_FKEY[Number(f[1]) - 1]];
  const np = /^numpad_(\d)$/.exec(key);
  if (np) return [MAC_NUMPAD[Number(np[1])]];
  return null;
}

/** Answers "is every key of the combo down right now?" — one snapshot per call. */
export interface ComboProbe {
  down(): boolean;
}

/** A probe, or the human-readable reason there is none. */
export type ProbeResult = { probe: ComboProbe; reason: null } | { probe: null; reason: string };

const unavailable = (reason: string): ProbeResult => ({ probe: null, reason });

/** Windows probe: `GetAsyncKeyState` per key, high bit = currently down. */
export function createWin32Probe(ffi: Ffi, keys: string[]): ProbeResult {
  const sets: number[][] = [];
  for (const k of keys) {
    const vks = winVks(k);
    if (!vks) return unavailable(`key "${k}" cannot be watched on Windows`);
    sets.push(vks);
  }
  const user32 = ffi.load("user32.dll");
  const state = user32.func("__stdcall", "GetAsyncKeyState", "int16", ["int"]);
  return {
    probe: {
      down: () => sets.every((vks) => vks.some((vk) => ((state(vk) as number) & 0x8000) !== 0)),
    },
    reason: null,
  };
}

/**
 * X11 probe: one `XQueryKeymap` snapshot (32-byte bitmap of all 256 keycodes)
 * per poll, then bit tests. Unlike libnut, a missing display here is a soft
 * failure — `XOpenDisplay` returns NULL instead of killing the process.
 */
export function createX11Probe(
  ffi: Ffi,
  keys: string[],
  env: Record<string, string | undefined>,
): ProbeResult {
  if (!env.DISPLAY) return unavailable("no DISPLAY (headless session)");
  const x11 = ffi.load("libX11.so.6");
  const openDisplay = x11.func("XOpenDisplay", "void *", ["str"]);
  const stringToKeysym = x11.func("XStringToKeysym", "ulong", ["str"]);
  const keysymToKeycode = x11.func("XKeysymToKeycode", "uint8_t", ["void *", "ulong"]);
  const queryKeymap = x11.func("XQueryKeymap", "int", ["void *", "uint8_t *"]);

  const dpy = openDisplay(null);
  if (!dpy) return unavailable("cannot open the X display");
  const sets: number[][] = [];
  for (const k of keys) {
    const names = xKeysyms(k);
    if (!names) return unavailable(`key "${k}" cannot be watched on X11`);
    const codes: number[] = [];
    for (const name of names) {
      const sym = stringToKeysym(name);
      const code = sym ? (keysymToKeycode(dpy, sym) as number) : 0;
      if (code) codes.push(code);
    }
    if (!codes.length) return unavailable(`key "${k}" is not mapped on this keyboard`);
    sets.push(codes);
  }
  const map = Buffer.alloc(32);
  return {
    probe: {
      down: () => {
        queryKeymap(dpy, map);
        return sets.every((codes) => codes.some((c) => (map[c >> 3] & (1 << (c & 7))) !== 0));
      },
    },
    reason: null,
  };
}

/**
 * macOS probe: `CGEventSourceKeyState` per key against the combined session
 * state (stateID 0) — a passive read, not an event tap, so no Accessibility
 * grant is needed to *poll*. Recent macOS may still require Input Monitoring
 * for non-modifier keys (unverified without hardware — see CLAUDE.md); the
 * failure mode is benign: the probe reads false and the hotkey stays inert,
 * which `check` hints about.
 */
export function createDarwinProbe(ffi: Ffi, keys: string[]): ProbeResult {
  const sets: number[][] = [];
  for (const k of keys) {
    const vks = darwinVks(k);
    if (!vks) return unavailable(`key "${k}" cannot be watched on macOS`);
    sets.push(vks);
  }
  const cg = ffi.load("/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics");
  const state = cg.func("CGEventSourceKeyState", "bool", ["int32", "uint16"]);
  return {
    probe: {
      down: () => sets.every((vks) => vks.some((vk) => state(0, vk) === true)),
    },
    reason: null,
  };
}

/** What {@link createComboProbe} needs from the environment; injectable in tests. */
export interface ProbeDeps {
  ffi: Ffi;
  platform?: string;
  env?: Record<string, string | undefined>;
}

/**
 * Builds the platform's combo probe. Every failure — unsupported platform,
 * unmappable key, missing display, an FFI library that will not load — comes
 * back as a `reason`, never a throw: the hotkey degrades, the gun keeps
 * working.
 */
export function createComboProbe(keys: string[], deps: ProbeDeps): ProbeResult {
  const platform = deps.platform ?? process.platform;
  try {
    if (platform === "win32") return createWin32Probe(deps.ffi, keys);
    if (platform === "linux") return createX11Probe(deps.ffi, keys, deps.env ?? process.env);
    if (platform === "darwin") return createDarwinProbe(deps.ffi, keys);
    return unavailable(`no key watcher for platform "${platform}"`);
  } catch (e) {
    return unavailable((e as Error).message);
  }
}

/** A running combo watcher; `stop()` ends the polling. */
export interface HotkeyWatcher {
  stop(): void;
}

/**
 * Polls the probe and fires `onToggle` once per combo press: on the
 * not-down → all-down edge, and not again until every key was released.
 * A probe that throws mid-run stops the watcher (reported via `onError`)
 * rather than spamming an error per tick.
 */
export function watchCombo(
  probe: ComboProbe,
  onToggle: () => void,
  tickMs = 25,
  onError: (e: Error) => void = () => {},
): HotkeyWatcher {
  let wasDown = false;
  const timer = setInterval(() => {
    let down: boolean;
    try {
      down = probe.down();
    } catch (e) {
      clearInterval(timer);
      onError(e as Error);
      return;
    }
    if (down && !wasDown) onToggle();
    wasDown = down;
  }, tickMs);
  return {
    stop() {
      clearInterval(timer);
    },
  };
}

import { normalizeKey } from "./buttons.ts";
import type { Ffi } from "./native.ts";

/**
 * The pause hotkey: a PC-side key combination (default `shift+space`) that
 * toggles tracking on and off, so the real mouse can be used mid-session and
 * the gun resumed afterwards — no reconnecting, no recalibrating.
 *
 * Key state is read by **polling snapshots**, not by installing hooks:
 * `GetAsyncKeyState` on Windows, `XQueryKeymap` on X11 — both passive, both
 * global (they see the combo even while a fullscreen game has focus). Nothing
 * is grabbed or swallowed: the focused app still receives the combo, so pick
 * one your game ignores. Combos use the same key vocabulary as buttons.json
 * (`shift+space`, `ctrl+f12`, …), though only keys with stable virtual-key /
 * keysym mappings are watchable — punctuation is rejected here because its
 * codes are layout-dependent.
 *
 * @module
 */

/** Parses `"shift+space"` into canonical key names; null when any part is unknown. */
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

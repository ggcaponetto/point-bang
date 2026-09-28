import type { MouseButton, MouseLike } from "./cursor.ts";
import type { KeyboardLike } from "./buttons.ts";
import type { Ffi } from "./native.ts";
import type { MonitorRect } from "./monitors.ts";

/**
 * Input injection on GNOME **Wayland** — the default session of Ubuntu 22.04+
 * and Fedora, where the libnut path silently does nothing.
 *
 * Why libnut cannot work there: it moves the cursor with `XWarpPointer` and
 * clicks with XTEST, both of which only reach Xwayland's PRIVATE pointer. The
 * X server reads the new position back happily, libnut loads, `check` passed —
 * and the compositor, which owns the real cursor, never hears about any of
 * it (verified 2026-09-28 against GNOME 46: X pointer moved, zero Wayland
 * motion events).
 *
 * What works instead is Mutter's own remote-control D-Bus API
 * (`org.gnome.Mutter.RemoteDesktop`, the one gnome-remote-desktop uses): no
 * root, no /dev/uinput rule, no permission dialog, true ABSOLUTE positioning.
 * Absolute motion is addressed relative to a screen-cast stream, so one
 * `RecordArea` stream spanning the desktop is created purely as the
 * coordinate frame — nobody consumes it, so nothing is ever recorded. GNOME
 * shows its sharing indicator in the top bar for as long as we serve.
 *
 * D-Bus is spoken through GLib's GDBus via koffi — the FFI this project
 * already ships — so there is no new dependency and nothing extra for the
 * single executable to carry (libgio is part of every GNOME install).
 *
 * @module
 */

/** True on a Linux Wayland session (where X11 injection cannot move the cursor). */
export function isWayland(
  platform: string = process.platform,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (platform !== "linux") return false;
  return env.XDG_SESSION_TYPE === "wayland" || Boolean(env.WAYLAND_DISPLAY);
}

// X11 keysym VALUES for the buttons.json vocabulary (keysymdef.h). Mutter
// resolves a keysym against the active layout, which is what libnut's
// XKeysymToKeycode did on X11 — so a config behaves the same on both paths.
const KEYSYM: Record<string, number> = {
  shift: 0xffe1,
  control: 0xffe3,
  alt: 0xffe9,
  win: 0xffeb,
  cmd: 0xffeb,
  meta: 0xffeb,
  space: 0x20,
  enter: 0xff0d,
  return: 0xff0d,
  tab: 0xff09,
  escape: 0xff1b,
  backspace: 0xff08,
  delete: 0xffff,
  insert: 0xff63,
  home: 0xff50,
  end: 0xff57,
  pageup: 0xff55,
  pagedown: 0xff56,
  up: 0xff52,
  down: 0xff54,
  left: 0xff51,
  right: 0xff53,
  caps_lock: 0xffe5,
  num_lock: 0xff7f,
  scroll_lock: 0xff14,
  printscreen: 0xff61,
  menu: 0xff67,
};

// evdev codes of the keypad digits 0-9 (linux/input-event-codes.h KEY_KP0…).
// Sent as KEYCODES, unlike everything else: Mutter reaches a keysym by
// pressing whatever level modifiers the layout needs, and KP_7 sits on a
// shifted level — the game would see a spurious Shift around every press
// (observed live). The physical key is also exactly what libnut pressed.
const KEYPAD = [82, 79, 80, 81, 75, 76, 77, 71, 72, 73];

/** How one key travels: by keysym (layout-resolved) or by evdev keycode. */
export interface GnomeKey {
  method: "NotifyKeyboardKeysym" | "NotifyKeyboardKeycode";
  code: number;
}

/** Canonical key name (see `normalizeKey`) → what to send, null when unmapped. */
export function gnomeKey(key: string): GnomeKey | null {
  const sym = (code: number): GnomeKey => ({ method: "NotifyKeyboardKeysym", code });
  if (KEYSYM[key] !== undefined) return sym(KEYSYM[key]);
  // Latin-1 keysyms ARE the character codes: letters, digits, punctuation.
  if (key.length === 1 && key >= " " && key <= "~") return sym(key.codePointAt(0) ?? 0);
  const f = /^f([1-9]|1\d|2[0-4])$/.exec(key);
  if (f) return sym(0xffbe + Number(f[1]) - 1);
  const np = /^numpad_(\d)$/.exec(key);
  if (np) return { method: "NotifyKeyboardKeycode", code: KEYPAD[Number(np[1])] };
  return null;
}

/** A string as a GVariant text-format literal (session ids are random printables). */
export function gvString(s: string): string {
  const escaped = s.replaceAll("\\", "\\\\").replaceAll("'", String.raw`\'`);
  return `'${escaped}'`;
}

// evdev button codes (linux/input-event-codes.h) — what NotifyPointerButton takes.
const BUTTON: Record<MouseButton, number> = { left: 0x110, right: 0x111, middle: 0x112 };

const BUS_SESSION = 2; // G_BUS_TYPE_SESSION
// Never GDBus's 25s default: a wedged compositor must not freeze the server.
const CALL_TIMEOUT_MS = 2000;
const HEALTH_MS = 2000;

const RD = "org.gnome.Mutter.RemoteDesktop";
const SC = "org.gnome.Mutter.ScreenCast";
const DC = "org.gnome.Mutter.DisplayConfig";

type Fn = (...args: unknown[]) => unknown;

/** The GLib/GIO calls in use — every one fixed-arity, no callbacks. */
interface G {
  bus: Fn;
  callSync: Fn;
  callAsync: Fn;
  parse: Fn;
  unref: Fn;
  child: Fn;
  count: Fn;
  str: Fn;
  f64: Fn;
  i32: Fn;
  u32: Fn;
  bool: Fn;
  lookup: Fn;
}

function bind(ffi: Ffi): G {
  const gio = ffi.load("libgio-2.0.so.0");
  const glib = ffi.load("libglib-2.0.so.0");
  const P = "void *";
  // connection, bus name, object path, interface, method, parameters,
  // reply type, flags, timeout, cancellable — shared by both call flavors
  const call = [P, "str", "str", "str", "str", P, P, "int", "int", P];
  return {
    bus: gio.func("g_bus_get_sync", P, ["int", P, P]),
    callSync: gio.func("g_dbus_connection_call_sync", P, [...call, P]),
    callAsync: gio.func("g_dbus_connection_call", "void", [...call, P, P]),
    // a GVariantType* IS a pointer to its type string, hence "str"
    parse: glib.func("g_variant_parse", P, ["str", "str", P, P, P]),
    unref: glib.func("g_variant_unref", "void", [P]),
    child: glib.func("g_variant_get_child_value", P, [P, "ulong"]),
    count: glib.func("g_variant_n_children", "ulong", [P]),
    str: glib.func("g_variant_get_string", "str", [P, P]),
    f64: glib.func("g_variant_get_double", "double", [P]),
    i32: glib.func("g_variant_get_int32", "int", [P]),
    u32: glib.func("g_variant_get_uint32", "uint", [P]),
    bool: glib.func("g_variant_get_boolean", "int", [P]),
    lookup: glib.func("g_variant_lookup_value", P, [P, "str", P]),
  };
}

/** Where a D-Bus method lives. */
interface Target {
  name: string;
  path: string;
  iface: string;
}

/**
 * One method call. `wait` = block for the reply (null when the call failed;
 * the caller owns and unrefs a non-null reply). Without `wait` the message is
 * queued with no reply expected — the aim path, which must never block.
 */
function invoke(
  g: G,
  conn: unknown,
  t: Target,
  method: string,
  args: { sig: string; text: string } | null,
  wait: boolean,
): unknown {
  const params = args ? g.parse(args.sig, args.text, null, null, null) : null;
  if (args && !params) throw new Error(`unparseable ${args.sig} arguments for ${method}`);
  try {
    const head = [conn, t.name, t.path, t.iface, method, params, null, 0, CALL_TIMEOUT_MS, null];
    if (wait) return g.callSync(...head, null);
    g.callAsync(...head, null, null);
    return null;
  } finally {
    // g_variant_parse hands back a full reference; the message took its own
    if (params) g.unref(params);
  }
}

/** Child/lookup navigation that remembers every reference for one `free()`. */
function reader(g: G) {
  const held: unknown[] = [];
  const keep = (v: unknown): unknown => {
    if (v) held.push(v);
    return v;
  };
  return {
    child: (v: unknown, i: number) => keep(g.child(v, i)),
    lookup: (v: unknown, key: string) => keep(g.lookup(v, key, null)),
    count: (v: unknown) => Number(g.count(v)),
    free: () => {
      for (const v of held) g.unref(v);
      held.length = 0;
    },
  };
}

/** The desktop as Mutter lays it out, plus the stream scale (see below). */
interface Stage {
  /** One rect per logical monitor, in stage pixels, Mutter's order. */
  monitors: MonitorRect[];
  w: number;
  h: number;
  /**
   * Stream pixels per stage pixel. With "logical" layout (fractional scaling
   * enabled) the stage is in logical pixels while streams are physical, and
   * an area stream uses the LARGEST scale it touches; with "physical" layout
   * both agree and this is 1. Verified live at 200% in both modes.
   */
  scale: number;
}

const DISPLAY_CONFIG: Target = { name: DC, path: "/org/gnome/Mutter/DisplayConfig", iface: DC };

type Reader = ReturnType<typeof reader>;
type Size = { w: number; h: number };

/** The connector name — first field of a `(ssss)` monitor spec. */
const connectorOf = (g: G, r: Reader, spec: unknown): string =>
  g.str(r.child(spec, 0), null) as string;

/** The mode flagged `is-current` in one monitor's `a(siiddada{sv})` list. */
function currentMode(g: G, r: Reader, list: unknown): Size | null {
  let found: Size | null = null;
  for (let j = 0; j < r.count(list); j++) {
    const mode = r.child(list, j);
    const current = r.lookup(r.child(mode, 6), "is-current");
    if (current && g.bool(current))
      found = { w: g.i32(r.child(mode, 1)) as number, h: g.i32(r.child(mode, 2)) as number };
  }
  return found;
}

/** Connector → current mode, for every monitor that has one. */
function readModes(g: G, r: Reader, physical: unknown): Map<string, Size> {
  const modes = new Map<string, Size>();
  for (let i = 0; i < r.count(physical); i++) {
    const monitor = r.child(physical, i);
    const mode = currentMode(g, r, r.child(monitor, 1));
    if (mode) modes.set(connectorOf(g, r, r.child(monitor, 0)), mode);
  }
  return modes;
}

/**
 * One `(iiduba(ssss)a{sv})` logical monitor as a stage rect plus its scale;
 * null when it shows nothing we know a mode for.
 */
function readLogicalMonitor(
  g: G,
  r: Reader,
  lm: unknown,
  modes: Map<string, Size>,
  logical: boolean,
): { rect: MonitorRect; scale: number } | null {
  const members = r.child(lm, 5);
  if (!r.count(members)) return null;
  const label = connectorOf(g, r, r.child(members, 0));
  const mode = modes.get(label);
  if (!mode) return null;
  const scale = g.f64(r.child(lm, 2)) as number;
  // transforms 1/3/5/7 are the quarter turns: width and height trade places
  const turned = Number(g.u32(r.child(lm, 3))) % 2 === 1;
  const div = logical ? scale : 1;
  return {
    rect: {
      x: g.i32(r.child(lm, 0)) as number,
      y: g.i32(r.child(lm, 1)) as number,
      w: Math.round((turned ? mode.h : mode.w) / div),
      h: Math.round((turned ? mode.w : mode.h) / div),
      primary: Boolean(g.bool(r.child(lm, 4))),
      label,
    },
    scale,
  };
}

/**
 * Reads the stage from `DisplayConfig.GetCurrentState`:
 * `(u serial, a((ssss) a(siiddada{sv}) a{sv}) monitors,
 *   a(iiduba(ssss)a{sv}) logical_monitors, a{sv} properties)`.
 */
function readStage(g: G, conn: unknown): Stage {
  const reply = invoke(g, conn, DISPLAY_CONFIG, "GetCurrentState", null, true);
  if (!reply) throw new Error(`GNOME Shell (${DC}) did not answer`);
  const r = reader(g);
  try {
    const modes = readModes(g, r, r.child(reply, 1));
    const layoutMode = r.lookup(r.child(reply, 3), "layout-mode");
    const logical = Boolean(layoutMode) && Number(g.u32(layoutMode)) === 1;
    const stage: Stage = { monitors: [], w: 0, h: 0, scale: 1 };
    const layout = r.child(reply, 2);
    for (let i = 0; i < r.count(layout); i++) {
      const m = readLogicalMonitor(g, r, r.child(layout, i), modes, logical);
      if (!m) continue;
      stage.monitors.push(m.rect);
      stage.w = Math.max(stage.w, m.rect.x + m.rect.w);
      stage.h = Math.max(stage.h, m.rect.y + m.rect.h);
      if (logical) stage.scale = Math.max(stage.scale, m.scale);
    }
    if (!stage.monitors.length) throw new Error("GNOME reported no active monitor");
    return stage;
  } finally {
    r.free();
    g.unref(reply);
  }
}

function connect(ffi: Ffi): { g: G; conn: unknown } {
  const g = bind(ffi);
  const conn = g.bus(BUS_SESSION, null, null);
  if (!conn) throw new Error("no D-Bus session bus to reach GNOME Shell on");
  return { g, conn };
}

/**
 * The monitors as GNOME lays them out — the SAME pixel space absolute aim is
 * injected in, which is why `lib/monitors` prefers this over xrandr on
 * Wayland: Xwayland's geometry only happens to agree with the stage, and
 * stops agreeing once it renders at native scale.
 * @throws When there is no session bus or GNOME Shell does not answer.
 */
export function detectGnomeMonitors(ffi: Ffi): MonitorRect[] {
  const { g, conn } = connect(ffi);
  return readStage(g, conn).monitors;
}

/** A started remote-control session and the stream that frames absolute aim. */
interface Session {
  rd: Target;
  stream: string;
}

function startSession(g: G, conn: unknown, stage: Stage): Session {
  const r = reader(g);
  const replies: unknown[] = [];
  const ask = (
    t: Target,
    method: string,
    args: { sig: string; text: string } | null,
    what: string,
  ): unknown => {
    const reply = invoke(g, conn, t, method, args, true);
    if (!reply) throw new Error(what);
    replies.push(reply);
    return reply;
  };
  try {
    const created = ask(
      { name: RD, path: "/org/gnome/Mutter/RemoteDesktop", iface: RD },
      "CreateSession",
      null,
      `GNOME's remote-control service (${RD}) is not available`,
    );
    const rd: Target = {
      name: RD,
      path: g.str(r.child(created, 0), null) as string,
      iface: `${RD}.Session`,
    };
    const props = ask(
      { ...rd, iface: "org.freedesktop.DBus.Properties" },
      "GetAll",
      { sig: "(s)", text: `(${gvString(rd.iface)},)` },
      "the remote-control session did not report its properties",
    );
    const id = r.lookup(r.child(props, 0), "SessionId");
    if (!id) throw new Error("the remote-control session has no SessionId");
    const cast = ask(
      { name: SC, path: "/org/gnome/Mutter/ScreenCast", iface: SC },
      "CreateSession",
      {
        sig: "(a{sv})",
        text: `({'remote-desktop-session-id': <${gvString(g.str(id, null) as string)}>},)`,
      },
      `GNOME's screen-cast service (${SC}) is not available — is PipeWire running?`,
    );
    const sc: Target = {
      name: SC,
      path: g.str(r.child(cast, 0), null) as string,
      iface: `${SC}.Session`,
    };
    const area = ask(
      sc,
      "RecordArea",
      { sig: "(iiiia{sv})", text: `(0, 0, ${stage.w}, ${stage.h}, {})` },
      "GNOME refused the desktop-wide coordinate stream (RecordArea)",
    );
    const stream = g.str(r.child(area, 0), null) as string;
    ask(rd, "Start", null, "GNOME refused to start the remote-control session");
    return { rd, stream };
  } finally {
    r.free();
    for (const reply of replies) g.unref(reply);
  }
}

/** The live GNOME devices plus what they measured. */
export interface GnomeInput {
  mouse: MouseLike;
  keyboard: KeyboardLike;
  /** Desktop size in the pixels aim maps into. */
  size: { w: number; h: number };
  /** Ends the session (GNOME's sharing indicator goes away). Never throws. */
  close(): void;
}

/** The devices, or the human-readable reason there are none. */
export type GnomeResult = { input: GnomeInput; reason: null } | { input: null; reason: string };

/** Injection points for {@link openGnomeInput}. */
export interface GnomeDeps {
  ffi: Ffi;
  log?: (line: string) => void;
  now?: () => number;
  /** How often an aim move doubles as a liveness check of the session. */
  healthMs?: number;
}

/**
 * Opens the remote-control session. Every failure — no session bus, not
 * GNOME, a library that will not load — comes back as a `reason`, never a
 * throw, so callers can fall back and explain.
 *
 * Aim moves are fire-and-forget messages (they must never block the 2ms
 * cursor loop on a round trip), which also means a session GNOME has closed
 * fails silently. Hence the liveness check: one move every `healthMs` waits
 * for its reply, and a failure re-creates the session. Button and key events
 * always wait — they are rare, and a lost click is worse than 1ms.
 */
export function openGnomeInput(deps: GnomeDeps): GnomeResult {
  const log = deps.log ?? console.log;
  const now = deps.now ?? Date.now;
  const healthMs = deps.healthMs ?? HEALTH_MS;
  let g: G;
  let conn: unknown;
  let stage: Stage;
  let session: Session;
  try {
    ({ g, conn } = connect(deps.ffi));
    stage = readStage(g, conn);
    session = startSession(g, conn, stage);
  } catch (e) {
    return { input: null, reason: (e as Error).message.split(/\r?\n/)[0] };
  }
  const size = { w: stage.w, h: stage.h };
  let checkedAt = now();
  let lost = false;

  const ask = (method: string, sig: string, text: string): boolean => {
    const reply = invoke(g, conn, session.rd, method, { sig, text }, true);
    if (reply) g.unref(reply);
    return Boolean(reply);
  };
  const revive = (): boolean => {
    try {
      stage = readStage(g, conn);
      session = startSession(g, conn, stage);
    } catch (e) {
      if (!lost) log(`input: GNOME ended the remote-control session (${(e as Error).message})`);
      if (!lost) log("input: the cursor is not moving — retrying every few seconds");
      lost = true;
      return false;
    }
    log(
      lost
        ? "input: GNOME remote-control session re-established"
        : "input: GNOME closed the remote-control session — started a new one",
    );
    lost = false;
    return true;
  };
  // `text` is a thunk: after a revive the stream path is a different one.
  const deliver = (method: string, sig: string, text: () => string): void => {
    if (!lost && ask(method, sig, text())) return;
    if (revive()) ask(method, sig, text());
  };
  const motion = (x: number, y: number) => (): string =>
    `(${gvString(session.stream)}, ${x * stage.scale}, ${y * stage.scale})`;
  const button = (b: MouseButton, down: boolean): void =>
    deliver("NotifyPointerButton", "(ib)", () => `(${BUTTON[b]}, ${down})`);
  const keys = (names: string[], down: boolean): void => {
    for (const name of names) {
      const key = gnomeKey(name);
      if (!key) throw new Error(`key "${name}" cannot be sent on GNOME Wayland`);
      deliver(key.method, "(ub)", () => `(${key.code}, ${down})`);
    }
  };

  const mouse: MouseLike = {
    async setPosition(x, y) {
      const text = motion(x, y);
      if (now() - checkedAt >= healthMs) {
        checkedAt = now();
        deliver("NotifyPointerMotionAbsolute", "(sdd)", text);
      } else if (!lost) {
        const args = { sig: "(sdd)", text: text() };
        invoke(g, conn, session.rd, "NotifyPointerMotionAbsolute", args, false);
      }
    },
    async click() {
      button("left", true);
      button("left", false);
    },
    async press(b) {
      button(b, true);
    },
    async release(b) {
      button(b, false);
    },
    async screenSize() {
      return size;
    },
  };
  const keyboard: KeyboardLike = {
    async pressKeys(names) {
      keys(names, true);
    },
    async releaseKeys(names) {
      keys(names, false);
    },
  };
  return {
    input: {
      mouse,
      keyboard,
      size,
      close() {
        try {
          const reply = invoke(g, conn, session.rd, "Stop", null, true);
          if (reply) g.unref(reply);
        } catch {
          // teardown must never throw — the session dies with the process anyway
        }
      },
    },
    reason: null,
  };
}

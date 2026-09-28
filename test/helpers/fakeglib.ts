import type { Ffi } from "../../lib/native.ts";

/**
 * A fake of the GLib/GDBus surface `lib/gnome` binds through koffi, with a
 * scripted GNOME Shell behind it: DisplayConfig, RemoteDesktop, ScreenCast.
 * Replies have the SHAPES the real services return (verified live against
 * GNOME 46), so the variant navigation is tested at the real child indices.
 * Every reference handed out is counted, so tests can assert nothing leaks.
 */

/** A GVariant stand-in: tuples/arrays are JS arrays, a{sv} is a plain object. */
class V {
  value: unknown;
  constructor(value: unknown) {
    this.value = value;
  }
}

/** One recorded D-Bus method call. */
interface FakeCall {
  path: string;
  iface: string;
  method: string;
  sig: string | null;
  text: string | null;
  /** true = the caller waited for the reply (g_dbus_connection_call_sync). */
  wait: boolean;
}

interface FakeMonitor {
  connector: string;
  /** Current mode, physical pixels. */
  w: number;
  h: number;
  x?: number;
  y?: number;
  scale?: number;
  /** Mutter transform: 1/3/5/7 are the quarter turns. */
  transform?: number;
  primary?: boolean;
  /** Part of the layout? A disabled output has modes but no logical monitor. */
  active?: boolean;
}

export interface FakeWorld {
  /** false = the libraries cannot be loaded at all. */
  libs: boolean;
  /** false = g_bus_get_sync returns NULL. */
  bus: boolean;
  display: boolean;
  remote: boolean;
  cast: boolean;
  area: boolean;
  start: boolean;
  /** false = g_variant_parse returns NULL. */
  parse: boolean;
  /** 1 logical, 2 physical, null = the property is absent. */
  layoutMode: number | null;
  monitors: FakeMonitor[];
  sessionId: string | null;
  /** Set false to play GNOME closing the session under us. */
  alive: boolean;
  sessions: number;
  calls: FakeCall[];
  loaded: string[];
  refs: { taken: number; released: number };
}

const SPEC = (connector: string): string[] => [connector, "vendor", "product", "serial"];

function currentState(w: FakeWorld): V {
  const physical = w.monitors.map((m) => [
    SPEC(m.connector),
    [
      ["640x480@60", 640, 480, 60, 1, [1], {}],
      [`${m.w}x${m.h}@60`, m.w, m.h, 60, 1, [1, 2], { "is-current": true }],
      ["800x600@60", 800, 600, 60, 1, [1], { "is-current": false }],
    ],
    {},
  ]);
  const logical = w.monitors
    .filter((m) => m.active !== false)
    .map((m) => [
      m.x ?? 0,
      m.y ?? 0,
      m.scale ?? 1,
      m.transform ?? 0,
      m.primary ?? false,
      [SPEC(m.connector)],
      {},
    ]);
  const props = w.layoutMode === null ? {} : { "layout-mode": w.layoutMode };
  return new V([1, physical, logical, props]);
}

const REMOTE = "org.gnome.Mutter.RemoteDesktop";
const CAST = "org.gnome.Mutter.ScreenCast";
const sessionPath = (n: number): string => `/org/gnome/Mutter/RemoteDesktop/Session/u${n}`;

/** Replies by `interface.method`; anything else is a call ON the session. */
const SERVICES: Record<string, (w: FakeWorld) => V | null> = {
  "org.gnome.Mutter.DisplayConfig.GetCurrentState": (w) => (w.display ? currentState(w) : null),
  [`${REMOTE}.CreateSession`]: (w) => {
    if (!w.remote) return null;
    w.sessions++;
    w.alive = true;
    return new V([sessionPath(w.sessions)]);
  },
  "org.freedesktop.DBus.Properties.GetAll": (w) =>
    new V([w.sessionId === null ? {} : { SessionId: w.sessionId }]),
  [`${CAST}.CreateSession`]: (w) =>
    w.cast ? new V([`/org/gnome/Mutter/ScreenCast/Session/u${w.sessions}`]) : null,
  [`${CAST}.Session.RecordArea`]: (w) =>
    w.area ? new V([`/org/gnome/Mutter/ScreenCast/Stream/u${w.sessions}`]) : null,
  [`${REMOTE}.Session.Start`]: (w) => (w.start ? new V([]) : null),
};

function answer(w: FakeWorld, c: FakeCall): V | null {
  const service = SERVICES[`${c.iface}.${c.method}`];
  if (service) return service(w);
  // Stop and every Notify*: only the CURRENT, still-open session answers
  if (c.path !== sessionPath(w.sessions) || !w.alive) return null;
  if (c.method === "Stop") w.alive = false;
  return new V([]);
}

/** Builds the fake koffi plus the world it scripts; override any field. */
export function fakeGlib(over: Partial<FakeWorld> = {}): { ffi: Ffi; world: FakeWorld } {
  const world: FakeWorld = {
    libs: true,
    bus: true,
    display: true,
    remote: true,
    cast: true,
    area: true,
    start: true,
    parse: true,
    layoutMode: 2,
    monitors: [{ connector: "eDP-1", w: 1920, h: 1080, primary: true }],
    sessionId: String.raw`it's\weird`,
    alive: false,
    sessions: 0,
    calls: [],
    loaded: [],
    refs: { taken: 0, released: 0 },
    ...over,
  };
  const take = (v: V | null): V | null => {
    if (v) world.refs.taken++;
    return v;
  };
  const val = (v: unknown): unknown => (v as V).value;
  const record = (a: unknown[], wait: boolean): FakeCall => {
    const params = a[5] as V | null;
    const p = (params?.value ?? null) as { sig: string; text: string } | null;
    const call: FakeCall = {
      path: a[2] as string,
      iface: a[3] as string,
      method: a[4] as string,
      sig: p?.sig ?? null,
      text: p?.text ?? null,
      wait,
    };
    world.calls.push(call);
    return call;
  };
  const funcs: Record<string, (...a: unknown[]) => unknown> = {
    g_bus_get_sync: () => (world.bus ? { connection: true } : null),
    g_dbus_connection_call_sync: (...a) => take(answer(world, record(a, true))),
    g_dbus_connection_call: (...a) => {
      answer(world, record(a, false));
    },
    g_variant_parse: (sig, text) => take(world.parse ? new V({ sig, text }) : null),
    g_variant_unref: () => {
      world.refs.released++;
    },
    g_variant_get_child_value: (v, i) => take(new V((val(v) as unknown[])[i as number])),
    g_variant_n_children: (v) => (val(v) as unknown[]).length,
    g_variant_get_string: (v) => val(v),
    g_variant_get_double: (v) => val(v),
    g_variant_get_int32: (v) => val(v),
    g_variant_get_uint32: (v) => val(v),
    g_variant_get_boolean: (v) => (val(v) ? 1 : 0),
    g_variant_lookup_value: (v, key) => {
      const found = (val(v) as Record<string, unknown>)[key as string];
      return take(found === undefined ? null : new V(found));
    },
  };
  const ffi: Ffi = {
    load: (lib) => {
      if (!world.libs) throw new Error(`${lib}: cannot open shared object file\n  at dlopen`);
      world.loaded.push(lib);
      return { func: (...spec) => funcs[spec[0] as string] };
    },
  };
  return { ffi, world };
}

/** The recorded calls as `Method text` lines — compact to assert on. */
export const callLines = (world: FakeWorld): string[] =>
  world.calls.map((c) => (c.text === null ? c.method : `${c.method} ${c.text}`));

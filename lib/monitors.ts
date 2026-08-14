import { execSync } from "node:child_process";
import { loadKoffi, type Ffi } from "./native.ts";
import { VERSION } from "./version.ts";

/**
 * Monitor enumeration: which pixel rectangles exist, so `--monitor` can aim
 * at one of them (or at the bounding box of all of them).
 *
 * libnut only knows the primary screen, so the geometry comes from the
 * sanctioned platform channels: on Windows the koffi FFI already loaded for
 * the pause hotkey (`EnumDisplayDevicesW` + `EnumDisplaySettingsExW` with
 * Buffer out-params — no koffi callbacks, unlike `EnumDisplayMonitors`), on
 * Linux a locale-independent `xrandr --query` shell-out, exactly like
 * `lib/wifi`, and on macOS CoreGraphics through the same koffi (see
 * `detectDarwin` for the units caveat: everything there is POINTS, which is
 * also the space CGEvent injection uses — consistent, just not physical
 * pixels on Retina). Capability absence degrades with a reason, never a
 * crash; the caller decides whether a missing monitor is fatal (see
 * `selectMonitor`).
 *
 * @module
 */

/** One monitor's pixel rectangle. `x`/`y` are signed: on Windows a monitor
 * left of or above the primary has a NEGATIVE origin. */
export interface MonitorRect {
  x: number;
  y: number;
  w: number;
  h: number;
  primary: boolean;
  label: string;
}

/** Detection outcome, ProbeResult-style: an empty list always carries a reason. */
export interface MonitorsReport {
  monitors: MonitorRect[];
  reason: string | null;
}

/** A parsed `--monitor` value. */
export type MonitorChoice =
  { kind: "primary" } | { kind: "all" } | { kind: "index"; index: number };

/** Parses `--monitor`: `primary`, `all`, or a 1-based index. `null` = garbage. */
export function parseMonitorArg(raw: string): MonitorChoice | null {
  const s = raw.trim().toLowerCase();
  if (s === "primary") return { kind: "primary" };
  if (s === "all") return { kind: "all" };
  if (/^\d{1,3}$/.test(s) && Number(s) >= 1) return { kind: "index", index: Number(s) };
  return null;
}

/** The union of every monitor — the virtual desktop `--monitor all` spans. */
export function boundingRect(monitors: MonitorRect[]): MonitorRect {
  const left = Math.min(...monitors.map((m) => m.x));
  const top = Math.min(...monitors.map((m) => m.y));
  const right = Math.max(...monitors.map((m) => m.x + m.w));
  const bottom = Math.max(...monitors.map((m) => m.y + m.h));
  return {
    x: left,
    y: top,
    w: right - left,
    h: bottom - top,
    primary: false,
    label: `all (${monitors.length} monitors)`,
  };
}

/**
 * Resolves a choice against what was detected.
 *
 * `primary` (the default) returns `null` when nothing was detected — the
 * caller degrades to the full primary screen, which is exactly the pre-flag
 * behavior, so the default can never regress anyone (headless CI included).
 * `all` and an explicit index are requests the user typed: honoring them
 * wrongly would move the cursor on a different screen than they aim at, so
 * an unsatisfiable one THROWS with the reason instead of degrading.
 */
export function selectMonitor(report: MonitorsReport, choice: MonitorChoice): MonitorRect | null {
  const { monitors } = report;
  if (choice.kind === "primary") {
    return monitors.find((m) => m.primary) ?? monitors[0] ?? null;
  }
  const problem = report.reason ?? `only ${monitors.length} monitor(s) detected`;
  if (choice.kind === "all") {
    if (monitors.length === 0)
      throw new Error(`--monitor all: ${problem} — run \`point-bang monitors\``);
    return boundingRect(monitors);
  }
  const m = monitors[choice.index - 1];
  if (!m) throw new Error(`--monitor ${choice.index}: ${problem} — run \`point-bang monitors\``);
  return m;
}

// ---------- Linux: xrandr ----------

/**
 * Parses `xrandr --query`. Only lines whose SECOND token is exactly
 * `connected` count — `disconnected` CONTAINS `connected`, so substring
 * matching would list unplugged ports. The geometry is matched anywhere in
 * the line because a rotation token (`left`, `inverted`, …) may sit between
 * it and the mode list; rotated geometry arrives already width/height-swapped.
 * A connected output with no geometry has no active mode (screen is off) and
 * is not part of the desktop.
 */
// Anchored and matched per whitespace token (not scanned across the line):
// an unanchored /(\d+)x…/ re-tries at every offset of long digit runs, which
// is super-linear on hostile input; a full-token match cannot backtrack.
const XRANDR_GEOMETRY = /^(\d+)x(\d+)([+-]\d+)([+-]\d+)$/;

export function parseXrandr(output: string): MonitorRect[] {
  const monitors: MonitorRect[] = [];
  for (const line of output.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 2 || parts[1] !== "connected") continue;
    const geo = parts.map((t) => XRANDR_GEOMETRY.exec(t)).find((g) => g !== null);
    if (!geo) continue;
    monitors.push({
      x: Number(geo[3]),
      y: Number(geo[4]),
      w: Number(geo[1]),
      h: Number(geo[2]),
      primary: parts[2] === "primary",
      label: parts[0],
    });
  }
  return monitors;
}

// ---------- Windows: user32 via koffi ----------
// Struct offsets verified live (koffi against a real 2-monitor setup, one at
// a negative origin) — see test/monitors.test.ts, whose fakes write buffers
// at exactly these offsets, doubling as executable documentation.

const DISPLAY_DEVICE_BYTES = 840; // sizeof(DISPLAY_DEVICEW), written to .cb
const DD_NAME_OFFSET = 4; // WCHAR DeviceName[32]
const DD_FLAGS_OFFSET = 324; // DWORD StateFlags
const DD_ATTACHED = 0x1; // DISPLAY_DEVICE_ATTACHED_TO_DESKTOP
const DD_PRIMARY = 0x4; // DISPLAY_DEVICE_PRIMARY_DEVICE
const DD_MIRRORING = 0x8; // DISPLAY_DEVICE_MIRRORING_DRIVER (pseudo-device)

const DEVMODE_BYTES = 220; // sizeof(DEVMODEW), written to .dmSize
const DM_SIZE_OFFSET = 68; // WORD dmSize
const DM_FIELDS_OFFSET = 72; // DWORD dmFields
const DM_POSITION = 0x20; // dmFields bit: dmPosition is valid
const DM_X_OFFSET = 76; // LONG dmPosition.x — SIGNED (left-of-primary < 0)
const DM_Y_OFFSET = 80; // LONG dmPosition.y
const DM_W_OFFSET = 172; // DWORD dmPelsWidth
const DM_H_OFFSET = 176; // DWORD dmPelsHeight
const ENUM_CURRENT_SETTINGS = 0xffffffff;
const MAX_ADAPTERS = 256; // EnumDisplayDevices terminates itself; this is a backstop

type FfiLib = ReturnType<Ffi["load"]>;

/**
 * DEVMODE reports PHYSICAL pixels, but node.exe starts DPI-unaware, so its
 * `SetCursorPos`/`GetSystemMetrics` are virtualized on scaled displays and
 * the two coordinate systems disagree above 100% scaling. Opting the process
 * into per-monitor-v2 awareness (fallback: system-aware) makes everything
 * physical and self-consistent. Failure is fine — at 100% they agree anyway.
 */
function makeDpiAware(user32: FfiLib): void {
  try {
    const setCtx = user32.func("__stdcall", "SetProcessDpiAwarenessContext", "int", ["intptr"]);
    if (setCtx(-4)) return; // DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2
  } catch {
    // export missing on Windows < 1703 — fall through
  }
  try {
    user32.func("__stdcall", "SetProcessDPIAware", "int", [])();
  } catch {
    // best effort only
  }
}

/** Enumerates active monitors via EnumDisplayDevicesW + EnumDisplaySettingsExW. */
export function detectWin32(ffi: Ffi): MonitorRect[] {
  const user32 = ffi.load("user32.dll");
  makeDpiAware(user32);
  const enumDevices = user32.func("__stdcall", "EnumDisplayDevicesW", "int", [
    "str16",
    "uint32",
    "uint8_t *",
    "uint32",
  ]);
  const enumSettings = user32.func("__stdcall", "EnumDisplaySettingsExW", "int", [
    "str16",
    "uint32",
    "uint8_t *",
    "uint32",
  ]);
  const monitors: MonitorRect[] = [];
  for (let i = 0; i < MAX_ADAPTERS; i++) {
    const dev = Buffer.alloc(DISPLAY_DEVICE_BYTES);
    dev.writeUInt32LE(DISPLAY_DEVICE_BYTES, 0);
    if (!enumDevices(null, i, dev, 0)) break;
    const flags = dev.readUInt32LE(DD_FLAGS_OFFSET);
    if (!(flags & DD_ATTACHED) || flags & DD_MIRRORING) continue;
    const name = dev.toString("utf16le", DD_NAME_OFFSET, DD_NAME_OFFSET + 64).split("\0")[0];
    const mode = Buffer.alloc(DEVMODE_BYTES);
    mode.writeUInt16LE(DEVMODE_BYTES, DM_SIZE_OFFSET);
    // inactive adapters return 0 here — the second liveness filter
    if (!enumSettings(name, ENUM_CURRENT_SETTINGS, mode, 0)) continue;
    if (!(mode.readUInt32LE(DM_FIELDS_OFFSET) & DM_POSITION)) continue;
    monitors.push({
      x: mode.readInt32LE(DM_X_OFFSET),
      y: mode.readInt32LE(DM_Y_OFFSET),
      w: mode.readUInt32LE(DM_W_OFFSET),
      h: mode.readUInt32LE(DM_H_OFFSET),
      primary: (flags & DD_PRIMARY) !== 0,
      label: name,
    });
  }
  return monitors;
}

// ---------- macOS: CoreGraphics via koffi ----------

// dyld resolves frameworks from the shared cache — this path has not existed
// on disk since Big Sur, but dlopen (and therefore koffi's load) still works.
const CORE_GRAPHICS = "/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics";
const MAX_DISPLAYS = 16; // CGGetActiveDisplayList caps its writes at this

/**
 * Enumerates active displays via CGGetActiveDisplayList + CGDisplayBounds.
 *
 * Units: CGDisplayBounds returns POINTS in the global display space (top-left
 * origin, y-down — same handedness as Windows), and libnut's darwin
 * `moveMouse`/`getScreenSize` live in that same space, so every rect here is
 * consistent with injection with no scaling anywhere. On Retina that means
 * e.g. 1512x982, not the physical 3024x1964 — correct, just surprising in
 * the `monitors` listing.
 *
 * CGRect comes back BY VALUE, which needs a registered koffi struct type —
 * the one place the minimal `Ffi` surface grew (`struct`, still no
 * callbacks). The ids buffer is a packed uint32[16] (entry i at byte i*4,
 * LE), the count a single uint32 at offset 0 — the test fake writes at
 * exactly these offsets.
 */
export function detectDarwin(ffi: Ffi): MonitorRect[] {
  if (!ffi.struct) throw new Error("FFI cannot register CGRect (koffi.struct missing)");
  try {
    ffi.struct("CGPoint", { x: "double", y: "double" });
    ffi.struct("CGSize", { width: "double", height: "double" });
    ffi.struct("CGRect", { origin: "CGPoint", size: "CGSize" });
  } catch {
    // koffi type names are process-global and re-registering throws — an
    // earlier call in this process already did the work.
  }
  const cg = ffi.load(CORE_GRAPHICS);
  const list = cg.func("CGGetActiveDisplayList", "int32", ["uint32", "uint8_t *", "uint8_t *"]);
  const bounds = cg.func("CGDisplayBounds", "CGRect", ["uint32"]);
  const mainId = cg.func("CGMainDisplayID", "uint32", []);
  const builtin = cg.func("CGDisplayIsBuiltin", "int32", ["uint32"]);
  const ids = Buffer.alloc(4 * MAX_DISPLAYS);
  const count = Buffer.alloc(4);
  if (list(MAX_DISPLAYS, ids, count) !== 0) return []; // anything but kCGErrorSuccess
  const main = mainId() as number;
  const monitors: MonitorRect[] = [];
  for (let i = 0; i < Math.min(count.readUInt32LE(0), MAX_DISPLAYS); i++) {
    const id = ids.readUInt32LE(i * 4);
    const r = bounds(id) as {
      origin: { x: number; y: number };
      size: { width: number; height: number };
    };
    monitors.push({
      x: Math.round(r.origin.x), // signed: left of/above the main display < 0
      y: Math.round(r.origin.y),
      w: Math.round(r.size.width),
      h: Math.round(r.size.height),
      primary: id === main,
      label: builtin(id) ? "built-in" : `display ${id}`,
    });
  }
  return monitors;
}

// ---------- dispatch ----------

/** Injection points, mirroring `lib/wifi` (exec) and `lib/check` (loadFfi). */
export interface MonitorDeps {
  platform?: string;
  exec?: (cmd: string) => string;
  loadFfi?: () => Promise<Ffi>;
}

const firstLine = (e: unknown): string => String((e as Error).message).split(/\r?\n/)[0];

/** Detects the connected monitors for this platform; never throws. */
export async function detectMonitors(deps: MonitorDeps = {}): Promise<MonitorsReport> {
  const platform = deps.platform ?? process.platform;
  if (platform === "win32") {
    try {
      const ffi = await (deps.loadFfi ?? (() => loadKoffi(VERSION)))();
      const monitors = detectWin32(ffi);
      return {
        monitors,
        reason: monitors.length ? null : "EnumDisplayDevices found no active monitors",
      };
    } catch (e) {
      return { monitors: [], reason: `monitor detection failed — ${firstLine(e)}` };
    }
  }
  if (platform === "linux") {
    try {
      const exec = deps.exec ?? ((cmd: string) => execSync(cmd, { encoding: "utf8" }));
      const monitors = parseXrandr(exec("xrandr --query"));
      return { monitors, reason: monitors.length ? null : "xrandr reported no connected monitors" };
    } catch (e) {
      return {
        monitors: [],
        reason: `xrandr unavailable (${firstLine(e)}) — an X11/Xwayland session is needed`,
      };
    }
  }
  if (platform === "darwin") {
    try {
      const ffi = await (deps.loadFfi ?? (() => loadKoffi(VERSION)))();
      const monitors = detectDarwin(ffi);
      return { monitors, reason: monitors.length ? null : "CoreGraphics reported no displays" };
    } catch (e) {
      return { monitors: [], reason: `monitor detection failed — ${firstLine(e)}` };
    }
  }
  return { monitors: [], reason: `monitor detection not implemented on ${platform}` };
}

/** Renders the `point-bang monitors` report (pure, like `renderWifiReport`). */
export function formatMonitorsReport(r: MonitorsReport): string[] {
  if (r.monitors.length === 0) return [r.reason ?? "no monitors detected"];
  const lines = r.monitors.map(
    (m, i) =>
      `${i + 1}  ${m.label}  ${m.w}x${m.h} at (${m.x},${m.y})${m.primary ? "  PRIMARY" : ""}`,
  );
  lines.push(
    "",
    "Aim at one with `point-bang --monitor <n>`, or span them all with `--monitor all`.",
  );
  return lines;
}

/**
 * The `point-bang monitors` command: detect, print, exit code.
 * @returns 0 when at least one monitor was listed, 1 otherwise.
 */
export async function monitorsMain(
  deps: MonitorDeps & { log?: (line: string) => void } = {},
): Promise<number> {
  const log = deps.log ?? console.log;
  const report = await detectMonitors(deps);
  for (const line of formatMonitorsReport(report)) log(line);
  return report.monitors.length > 0 ? 0 : 1;
}

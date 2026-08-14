import { PUBLIC_ASSETS, type AssetSource } from "./assets.ts";
import { parseButtonConfig } from "./buttons.ts";
import { parseCombo, createComboProbe } from "./hotkey.ts";
import { loadLibNut, loadKoffi, type LibNut, type Ffi } from "./native.ts";
import { VERSION } from "./version.ts";

/**
 * `point-bang check` — does this install actually work?
 *
 * It answers the questions that differ between a checkout and a shipped
 * executable: are the phone-page files reachable, can the native input addon
 * be opened, and can the pause-hotkey FFI read key state. Missing assets are
 * a broken build and fail the command; an unopenable addon or hotkey is
 * reported but does not, because a headless machine (CI, a server over SSH)
 * legitimately has no display to inject into or keyboard to watch.
 *
 * @module
 */

/** Injection points for {@link runCheck}. */
export interface CheckDeps {
  assets: AssetSource;
  log: (line: string) => void;
  loadNative?: () => Promise<LibNut>;
  /** koffi loader for the pause-hotkey check; tests inject a fake. */
  loadFfi?: () => Promise<Ffi>;
  platform?: string;
  arch?: string;
  env?: Record<string, string | undefined>;
}

/** @returns The number of missing phone-page assets, logging each one. */
async function checkAssets(d: CheckDeps): Promise<number> {
  let missing = 0;
  for (const name of PUBLIC_ASSETS) {
    const data = await d.assets.read(name);
    if (!data) {
      d.log(`asset ${name}: MISSING`);
      if (name === "editor.html")
        d.log("editor: not built — serve builds it automatically, or: npm run -w editor build");
      missing++;
      continue;
    }
    d.log(`asset ${name}: ${data.length} bytes`);
    if (name === "buttons.json") {
      const cfg = parseButtonConfig(data.toString("utf8"));
      for (const p of cfg.problems) d.log(`buttons: ${p}`);
      d.log(`buttons: ${cfg.actions.size} action(s) mapped`);
    }
  }
  return missing;
}

async function checkInput(d: CheckDeps, platform: string): Promise<void> {
  // libnut does not throw when X11 has no display to open — it prints
  // "Could not open main display" and kills the process. Nothing downstream
  // can catch that, so the only defense is not to call it.
  if (platform === "linux" && !(d.env ?? process.env).DISPLAY) {
    d.log("input: UNAVAILABLE — no DISPLAY set (headless session)");
    d.log("input: cursor injection needs a running X11 (or Xwayland) display.");
    return;
  }
  try {
    const nut = await (d.loadNative ?? (() => loadLibNut(VERSION)))();
    const s = nut.getScreenSize();
    d.log(`input: ready — screen ${s.width}x${s.height}`);
    if (platform === "darwin")
      d.log(
        "input: macOS asks once for Accessibility permission (System Settings > Privacy & Security) — without it the cursor will not move even though this check passes",
      );
  } catch (e) {
    d.log(`input: UNAVAILABLE — ${(e as Error).message}`);
    if (platform === "linux")
      d.log(
        "input: Linux needs an X11 session with XTEST (install libx11 and libxtst; Wayland must run Xwayland).",
      );
    else if (platform === "darwin")
      d.log(
        "input: a downloaded binary may be blocked by macOS quarantine — run: xattr -d com.apple.quarantine <file>",
      );
    else d.log("input: the native addon could not be loaded — see the troubleshooting guide.");
  }
}

async function checkHotkey(d: CheckDeps, platform: string): Promise<void> {
  // The default combo stands in for whatever `serve --pause-combo` will get:
  // what is being proven here is that the FFI loads and can watch keys at all.
  try {
    const ffi = await (d.loadFfi ?? (() => loadKoffi(VERSION)))();
    const r = createComboProbe(parseCombo("shift+s")!, { ffi, platform, env: d.env });
    d.log(
      r.probe ? "pause hotkey: ready (default shift+s)" : `pause hotkey: unavailable — ${r.reason}`,
    );
  } catch (e) {
    d.log(`pause hotkey: unavailable — ${(e as Error).message}`);
  }
}

/** @returns 0 when every embedded asset is present, 1 otherwise. */
export async function runCheck(d: CheckDeps): Promise<number> {
  const platform = d.platform ?? process.platform;
  d.log(`point-bang ${VERSION}  (${platform}/${d.arch ?? process.arch}, node ${process.version})`);
  const missing = await checkAssets(d);
  await checkInput(d, platform);
  await checkHotkey(d, platform);
  return missing ? 1 : 0;
}

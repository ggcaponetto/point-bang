import { PUBLIC_ASSETS, type AssetSource } from "./assets.ts";
import { parseButtonConfig } from "./buttons.ts";
import { loadLibNut, type LibNut } from "./native.ts";
import { VERSION } from "./version.ts";

/**
 * `point-bang check` — does this install actually work?
 *
 * It answers the two questions that differ between a checkout and a shipped
 * executable: are the phone-page files reachable, and can the native input
 * addon be opened. Missing assets are a broken build and fail the command;
 * an unopenable addon is reported but does not, because a headless machine
 * (CI, a server over SSH) legitimately has no display to inject input into.
 *
 * @module
 */

/** Injection points for {@link runCheck}. */
export interface CheckDeps {
  assets: AssetSource;
  log: (line: string) => void;
  loadNative?: () => Promise<LibNut>;
  platform?: string;
  arch?: string;
  env?: Record<string, string | undefined>;
}

/** @returns 0 when every embedded asset is present, 1 otherwise. */
export async function runCheck(d: CheckDeps): Promise<number> {
  const platform = d.platform ?? process.platform;
  d.log(`point-bang ${VERSION}  (${platform}/${d.arch ?? process.arch}, node ${process.version})`);

  let missing = 0;
  for (const name of PUBLIC_ASSETS) {
    const data = await d.assets.read(name);
    if (!data) {
      d.log(`asset ${name}: MISSING`);
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

  // libnut does not throw when X11 has no display to open — it prints
  // "Could not open main display" and kills the process. Nothing downstream
  // can catch that, so the only defense is not to call it.
  if (platform === "linux" && !(d.env ?? process.env).DISPLAY) {
    d.log("input: UNAVAILABLE — no DISPLAY set (headless session)");
    d.log("input: cursor injection needs a running X11 (or Xwayland) display.");
    return missing ? 1 : 0;
  }

  try {
    const nut = await (d.loadNative ?? (() => loadLibNut(VERSION)))();
    const s = nut.getScreenSize();
    d.log(`input: ready — screen ${s.width}x${s.height}`);
  } catch (e) {
    d.log(`input: UNAVAILABLE — ${(e as Error).message}`);
    d.log(
      platform === "linux"
        ? "input: Linux needs an X11 session with XTEST (install libx11 and libxtst; Wayland must run Xwayland)."
        : "input: the native addon could not be loaded — see the troubleshooting guide.",
    );
  }
  return missing ? 1 : 0;
}

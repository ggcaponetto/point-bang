# Lightgun POC — phone WebXR → PC cursor

TypeScript on the PC (run natively by Node's type stripping — no build step),
plain JS on the phone (Chrome loads it directly — also no build step).

## Run it

PC (Windows/macOS/Linux, **Node 23.6+**; type stripping runs .ts directly):

    npm install
    npm run start:adb    # USB flow: also runs `adb reverse` for you
    npm run start:wifi   # same-WiFi flow: prints the URLs to open on the phone
    npm start            # both at once

USB flow: phone on Android Chrome, USB debugging enabled, cable connected —
`start:adb` sets up the tunnel (re-run the script after a cable replug), then
open **http://localhost:8443** in Chrome on the phone. `localhost` is a
secure context, so no HTTPS certificate is needed, and the "network" is the
USB cable (near-zero jitter, phone charges while you test).

macOS note: grant the terminal Accessibility permission
(System Settings → Privacy & Security → Accessibility) or cursor moves are blocked.

## Run it over WiFi (no adb)

Start with `npm run start:wifi` — it prints exactly the URLs to open, and
which option they need. WebXR only runs in a secure context, so plain
`http://<PC-IP>:8443` won't work (`navigator.xr` is undefined). Two ways
around it — phone and PC on the same WiFi:

**Option A — Chrome flag (zero setup, per-phone):**

1. On the phone, open `chrome://flags/#unsafe-treat-insecure-origin-as-secure`.
2. Enable it and add `http://<PC-IP>:8443` — find the IP with `npm run ip`
   (the Wi-Fi interface is marked; the server also prints all LAN IPs on start).
3. Relaunch Chrome, open `http://<PC-IP>:8443`. Done — no HTTPS involved.

**Option B — mkcert HTTPS (proper, works in any browser):**

1. On the PC: install mkcert (`choco install mkcert` or `scoop install mkcert`), then

       mkcert -install
       mkdir certs
       mkcert -cert-file certs/cert.pem -key-file certs/key.pem localhost <PC-IP>

   Re-run the last command if your LAN IP changes.

2. Trust the CA on the phone: copy the file at `mkcert -CAROOT` (`rootCA.pem`)
   to the phone and install it via Settings → Security → Encryption & credentials
   → Install a certificate → CA certificate.
3. `npm start` now also serves **https://<PC-IP>:8444** (it prints the exact
   URLs). Open that on the phone. HTTP on :8443 keeps working for the adb flow.

WiFi adds jitter compared to USB — watch the server's p95 print, prefer 5GHz
(`npm run wifi` shows which band the PC is on), and go back to the adb tunnel
if aim feels rubbery.

## Use it

1. Pick calibration method (start with **hit-test**), confirm monitor aspect, START AR.
2. Sweep the phone slowly around the desk/monitor area until tracking is `good`.
3. Aim the green crosshair at each named screen corner, press CAPTURE.
   - Hit-test mode: 1 capture per corner (needs ARCore to see a surface there).
   - Two-ray mode: 2 captures per corner from positions ~50cm apart
     (no surfaces needed; use this if hit-test won't land near the screen).
4. HUD shows measured aspect ratio — green means calibration is sane.
5. Aim at the screen: the PC cursor follows. FIRE = left click.
6. Slider (right side) = smoothing vs. snappiness, live. Left = steady but
   laggy; right = near-raw aim (fastest response, more visible hand tremor).
   Push it right until jitter bothers you, then back off a notch.

The server prints aim-message jitter stats (p50/p95) every 2 s.

## Buttons (20, assignable)

`public/buttons.json` defines 20 buttons. Each has a `label`, a `visible`
flag (visible ones appear in a strip on the phone during play) and an
`action` the PC executes:

    "key:r"              press/release the R key
    "key:ctrl+shift+f"   combos: modifiers first
    "key:1" / "key:f4"   digits become Num1…, f1-f24 work too
    "mouse:left" / "mouse:right" / "mouse:middle"
    ""                   unassigned

Press-and-hold works: touching a button presses, letting go releases (so
holds, rapid fire and duck-style mechanics behave). Edit the file, restart
the server, reload the phone page.

**FIRE is a regular button too**: the entry with id `"fire"` renders into the
big red slot at the bottom (instead of the strip) and does whatever its
action says — default `mouse:left`. Hide it or remap it like any other
button. All buttons trigger on touch-DOWN, not release, so shots register
~100ms sooner than a normal tap.

## Aim correction

If shots land slightly off after calibration, use the arrow pad next to the
smoothing slider to shift the aim in 0.5%-of-screen steps (center button
shows the current offset and resets it). The offset zeroes on recalibration.

## Latency

The PC extrapolates aim ~20ms ahead using a velocity fit over the last few
samples and moves the cursor every 2ms, hiding network jitter and frame
quantization (`PREDICT_MS` env tunes it, `PREDICT_MS=0` keeps it minimal).
The smoothing slider at 100% bypasses the phone-side filter entirely — the
rawest possible aim. If it still feels slow, run `npm run wifi` (2.4 GHz is
a common culprit) or compare against the USB flow to isolate the network.

## Tests & checks

    npm test           # vitest + coverage; fails under 90% on any metric
    npm run test:watch
    npm run typecheck  # tsc --noEmit (also type-checks public/math.js via JSDoc)
    npm run format     # prettier --write (format:check to verify only)
    npm run knip       # unused files/exports/dependencies
    npm run validate   # format:check + typecheck + knip + test

Husky hooks: pre-commit runs prettier check + typecheck; pre-push runs the
full `npm run validate`. They install automatically via `npm install`
(`prepare` script).

Pure logic lives in `lib/` (server side) and `public/math.js` (phone-side
math, shared by browser and tests). `server.ts` is covered by integration
tests with a fake mouse — running tests never moves your real cursor.

## Protocol (frozen for later phases)

    {"type":"aim","u":0.512,"v":0.334,"t":1712345678901,"q":1}
    {"type":"fire"}
    {"type":"calib","stage":"corner","i":0,"x":..,"y":..,"z":..}
    {"type":"state","tracking":"good"|"limited"|"lost"}
    {"type":"button","id":"b1","down":true}          (v2, additive)

u,v are proportions of the physical screen (top-left = 0,0). The PC clamps
and scales to pixels, so any resolution works. Values outside 0..1 are sent
on purpose — later they become the off-screen "reload" gesture.

## Troubleshooting

- "navigator.xr missing" → you opened via IP over HTTP. Use the adb tunnel
  (localhost), or one of the WiFi options above (Chrome flag or mkcert HTTPS).
- HTTPS page loads but WS stays closed / cert warning loops → the phone doesn't
  trust the mkcert CA yet (step 2 of Option B), or the cert doesn't include the
  IP you're browsing to (re-run mkcert with the current LAN IP).
- immersive-ar unsupported → install/update "Google Play Services for AR".
- Hit-test never finds the screen corners → expected on some setups
  (emissive panel, bare wall). Switch to two-ray mode.
- Cursor moves but jittery → move the slider toward its smooth end (lower);
  check the server's p95 jitter print; prefer USB over WiFi.
- Cursor lags behind your aim → move the slider toward its snappy end (higher);
  if still laggy on WiFi, compare against the adb/USB flow — a big difference
  means network delay (use 5GHz, or play wired).
- Cursor mirrored/rotated → corners captured in the wrong order; recalibrate
  (TL, TR, BL exactly).
- Aspect check red → sloppy captures; recalibrate, aim more deliberately.

## Not in scope yet (next phases)

WebRTC DataChannel, PC-side extrapolation, mkcert/WiFi operation,
off-screen reload detection, pointing at an actual game.

# Getting Started (USB)

The USB flow is the lowest-latency way to play: the "network" is the cable
(steady ~3ms, zero WiFi jitter) and the phone charges while you shoot.

## Requirements

- **PC** — Windows, macOS or Linux with **Node.js ≥ 23.6** (the server is
  TypeScript run natively via type stripping — there is no build step).
- **Phone** — Android with ARCore support, Chrome, and
  [Google Play Services for AR](https://play.google.com/store/apps/details?id=com.google.ar.core)
  installed.
- **Cable + USB debugging** — enable Developer Options → USB debugging, and
  have `adb` (Android platform-tools) on your PATH.

## Run it

```sh
git clone https://github.com/ggcaponetto/point-bang.git
cd point-bang
npm install
npm run start:adb   # starts the server AND sets up the adb tunnel
```

Then open **http://localhost:8443** in Chrome on the phone. `localhost` is a
secure context, so WebXR works without any HTTPS certificate.

::: tip macOS
Grant your terminal Accessibility permission (System Settings → Privacy &
Security → Accessibility) or cursor moves are silently blocked.
:::

## Calibrate

1. Pick a calibration method (start with **hit-test**), confirm your monitor
   aspect ratio, and tap **START AR**.
2. Sweep the phone slowly around the desk/monitor area until the HUD shows
   tracking `good`.
3. Aim the green crosshair at each named screen corner — **top-left,
   top-right, bottom-left, in that exact order** — and press **CAPTURE**.
   - **Hit-test mode**: one capture per corner (ARCore must see a surface).
   - **Two-ray mode**: two captures per corner from positions ~50cm apart —
     use this when hit-testing won't land on the screen.
4. The HUD shows the measured aspect ratio — green means the calibration is
   geometrically sane.
5. Aim at the screen: the PC cursor follows. The red **FIRE** button
   left-clicks (and it's [remappable](/guide/buttons)).

Recalibration takes ~15 seconds and is needed once per session — WebXR
anchors don't persist across sessions, and bumping the monitor invalidates
the calibration (anchors track the spot in space, not the object).

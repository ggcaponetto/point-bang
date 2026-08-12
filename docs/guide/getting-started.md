# Getting Started (USB)

The USB flow is the lowest-latency way to play: the "network" is the cable
(steady ~3ms, zero WiFi jitter) and the phone charges while you shoot.

::: tip No cable? Scan the QR
Running `point-bang` prints a QR code — scan it with the phone, tap
**Allow** on Chrome's one-time local-network prompt, and you're connected
over WiFi with no certificates or flags. See
[Playing over WiFi](/guide/wifi) for how it works.
:::

## Requirements

- **PC** — Windows or Linux. Either grab the
  [single executable](#no-node-the-single-executable) (nothing else to
  install) or use **Node.js ≥ 23.6** with a checkout — the server is
  TypeScript run natively via type stripping, so there is no build step.
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

Every option is a flag — no environment variables, so the same command works
in bash, cmd.exe and PowerShell:

```sh
npm start -- --port 9000 --mode adb
node cli.ts --help
```

## Pause to use the real mouse

Press **shift+space** (on the PC keyboard) to pause tracking — the cursor is
yours again — and press it again to resume aiming, no reconnect or
recalibration needed. The combo is configurable and works the same in the
single executable:

```sh
point-bang serve --pause-combo ctrl+f9   # any buttons.json-style key combo
point-bang serve --pause-combo off       # disable the hotkey entirely
```

The keys are read passively (no global hook): the focused game still
receives the combo, so pick one your game ignores. While paused, aim, FIRE
and new button presses from the phone are dropped; releases still go through
so nothing stays held down.

## No Node? The single executable

`npm run build:sea` produces `dist/point-bang` (or `point-bang.exe` on
Windows) — one self-contained file with the phone page and the input driver
baked in. Copy it anywhere and run it:

```sh
point-bang serve --mode adb
point-bang check              # is this install working?
```

The build targets the OS it runs on; there is no cross-compiling. If you want
HTTPS for the [WiFi flow](/guide/wifi), put `certs/cert.pem` and
`certs/key.pem` in a `certs` folder **next to the executable**.

::: tip Windows
The first run pops a Windows Defender Firewall prompt — allow it on private
networks, or the phone cannot reach the server over WiFi. USB (`--mode adb`)
needs no firewall rule.
:::

::: tip Linux
Cursor injection uses X11's XTEST extension: install `libx11` and `libxtst`
(`libxtst6` on Debian/Ubuntu). A Wayland session needs Xwayland.
`point-bang check` tells you whether input is available.
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

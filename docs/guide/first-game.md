# Your First Game

This walks a brand-new setup from zero to actually playing a rail shooter,
using **Time Crisis** (PlayStation, via the DuckStation emulator) as the
worked example — it's the genre's poster child and its GunCon controller
maps cleanly onto point-bang's absolute mouse input.

> 📹 _Videos showing the full setup and gameplay are coming soon and will be
> embedded here._

## 1. Set up the PC (once)

1. Download the latest `point-bang` executable for Windows or Linux from
   [Releases](https://github.com/ggcaponetto/point-bang/releases) — a single
   file, nothing to install. (Developers can clone the repo and `npm start`
   instead.)
2. Run it. On Windows, **accept the firewall prompt for private networks** —
   dismissing it silently breaks the WiFi flow.
3. The terminal prints a QR code. Leave it running.

## 2. Set up the phone (once)

- Android phone with ARCore support and up-to-date **Chrome**.
- Install **Google Play Services for AR** from the Play Store (many phones
  already have it).
- Not sure your phone qualifies? Open the
  [start page](https://ggcaponetto.github.io/point-bang/start/) on it — it
  checks WebXR support right there.

## 3. Connect and calibrate

1. Scan the QR with the phone camera and open the link.
2. Chrome asks once to _"look for and connect to devices on your local
   network"_ — tap **Allow**. The HUD's `link` field turns `rtc`.
3. Tap **START AR**, sweep the phone slowly around the desk until tracking
   shows `good`, then aim the crosshair at your **top-left, top-right, and
   bottom-left** screen corners (that exact order), pressing **CAPTURE** on
   each. The aspect check turns green when the calibration is sane.
4. Aim at the screen — the PC cursor follows. You are now a lightgun.

Two tips before launching a game:

- Recalibration takes ~15 seconds and is needed once per session (or after
  bumping the monitor).
- Press **shift+space** on the PC keyboard any time to pause tracking and
  use the real mouse; press it again to resume.

## 4. Time Crisis in DuckStation

[DuckStation](https://www.duckstation.org/) is a PlayStation emulator with
first-class GunCon support that reads the **mouse pointer position** — which
is exactly what point-bang injects.

1. In DuckStation: **Settings → Controllers → Controller Port 1** → change
   the controller type to **GunCon**.
2. Set the GunCon's pointer to **Mouse** (Pointer-0). Bind:
   - **Trigger** → Left Mouse Button — that's the phone's big LEFT button (`b0`).
   - **A** and **B** → two keyboard keys (say `Q` and `E`).
3. In point-bang's `buttons.json`, the phone's `A`/`B` buttons default to
   keyboard keys — align them with what you bound in DuckStation using the
   live editor the banner points at (see [Buttons](/guide/buttons)).
   Time Crisis's pedal (duck/reload) is the important one: put it on a big
   easy-to-hit phone button, on a **screen edge** (aim off-screen = duck,
   the arcade way), or on a Bluetooth trigger's button.
4. Run the game **fullscreen on the calibrated monitor**. Windowed play is
   not supported yet (the PC maps aim to the whole screen; per-window
   mapping is on the roadmap).
5. In the game's calibration screen, shoot the targets it shows — GunCon
   games calibrate themselves once and remember it.

> 📹 _Gameplay video placeholder — Time Crisis 1, USB flow, 60fps._

### If shots land slightly off

- Nudge the aim with the on-phone **adjust pad** (arrows shift the aim in
  0.5% steps).
- Recalibrate with more deliberate corner captures.
- Check the [latency guide](/guide/latency) — enable the monitor's game
  mode and exclusive fullscreen; the display+game pipeline usually
  dominates end-to-end latency.

## 5. MAME arcade lightgun games

For arcade classics (Point Blank, Area 51, Lethal Enforcers):

```sh
mame <rom> -lightgun -lightgun_device mouse -offscreen_reload -lowlatency
```

- `-lightgun_device mouse` reads the absolute cursor point-bang drives.
- `-offscreen_reload` turns shots fired off-screen into the classic
  reload — combine it with aiming past the screen edge.
- In the MAME UI, map the trigger under **Input (this machine)** if the
  default mouse-button mapping doesn't take.

## Community guides, hacks and mods

Setups vary wildly — CRT filters, Sinden-style borders, gun-shell phone
grips, RetroArch cores, cabinet builds. **Community-driven guides, hacks
and mods are very welcome and will be linked right here in the docs.**
Write one, open a pull request (see
[Contributing](https://github.com/ggcaponetto/point-bang/blob/main/CONTRIBUTING.md)),
or open an issue with a link to your write-up.

| Guide                       | Author | Link           |
| --------------------------- | ------ | -------------- |
| _Your guide could be here!_ | —      | PRs welcome 🙂 |

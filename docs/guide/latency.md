# Aim & Latency Tuning

point-bang's feel is governed by a few deliberate knobs. From most to least
impactful:

## 1. Transport

USB (`start:adb`) has near-zero network jitter. On WiFi, **5 GHz matters**:
2.4 GHz is congested and spiky. `point-bang wifi` shows your band (Windows via
`netsh`, Linux via `nmcli` or `iw`).
The server prints jitter percentiles every 2 seconds:

```
aim msgs: 122/2s  jitter p50=1.2ms p95=4.5ms max=9.0ms
```

Judge every change by **p95**, not p50 — jitter hurts feel more than average
latency does.

## 2. The smoothing slider

The slider (right side, after calibration) trades steadiness for snap:

- **Left** — heavy One Euro filtering: rock-steady, visibly laggy.
- **Right** — light filtering: snappy, shows hand tremor.
- **Fully right (100%)** — bypasses the filter entirely: raw aim.

Push it right until the jitter bothers you, then back off a notch. The One
Euro filter is adaptive (smooth when slow, responsive when flicking), so
mid positions are better than they sound.

## 3. PC-side prediction (off by default)

The server can extrapolate aim with a least-squares velocity fit over the
last ~120ms of samples, projecting sample-age + lookahead ahead (capped at
45ms) to hide network jitter and about a frame of delay. The flip side is
that the cursor **leads** your aim — clearest with the slider fully right,
where no filter lag masks it — so prediction is **off by default**: the
cursor goes exactly where the newest sample says.

Opt in with `--predict-ms`, which works the same in bash, cmd.exe and
PowerShell:

```sh
point-bang serve --predict-ms 20   # extrapolate 20ms past each sample's age
point-bang serve --predict-ms 0    # off (the default): newest sample only
```

From a checkout, `npm start -- --predict-ms 20` does the same thing. The
`PREDICT_MS` environment variable is still read as a fallback.

When enabled, prediction resets automatically on tracking loss, so stale
velocity never drags the cursor.

## 4. Aim offset (nudge pad)

If shots land slightly off after calibration, the arrow pad next to the
slider translates the aim in **0.5%-of-screen steps**. The center button
shows the current offset and resets it. The offset zeroes on recalibration —
it corrects a specific calibration, not the gun.

## What's left

Game and display add 30–80ms on top of everything here — tune that in the
game/OS (exclusive fullscreen, monitor game mode, MAME `-lowlatency`), not
in point-bang.

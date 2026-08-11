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

## 3. PC-side prediction

The server extrapolates aim with a least-squares velocity fit over the last
~120ms of samples, projecting sample-age + 20ms ahead (capped at 45ms), and
moves the cursor every 2ms along the predicted path. This hides network
jitter and about a frame of delay.

Tune with `--predict-ms`, which works the same in bash, cmd.exe and
PowerShell:

```sh
point-bang serve --predict-ms 30   # more aggressive lookahead
point-bang serve --predict-ms 0    # minimal prediction
```

From a checkout, `npm start -- --predict-ms 30` does the same thing. The
`PREDICT_MS` environment variable is still read as a fallback.

Prediction resets automatically when tracking is lost, so stale velocity
never drags the cursor.

## 4. Aim offset (nudge pad)

If shots land slightly off after calibration, the arrow pad next to the
slider translates the aim in **0.5%-of-screen steps**. The center button
shows the current offset and resets it. The offset zeroes on recalibration —
it corrects a specific calibration, not the gun.

## What's left

Game and display add 30–80ms on top of everything here — tune that in the
game/OS (exclusive fullscreen, monitor game mode, MAME `-lowlatency`), not
in point-bang.

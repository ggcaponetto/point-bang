# Troubleshooting

## "navigator.xr missing"

You opened the page via plain HTTP over the network. Use the adb tunnel
(`localhost` is a secure context) or one of the [WiFi options](/guide/wifi).

## immersive-ar not supported

Install or update **Google Play Services for AR** on the phone.

## HTTPS page loads but the WebSocket stays closed

The phone doesn't trust the mkcert CA yet (Option B step 2), or the cert
doesn't include the IP you're browsing to — re-run mkcert with the current
LAN IP.

## Hit-test never finds the screen corners

Expected on some setups: monitors are emissive, low-texture surfaces that
ARCore struggles with. Switch to **two-ray mode** — it needs no surfaces.
Room clutter around the monitor actually improves tracking; blank walls and
whip-pans cause `limited`/`lost` states.

## Cursor is mirrored or rotated

Corners were captured in the wrong order. Recalibrate: **top-left,
top-right, bottom-left — exactly**.

## Aspect check is red

Sloppy corner captures. Recalibrate and aim more deliberately; in two-ray
mode step a full 50cm sideways between the two captures.

## Cursor is jittery

Move the slider toward its smooth end, check the server's p95 jitter print,
prefer USB or 5 GHz WiFi. See [Aim & Latency Tuning](/guide/latency).

## Cursor lags behind your aim

Move the slider toward its snappy end (or fully right for raw aim). If WiFi
still lags, compare against the USB flow — a big difference means network
delay.

## Buttons don't appear

The strip and FIRE only appear **after calibration completes**. If they
still don't, check the server's startup log for `buttons:` lines reporting
config problems.

## adb tunnel died

`adb reverse` mappings die on cable replug or adb restart — just re-run
`npm run start:adb` (it re-establishes the tunnel every start).

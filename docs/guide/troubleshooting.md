# Troubleshooting

Start with `point-bang check` (or `npm run check`). It prints the version,
confirms the phone-page files are reachable, and says whether cursor
injection is available — which covers most of what follows.

## The phone can't reach the PC over WiFi (Windows)

The first run raises a Windows Defender Firewall prompt. If it was dismissed,
Node is blocked and the page never loads. Re-allow it for **private**
networks, or use the USB flow, which needs no firewall rule.

## Linux: "libXtst.so.6: cannot open shared object file"

Cursor injection uses X11's XTEST extension. Install it — `sudo apt install
libxtst6 libx11-6` on Debian/Ubuntu, `libXtst` on Fedora/Arch. A Wayland
session additionally needs Xwayland.

## Linux: "Could not open main display" / the server exits immediately

There is no X display to inject into — you're on a headless machine, a
container or an SSH session with no `DISPLAY`. The input driver reacts to this
by terminating the process rather than reporting an error, so there is nothing
to catch.

Since v0.1 `serve` detects this and starts in **virtual input** mode instead of
crashing:

```
input: VIRTUAL — no DISPLAY (headless); aim is printed, the cursor is not moved
input: assuming a 1920x1080 screen (--screen WxH to change)
aim  u=0.512 v=0.334  ->  983,360 px   x[.....+......] y[...+........]
```

Everything except the actual cursor works: the phone page is served, WebXR
calibrates, aim streams in, buttons and jitter stats are reported. Only the
final injection step is replaced by a printed line (throttled to 10/s). Use
`--screen WxH` to make the printed pixels match your real monitor, and
`--input none` to force this mode on a machine that _does_ have a display —
handy for watching what the phone sends without your cursor running away.

`--input native` demands the real device regardless; on a display-less box
that still ends in the crash above, which is why `auto` is the default. A
machine with no display cannot drive a real cursor at any price.

## TUNNEL: failed — ERR_NGROK_4018 / authtoken required

The ngrok agent is installed but has no credential. Sign up (free) and run
`ngrok config add-authtoken <token>` once. Other common ones: **ERR_NGROK_108**
means another agent session is already running — stop it, or let point-bang
adopt it by pointing that agent at this same port. The server keeps serving
either way; only the public URL is missing.

## The tunnel URL shows a warning page instead of the phone page

That's ngrok's free-plan interstitial (ERR_NGROK_6024). Tap **Visit Site** —
it appears once per URL. A reserved domain (`--tunnel-url`) means you meet it
once ever instead of once per session.

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

All buttons — placed ones and the strip — only appear **after calibration
completes**. If they still don't, check the server's startup log for
`buttons:` lines reporting config problems (a bad `rect` also lands there).

## adb tunnel died

`adb reverse` mappings die on cable replug or adb restart — just re-run
`npm run start:adb` / `point-bang serve --mode adb` (either re-establishes the
tunnel on every start). If it reports a failure, check `adb` is on your PATH
and USB debugging is authorized on the phone.

## HTTPS is off even though certs exist

`certs/` is resolved next to the program — the repo root for a checkout,
beside the executable for the single-file build — not relative to the
directory you happened to run from. Pass `--certs <dir>` to be explicit.

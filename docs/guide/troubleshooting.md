# Troubleshooting

Start with `point-bang check` (or `npm run check`). It prints the version,
confirms the phone-page files are reachable, and says whether cursor
injection is available — which covers most of what follows.

## The phone can't reach the PC over WiFi (Windows)

The first run raises a Windows Defender Firewall prompt. If it was dismissed,
the program is blocked and the page never loads — and in the QR flow the
phone's local-network fetch fails the same way, so the page shows the
"Couldn't reach the PC" message. Re-allow it for **private** networks, or use
the USB flow, which needs no firewall rule.

**Firewall rules are per-executable.** `npm start` working proves nothing
about `point-bang.exe`: the npm flow runs under `node.exe`, which has its
own rule. Worse, denying the prompt once creates a permanent **Block** rule
for that binary — after that, no prompt ever reappears and every connection
attempt fails silently. Check in an **admin** PowerShell:

```powershell
# is the exe blocked?
Get-NetFirewallApplicationFilter |
  Where-Object Program -match 'point-bang' |
  Get-NetFirewallRule | Select-Object DisplayName, Action, Enabled
```

The simplest fix is to wipe every rule bound to the exe so Windows asks
again — start point-bang afterwards and this time allow it on **private**
networks (adjust the path to where your exe lives):

```powershell
Get-NetFirewallApplicationFilter -Program "C:\path\to\point-bang.exe" |
  Get-NetFirewallRule | Remove-NetFirewallRule
```

Or skip the prompt entirely and create the Allow rule yourself:

```powershell
New-NetFirewallRule -DisplayName "point-bang" -Direction Inbound `
  -Program "C:\path\to\point-bang.exe" -Action Allow -Profile Private,Public
```

Moving or renaming the exe means a new prompt (and a new rule) — the rule
binds to the full path.

## QR flow: "Couldn't reach the PC at …"

The hosted page could not complete its one signaling fetch to your PC. In
rough order of likelihood:

1. **Different networks** — phone on mobile data or a guest SSID, PC on
   ethernet in another subnet. Both must share the LAN.
2. **Firewall** — see the Windows entry above.
3. **Permission denied** — you dismissed Chrome's local-network prompt. Fix:
   Chrome → ⋮ → Settings → Site settings → find the page's site → allow
   **Local network access**, then reload.
4. **Chrome older than 142** — the Local Network Access exemption doesn't
   exist yet, so the fetch dies as mixed content. Update Chrome.
5. **Wrong IP first in the QR** — VPN or virtual adapters can outrank the
   real WLAN. The QR carries up to three addresses and the page tries each,
   but `point-bang ip` shows what's being offered; `--page-url` plus a fresh
   scan after disabling the VPN adapter helps.

The page retries by itself (3s → 6s → 12s backoff) — once the cause is
fixed, it connects without a reload.

## QR flow: page loads but the HUD `link` stays `…`

Signaling worked but the DataChannel never opened — usually client isolation
(hotel/office WiFi that blocks phone↔PC traffic). No WiFi setup can cross
that policy; [USB](/guide/getting-started) is the way through.

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

## Port already in use

The server never fights another program for its port:

- **Default port (8443) busy** → it logs
  `http: port 8443 is busy — using a free port instead` and starts on an
  OS-assigned free port. Nothing else to do: the banner, QR and every printed
  URL carry the port it actually bound, and the phone connects through those
  — in adb mode the `adb reverse` mapping follows the real port too.
- **Explicit `--port`/`PORT` busy** → it refuses with a one-line error
  instead of silently moving off the port you pinned. Close the other program (often a second point-bang), pick another
  port, or use `--port 0` to let the OS choose every run.

One caveat: the standalone `tunnel` command cannot see which port a
fallen-back server chose — pass it the port from the server's banner
(`tunnel --port <n>`), or prefer `serve --tunnel ngrok`, which always
tunnels the bound port.

## "session key required" / the server logs "connection refused (missing/wrong session key)"

The phone tried to connect without this run's session key. The key is minted
fresh on every server start and travels inside the QR — so this usually
means the phone is holding yesterday's URL (a bookmark, an old tab, a
reopened Chrome session). **Scan the QR again** (or retype the printed URL,
`#key=…` included) and it connects. Restarting the server invalidates the
old key on purpose; `--key <your-own>` keeps a stable key across restarts if
you want bookmarks to survive, and `--key off` disables the check entirely
on a network you trust.

## "navigator.xr missing"

You opened the page via plain HTTP over the network. Use the
[QR flow](/guide/wifi) — the hosted page is HTTPS — or the adb tunnel
(`localhost` is a secure context).

## immersive-ar not supported

Install or update **Google Play Services for AR** on the phone.

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

## The pause hotkey does nothing

Check the server's startup log. `pause hotkey: shift+space toggles tracking`
means it is armed; `pause hotkey: unavailable — <reason>` tells you why it is
not (headless session, no X display, an unwatchable key in the combo). Run
`point-bang check` to see the hotkey status for your install. On Wayland the
key state is only visible while an X11/Xwayland window has focus — Proton and
X11 games are fine, native Wayland apps are not. Keys with layout-dependent
codes (punctuation) cannot be watched; letters, digits, F-keys, modifiers and
navigation keys all work.

## adb tunnel died

`adb reverse` mappings die on cable replug or adb restart — just re-run
`npm run start:adb` / `point-bang serve --mode adb` (either re-establishes the
tunnel on every start). If it reports a failure, check `adb` is on your PATH
and USB debugging is authorized on the phone.

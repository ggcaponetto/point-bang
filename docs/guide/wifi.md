# Playing over WiFi

No cable, same network. Start with:

```sh
npm start            # or: point-bang / npm run start:wifi
```

## The QR flow (recommended — no certificates, no flags)

The server prints a QR code on startup. That's the whole setup:

1. **Run** `point-bang` (or `npm start`) on the PC. Accept the Windows
   firewall prompt for **private networks** if it appears.
2. **Scan** the QR with the phone camera. The phone page loads from
   `https://ggcaponetto.github.io/point-bang/phone/` — a real HTTPS origin,
   so WebXR gets its secure context with nothing to install.
3. **Tap Allow** when Chrome asks to _"look for and connect to devices on
   your local network"_ — asked once per site. Aim data then flows over a
   WebRTC DataChannel **directly across your WiFi** (unordered,
   no-retransmit — a lost sample is stale anyway); nothing detours through
   the internet after the page load.

Requirements: Chrome 142+ on the phone (October 2025 — Chrome self-updates,
and WebXR AR needs a current Chrome anyway). The HUD's `link` field shows
`rtc` when connected.

How it dodges the certificate problem: the page's _origin_ is HTTPS (GitHub
Pages), signaling is a single `fetch()` to the PC that Chrome's
**Local Network Access** permission exempts from mixed-content blocking, and
WebRTC brings its own encryption — so the PC never needs a TLS certificate.
The QR encodes your PC's LAN addresses in the URL _fragment_, which never
leaves the phone.

Self-hosting the page? `--page-url https://your.site/phone/` points the QR
(and the CORS allowlist) elsewhere; `--no-qr` silences the banner.

The options below predate the QR flow and remain as fallbacks — useful on a
de-Googled phone, a pinned old Chrome, or a network where the phone cannot
reach the internet even once to load the page.

## Option A — Chrome flag (zero setup)

1. On the phone, open `chrome://flags/#unsafe-treat-insecure-origin-as-secure`.
2. Enable it and add `http://<PC-IP>:8443` — `npm run ip` prints your
   addresses with the Wi-Fi interface marked, and `start:wifi` prints them
   ready-made.
3. Relaunch Chrome and open that URL. Done — no HTTPS involved.

## Option B — mkcert HTTPS (proper)

1. On the PC, install [mkcert](https://github.com/FiloSottile/mkcert)
   (`choco install mkcert` / `scoop install mkcert` / `brew install mkcert`),
   then:

   ```sh
   mkcert -install
   mkdir certs
   mkcert -cert-file certs/cert.pem -key-file certs/key.pem localhost <PC-IP>
   ```

   Re-run the last command whenever your LAN IP changes — certs are per-IP.

   The `certs` folder is looked for **next to the program**: the repo root for
   a checkout, or beside `point-bang.exe` for the single executable. Point
   somewhere else with `--certs <dir>`. If the files aren't found, HTTPS is
   silently off and only Option A works.

2. Trust the CA on the phone: copy `rootCA.pem` (find it with
   `mkcert -CAROOT`) to the phone and install it via Settings → Security →
   Encryption & credentials → Install a certificate → **CA certificate**.

3. `npm run start:wifi` now also serves **https://\<PC-IP\>:8444** with a
   WebSocket over TLS. HTTP on :8443 keeps working for the USB flow.

## Option C — public tunnel (no LAN needed at all)

When Options A and B are inconvenient — a locked-down corporate network, a
phone on mobile data, a laptop you don't want to install a CA on — expose the
server through [ngrok](https://ngrok.com):

```sh
npm run start:tunnel        # = point-bang serve --tunnel ngrok
```

That runs the server and the tunnel in one process. If you'd rather keep them
apart — so you can restart either without dropping the other — run the tunnel
on its own in a second terminal:

```sh
npm run start              # terminal 1: the server
npm run tunnel             # terminal 2: = point-bang tunnel
```

`tunnel` exposes port 8443 by default; pass `--port` if the server is on
another one. If an ngrok agent is already forwarding that port, it is reused
rather than duplicated — the command prints the URL, says it borrowed the
agent, and exits, leaving the agent alone.

One-time setup: install the ngrok agent and register a free authtoken with
`ngrok config add-authtoken <token>` (a free account is enough). The server
then prints a public URL:

```
TUNNEL: https://abc123.ngrok-free.app  <-- open this on the phone, from any network
```

Because the URL is HTTPS, it is a secure context: WebXR works with **no mkcert
and no Chrome flag**, and the aim WebSocket upgrades to `wss://` over the very
same tunnel — the phone page derives its WebSocket scheme from the page's own
protocol, so nothing needs configuring.

Things to know:

- ⚠️ **The exposed socket is unauthenticated.** Anyone who has the URL can move
  your mouse and press keys on your PC. Don't share it, and Ctrl+C when done.
- The free plan shows a one-time **"Visit Site"** interstitial to browsers. Tap
  through it; it won't come back for that URL.
- Free accounts get one reserved domain — pass it with
  `--tunnel-url https://you.ngrok-free.app` so the phone keeps the same address
  between sessions instead of a new random one each time.
- Only one ngrok session may run at a time on the free plan. If an agent is
  already up and forwarding this port, point-bang adopts it rather than failing.
- **This is for setup, not for play.** Every packet detours through ngrok's
  network, which costs far more than the ~3ms of USB. Use it to get calibrated
  and to demo from anywhere; use USB or 5 GHz WiFi to actually shoot things.
- There's no region flag: current agents pick the lowest-latency region
  themselves.

If ngrok isn't installed or the authtoken is missing, the server says so and
**keeps serving** — the USB and LAN flows are unaffected.

## Watch the band

WiFi adds jitter compared to USB — and **2.4 GHz is the usual culprit**.
`point-bang wifi` tells you which band the PC is on (Windows via `netsh`,
Linux via `nmcli`, falling back to `iw`); put both the PC
and the phone on 5 GHz if your router offers it. Watch the server's p95
jitter print, and fall back to [USB](/guide/getting-started) if aim feels
rubbery.

# Playing over WiFi

No cable, same network — and nothing to install or configure: the connection
is **secure by default** and goes **directly across your local network**.

```sh
npm start            # or: point-bang
```

## Scan the QR — that's the whole setup

The server prints a QR code on startup:

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

How it stays secure without you doing anything: the page's _origin_ is HTTPS
(GitHub Pages), signaling is a single `fetch()` to the PC that Chrome's
**Local Network Access** permission exempts from mixed-content blocking, and
WebRTC brings its own encryption — so the PC never needs a TLS certificate.
The QR also carries a **session key**, minted fresh on every start: the
server refuses any device on the network that doesn't present it, so a
roommate (or a stranger on shared WiFi) can't connect to your PC just by
knowing its address — scanning the QR is what pairs a phone. The QR encodes
the key and your PC's LAN addresses in the URL _fragment_, which never
leaves the phone.

If it doesn't connect, see [Troubleshooting](/guide/troubleshooting) — the
usual suspects are a dismissed firewall prompt, phone and PC on different
networks, or a router with client isolation. On networks that block
phone↔PC traffic entirely (hotel/guest WiFi), use
[USB](/guide/getting-started) instead.

## Watch the band

WiFi adds jitter compared to USB — and **2.4 GHz is the usual culprit**.
`point-bang wifi` tells you which band the PC is on (Windows via `netsh`,
Linux via `nmcli`, falling back to `iw`); put both the PC
and the phone on 5 GHz if your router offers it. Watch the server's p95
jitter print, and fall back to [USB](/guide/getting-started) if aim feels
rubbery.

---

_Hacking on point-bang, self-hosting the phone page, or on a phone that
can't run the QR flow? The developer transports — `--page-url`,
mkcert HTTPS, the Chrome flag, and the ngrok tunnel — are documented in
[Development](/reference/development)._

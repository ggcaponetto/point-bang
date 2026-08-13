# Protocol

JSON messages, phone → PC. **v1 is frozen** — fields are extended, never
changed; v2 additions are strictly additive, so old clients stay valid
forever.

Two transports carry the very same messages, byte for byte:

- **WebSocket** — same-origin flows (USB/localhost, mkcert HTTPS, tunnel).
- **WebRTC DataChannel** (`ordered: false, maxRetransmits: 0`) — the QR
  flow, and preferred everywhere; the server feeds both into one handler.

## Authentication: the session key

Network clients must present the server's per-run session key (from the URL
fragment the QR encodes): the WebSocket upgrade carries it as `?key=…`, the
signaling body as an additive `"key"` field. Loopback connections are exempt
unless the in-process tunnel is up; `--key off` disables the gate. Refusals
are WS close `1008` and HTTP `403` respectively.

## Signaling: `POST /rtc/offer`

The DataChannel is negotiated with a single HTTP round trip (the phone page
is the offerer, vanilla ICE, host candidates only — no STUN):

```json
→ POST /rtc/offer            {"sdp": "<offer>", "key": "<session key>"}
← 200 application/json       {"sdp": "<answer>"}
```

Errors: `400` malformed body or rejected offer, `413` body over 64 KB,
`403` browser Origin neither the hosted page nor same-origin, or a missing/
wrong session key. Cross-origin callers get CORS headers only from the
`--page-url` allowlist — the socket ends at the mouse and keyboard, so it is
never `*`.

## v1 (frozen)

```json
{"type":"aim","u":0.512,"v":0.334,"t":1712345678901,"q":1}
{"type":"fire"}
{"type":"calib","stage":"corner","i":0,"x":0.1,"y":1.2,"z":-0.5}
{"type":"state","tracking":"good"}
```

| Message | Fields                                                                                                           | Meaning                                                                                                                                               |
| ------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `aim`   | `u`,`v` proportions of the physical screen, origin top-left; `t` phone `Date.now()`; `q` confidence `1` \| `0.5` | The PC clamps and scales to pixels, so any resolution works. Values outside 0..1 are sent **on purpose** — they become the off-screen reload gesture. |
| `fire`  | —                                                                                                                | Legacy left click. The phone page now sends `button` messages instead, but the server keeps handling `fire`.                                          |
| `calib` | `stage`, `i`, `x`,`y`,`z`                                                                                        | Calibration progress, logged PC-side.                                                                                                                 |
| `state` | `tracking`: `good` \| `limited` \| `lost`                                                                        | Tracking transitions. The server resets aim prediction on `lost`.                                                                                     |

## v2 (additive)

```json
{ "type": "button", "id": "fire", "down": true }
{ "type": "aim", "u": 0.51, "v": 0.33, "t": 1712345678901, "q": 1, "m": 2 }
{ "type": "aim", "u": 0.51, "v": 0.33, "t": 1712345678901, "q": 1, "m": 1, "cal": 1 }
{ "type": "calib", "stage": "target", "m": 2 }
```

| Message          | Fields                                   | Meaning                                                                                                                                                                                |
| ---------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `button`         | `id` from `buttons.json`; `down` boolean | Press (`true`) / release (`false`) of a configured button — on-screen taps, off-screen edge gestures and Bluetooth gamepad presses all look identical on the wire.                     |
| `aim` + `m`      | `m` 1-based monitor index                | Per-monitor calibration (`--monitor all`): the phone calibrated each monitor as its own plane and tags aim with the plane it hit; the PC maps into that monitor's rect.                |
| `aim` + `cal`    | `cal: 1`                                 | Present while multi-monitor calibration is incomplete: the PC drops the sample so the parked cursor is not fought. Resuming is the **absence** of the tag — loss can't wedge aim.      |
| `calib` `target` | `stage: "target"`, `m`                   | "About to capture corners of monitor `m`" — the PC parks the cursor at that monitor's center so the user aims at the right panel. Re-sent per corner: the repeat is the loss recovery. |

The phone learns the aim targets from ungated `GET /monitors` →
`{"monitors":[{"i","label","w","h","primary"}]}` (labels and resolutions
only, no layout coordinates). More than one target puts the phone into
per-monitor calibration; a 404 (old server) silently means the classic
single-plane flow.

## v2 server → phone (additive)

```json
{ "type": "buttons", "rev": 3 }
```

The first message in the other direction: the button config changed (a live
editor save) — re-fetch `buttons.json` and re-render the overlay. Sent once
per WebSocket client and **three times** over each DataChannel (that
transport is lossy); `rev` is a per-run monotonic counter the phone dedupes
on. Old phone pages have no message listener and ignore it safely.

## Config: `GET /buttons.json`, `POST /buttons`

The effective button config is served at `GET /buttons.json` (ungated read,
like `/monitors` — the live file wins over the copy baked into an
executable). The editor saves with:

```json
→ POST /buttons              {"key": "<session key>", "config": {"buttons": […]}}
← 200 application/json       {"ok": true, "rev": 3}
```

Same guard ladder as `/rtc/offer` (`403` origin, `413` over 64 KB, `403`
key, `400` shape) plus **strict validation**: any config problem is a `400`
with `{"ok":false,"problems":[…]}` and nothing is written. On success the
file is written atomically, the PC remaps actions live, and the push above
notifies the phone.

## Planned (additive)

- `{"type":"ping","t":…}` / `{"type":"pong",…}` for RTT measurement.
- Optional `du`,`dv` velocity on `aim` for richer PC-side extrapolation.

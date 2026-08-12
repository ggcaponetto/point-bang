# Protocol

JSON messages, phone → PC. **v1 is frozen** — fields are extended, never
changed; v2 additions are strictly additive, so old clients stay valid
forever.

Two transports carry the very same messages, byte for byte:

- **WebSocket** — same-origin flows (USB/localhost, mkcert HTTPS, tunnel).
- **WebRTC DataChannel** (`ordered: false, maxRetransmits: 0`) — the QR
  flow, and preferred everywhere; the server feeds both into one handler.

## Signaling: `POST /rtc/offer`

The DataChannel is negotiated with a single HTTP round trip (the phone page
is the offerer, vanilla ICE, host candidates only — no STUN):

```json
→ POST /rtc/offer            {"sdp": "<offer>"}
← 200 application/json       {"sdp": "<answer>"}
```

Errors: `400` malformed body or rejected offer, `413` body over 64 KB,
`403` browser Origin neither the hosted page nor same-origin. Cross-origin
callers get CORS headers only from the `--page-url` allowlist — the socket
ends at the mouse and keyboard, so it is never `*`.

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
```

| Message  | Fields                                   | Meaning                                                                                                         |
| -------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `button` | `id` from `buttons.json`; `down` boolean | Press (`true`) / release (`false`) of a configured button. Down/up are separate events so press-and-hold works. |

## Planned (additive)

- `{"type":"ping","t":…}` / `{"type":"pong",…}` for RTT measurement.
- Optional `du`,`dv` velocity on `aim` for richer PC-side extrapolation.

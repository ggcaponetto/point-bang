# Protocol

One WebSocket, JSON messages, phone → PC. **v1 is frozen** — fields are
extended, never changed; v2 additions are strictly additive, so old clients
stay valid forever.

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

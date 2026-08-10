# CLAUDE.md — Phone Lightgun (WebXR → PC)

Project brief and working agreement. Read fully before making changes.

## Commands

Requires Node ≥ 23.6 (native type stripping runs .ts directly — no build).

```
npm install
npm start                        # node server.ts — http+ws on :8443 (PORT env overrides)
npm run start:adb                # USB flow only: runs `adb reverse` itself, no WiFi logs
npm run start:wifi               # WiFi flow only: https URLs (certs) or Chrome-flag URLs
npm test                         # vitest + coverage, FAILS below 90% on any metric
npm run test:watch
npm run typecheck                # tsc --noEmit (strict; also checks public/math.js JSDoc)
npm run ip                       # LAN IPs, WiFi interface marked
npm run wifi                     # 2.4 vs 5 GHz check (Windows)
npm run format / format:check    # prettier (printWidth 100)
npm run knip                     # unused files/exports/deps — keep it clean
npm run validate                 # format:check + typecheck + knip + test

adb reverse tcp:8443 tcp:8443    # phone via USB; re-run after cable replug/adb restart
```

Phone: Chrome → http://localhost:8443 → START AR → capture corners TL, TR, BL.
End-to-end aim feel is still verified manually (see Working agreement) plus
the server's p50/p95 jitter prints every 2s; tests never move the real cursor
(server integration tests inject a fake mouse).

## Vision

A DIY lightgun for PC (Time Crisis / MAME-style rail shooters) using a phone as
the tracker. The phone runs a WebXR `immersive-ar` session in the browser:
ARCore's visual-inertial tracking provides an absolute, drift-corrected 6DoF
pose. The aim ray is intersected with a one-time-calibrated screen plane,
producing normalized screen coordinates (u,v) streamed to a PC server that
injects absolute mouse input. No custom hardware, no markers, no sensor bars.

Why this beats the alternatives we evaluated: camera+marker tracking in the
browser costs 60–120ms; pure gyro drifts in yaw and needs constant recentering;
WebXR gives gyro-class latency (~15–30ms phone-side) WITH absolute aim, because
ARCore fuses IMU at high rate and only corrects with the camera. Commercial
guns (Sinden = camera + white screen border, Gun4IR/AimTrak = IR beacons) don't
use this approach; the only prior art is a hobbyist native app
(github.com/Wosk1947/LightGun, Huawei AR Engine). This niche is open.

## Current state — WORKING POC (do not break)

```
./
├── server.ts          # entry: wires http/https + ws + cursor loop; isMain-guarded
├── ip.ts, wifi.ts     # thin CLI entries over lib/ functions
├── lib/               # typed, unit-tested logic
│   ├── protocol.ts    #   message types + parseMessage (never crash on garbage)
│   ├── buttons.ts     #   action parsing (key combos/mouse) + executor + config load
│   ├── cursor.ts      #   MouseLike interface, scaleToScreen, apply-latest loop
│   ├── jitter.ts      #   JitterWindow p50/p95/max
│   ├── predict.ts     #   AimPredictor: velocity fit + capped lookahead (Phase 3)
│   ├── static.ts      #   safeResolve (traversal guard) + content types
│   ├── certs.ts       #   optional mkcert TLS loading
│   ├── input.ts       #   nut-js adapter behind MouseLike (koffi slots in later)
│   ├── net.ts         #   lanIPv4 + report formatting
│   └── wifi.ts        #   netsh parsing (locale-tolerant)
├── public/
│   ├── index.html     # phone page: XR/DOM/WS glue only (script type=module)
│   ├── buttons.json   # 20 assignable buttons: label/action/visible (phone + PC read it)
│   └── math.js        # phone math: V, OneEuro, intersectUV… (plain JS + JSDoc,
│                      #   imported by BOTH Chrome and vitest — keep it dependency-free)
├── test/              # vitest suites + fixtures/ (self-signed cert for https tests)
├── .husky/            # pre-commit: prettier+typecheck; pre-push: npm run validate
└── .mcp.json          # context7 MCP server (up-to-date library docs in Claude Code)
```

Verified working end-to-end: phone calibrates, PC cursor follows aim.
Served on :8443. Dev transport is `adb reverse tcp:8443 tcp:8443` + phone
opening http://localhost:8443 (localhost = secure context, so no HTTPS needed;
USB = near-zero network jitter). Static files must live in `public/` — a past
bug was files placed flat next to server.js causing 404s.

WiFi testing (no adb): if mkcert certs exist at `poc/certs/{cert.pem,key.pem}`,
server.js additionally serves https+wss on :8444 and prints LAN URLs; phone
opens https://<PC-IP>:8444 (mkcert root CA must be installed on the phone).
Zero-setup alternative: Chrome flag `#unsafe-treat-insecure-origin-as-secure`
with http://<PC-IP>:8443. Both documented in README. This is testing transport
only — Phase 4 (WebRTC DataChannel) is still the plan for wireless _play_.
The phone page picks ws/wss from `location.protocol`. :8443 http must never
break; certs/ absent ⇒ HTTPS silently off.

What index.html already contains (reuse, don't reinvent):

- XR session boilerplate: `immersive-ar`, required `hit-test` + `dom-overlay`,
  optional `local-floor` (fallback `local`) + `anchors`; throwaway WebGL layer
  (AR sessions must render; we clear to transparent).
- Two calibration methods behind a UI toggle:
  1. **hit-test**: aim center crosshair at 3 screen corners (TL, TR, BL),
     CAPTURE each; each corner gets an XRAnchor; corner positions are re-read
     from anchor poses every frame so calibration self-corrects.
  2. **two-ray** fallback (for when ARCore finds no surface at the screen):
     2 captures per corner from positions ≥50cm apart; closest-point-between-
     two-rays; captures with >12cm ray gap are rejected with a retry prompt.
- Sanity check: measured aspect |right|/|down| vs user-entered monitor aspect,
  green if within 8%.
- Per-frame: viewer pose → forward vector (−Z of pose quaternion) → ray-plane
  intersection → u,v in [0..1] → One Euro filter (smooth↔snappy slider drives
  minCutoff AND beta) → WS send. u,v deliberately NOT clamped phone-side (off-screen values are the
  future reload gesture).
- Tracking state (good/limited/lost from pose null / emulatedPosition) shown
  in HUD and sent to PC on change. wakeLock requested.
- Post-calibration UI: FIRE, a scrollable strip of the `visible` buttons from
  buttons.json (pointerdown/up → button down/up messages), and the aim-adjust
  panel (nudge pad shifting sent u,v by 0.5%/tap — applied AFTER the filter,
  zeroed on recalibrate — plus the smoothing slider).

What server.js already contains:

- Apply-latest cursor pattern: only newest aim sample applied per ~2ms tick,
  never a queue of stale positions. `pyautogui`-style pause pitfalls avoided.
  `mouse.config.autoDelayMs = 0` — the nut-js default of 100 sleeps inside
  button press/release (~200ms per fire click); setPosition itself is 0.2ms.
- Jitter stats: prints p50/p95/max of (arrival − t) minus window-min every 2s.
  (Clock offset unknown → only jitter is meaningful, not absolute latency.)
- `fire` → left click via nut-js.

## Protocol v1 (FROZEN — extend, never change existing fields)

```json
{"type":"aim","u":0.512,"v":0.334,"t":1712345678901,"q":1}
{"type":"fire"}
{"type":"calib","stage":"corner","i":0,"x":0.1,"y":1.2,"z":-0.5}
{"type":"state","tracking":"good"|"limited"|"lost"}
```

- u,v = proportion of physical screen, origin top-left. PC scales to pixels.
- t = phone Date.now() (ms). q = tracking confidence 1 | 0.5.

v2 (IMPLEMENTED, additive): `{"type":"button","id":"b1".."b20","down":bool}`
— ids/labels/actions configured in `public/buttons.json` (single source of
truth: phone renders `visible` buttons from it, PC maps ids to key combos or
mouse press/release via lib/buttons.ts). down/up as separate events so holds
work; keys release in reverse order.

Still planned (additive): `{"type":"ping","t":...}` / `{"type":"pong",...}`
for RTT, aim gains optional `du,dv` velocity for PC-side extrapolation.

## Tech decisions (already made — with rationale; don't relitigate silently)

- **TypeScript PC-side, no build step** (user decision 2026-08-10, supersedes
  the original all-JS choice). Node ≥23.6 native type stripping runs .ts
  directly — so keep to erasable syntax only (no enums/namespaces/parameter
  properties; `erasableSyntaxOnly` enforces this). Phone page stays buildless:
  inline JS glue + `public/math.js` ES module (plain JS + JSDoc, type-checked
  via `checkJs`, imported by both Chrome and vitest). Don't introduce a
  bundler or a compile step anywhere; edit + phone reload beats a bundler
  for tuning.
- **Vitest, 90% coverage enforced** (same decision). Thresholds live in
  vitest.config.ts; `npm test` fails below 90% on any metric. Logic goes in
  `lib/` or `public/math.js` where it's unit-testable; entry files stay thin
  with `isMain` guards. Server behavior is integration-tested with an
  injected fake MouseLike — tests must never move the real cursor or click.
- **Cursor injection: @nut-tree-fork/nut-js** (robotjs is dead; original
  nut.js went commercial). If a game rejects synthetic input or needs true
  absolute injection, add a Windows-only path using `koffi` FFI →
  `SendInput` with `MOUSEEVENTF_ABSOLUTE`, behind the same interface.
- **Transport:** WebSocket over the adb/USB tunnel is the dev default and a
  legitimate final mode (steady ~3ms, zero WiFi jitter, phone charges; wired
  guns are period-accurate). Wireless play mode = mkcert HTTPS + WebRTC
  DataChannel (`ordered:false, maxRetransmits:0`) to avoid TCP head-of-line
  stalls on WiFi. Keep WS as automatic fallback when RTC negotiation fails.
- **Filtering split:** One Euro filter phone-side (kills ARCore micro-jumps;
  adaptive: smooth when slow, responsive when flicking). Extrapolation
  PC-side (fit velocity over last samples, project to now; hides network
  jitter and ~1 frame of delay). Don't double-smooth.
- **Latency budget** (measured targets): phone-side pose→send < 20ms typical;
  transport jitter p95 < 5ms on USB; motion-to-cursor (slow-mo camera test)
  30–60ms. Game+display adds 30–80ms on top and dominates — that's tuned in
  the game/OS (exclusive fullscreen, monitor game mode, MAME `-lowlatency`),
  not in our code.

## Roadmap (each phase has an exit criterion; finish one before the next)

1. **Buttons & gestures.** On-screen FIRE already exists; add: volume-key
   capture as trigger if the browser allows it in-session (test; may not
   fire during XR), reload = u,v outside [−0.1..1.1] for >150ms emits
   `button reload` (classic Time Crisis duck/hide), plus start/coin buttons
   in the overlay. Exit: play a browser duck-hunt clone with off-screen
   reload working.
2. **Measurement harness.** PC test page (fullscreen grid of dots) + logging:
   click each dot's aim, output px error table; RTT ping/pong; drift check
   (aim center at t=0 and t=10min). Exit: a written accuracy/jitter/drift
   report generated by the harness.
3. **Extrapolation + prediction PC-side.** IMPLEMENTED (lib/predict.ts):
   least-squares velocity over last ~120ms, projected age+20ms ahead (capped
   45ms), cursor loop pulls the prediction every 2ms; predictor resets on
   tracking lost. PREDICT_MS env tunes lookahead. Exit criterion still open:
   measured motion-to-cursor improvement needs the Phase-2 harness.
4. **Wireless mode.** mkcert cert flow documented; WebRTC DataChannel with
   perfect-negotiation pattern; auto-fallback to WS. Exit: cable-free play
   with p95 jitter < 15ms on 5GHz, and honest numbers printed comparing
   USB vs WiFi.
5. **Game integration.** Absolute input verified in MAME (`-lowlatency`,
   lightgun device settings), RetroArch cores, and one Sinden-compatible PC
   title. Windowed-game support: PC reads foreground window rect, maps u,v
   into it. Exit: Time Crisis–style title fully playable, shots land where
   aimed from two different standing positions.
6. **Polish.** Multi-gun (2 phones, distinct WS ids → two cursors/inputs
   where the game supports it), config persistence (last calibration method,
   smoothing, aspect), phone haptics on fire (`navigator.vibrate`), optional
   TS migration.

## Key algorithms (reference — implementations live in public/math.js, tested in test/math.test.ts)

- Forward from quat: rotate (0,0,−1) by pose orientation.
- Ray-plane: t = dot(origin−rayPos, n)/dot(rayDir, n), n = right×down;
  reject t≤0 and |denom|<1e−6. u = dot(rel,right)/dot(right,right), v same
  with down.
- Two-ray closest point: standard skew-lines midpoint; reject near-parallel
  (|den|<1e−8) and gap>0.12m.
- One Euro: slider s∈[0..1] → minCutoff = 1+5s Hz, beta = 0.5s, dCutoff=1.0,
  default s=0.4. At rest lag ≈ 1/(2π·minCutoff): 160ms @1Hz, 26ms @6Hz —
  minCutoff, not beta, is what fixes "cursor trails my aim" complaints.
  Reset on recalibration.

## Known pitfalls (all encountered or predicted in design — check here first)

- WebXR requires secure context: localhost tunnel, mkcert HTTPS (:8444), or
  the phone-side Chrome flag. `navigator.xr` undefined ⇒ opened via
  plain-HTTP IP without the flag. mkcert certs are per-IP: DHCP giving the PC
  a new address ⇒ regenerate, and never commit certs/.
- `adb reverse` mappings die on cable replug / adb restart; re-run it.
- Monitor is a bad ARCore surface (emissive, low texture): hit-test may land
  on the wall behind the screen — a constant few-cm offset that the u,v math
  mostly self-corrects; if hit-test finds nothing, that's what two-ray mode
  is for. Room clutter around the monitor improves tracking; blank walls and
  whip-pans cause `limited/lost` states — never send aim while lost.
- Anchors don't persist across sessions (browser support patchy): expect
  ~15s recalibration per session. Bumping the monitor invalidates calibration
  (anchors track the spot in space, not the object).
- Corner capture order is TL, TR, BL exactly; wrong order ⇒ mirrored/rotated
  cursor. Aspect check catches sloppy taps; predicted 4th corner is a
  further check worth adding.
- nut-js needs macOS Accessibility permission; Windows games in exclusive
  fullscreen sometimes ignore synthetic cursor moves ⇒ koffi/SendInput path.
- Static files must be in `public/`; path traversal guard exists in server.
- Overlay controls (FIRE, slider) start hidden via **inline** style, and JS
  reveals them with `style.display=""`. Never move the hiding into a CSS rule:
  clearing the inline style falls back to the stylesheet, so a CSS
  `display:none` can never be un-hidden that way (past bug: FIRE and the
  smoothing slider were unreachable — calibration worked, clicking didn't).
- Don't add smoothing PC-side on top of One Euro; don't let any queue of aim
  samples build anywhere (always newest-wins).
- Jitter matters more than average latency for feel. Any change should be
  judged by p95, not p50.
- Game-input UI must react on pointerDOWN. A `"click"` listener fires on
  finger RELEASE, silently adding the whole tap duration (~100ms) — this was
  the fire button's hidden latency for a while. Also: the phone no longer
  sends v1 `{"type":"fire"}` (fire is a buttons.json button now), but the
  server still handles it — protocol is additive, old clients stay valid.

## Working agreement for Claude Code

- Never break the working POC flow: `npm start` + adb tunnel + 3-corner
  calibration must always work on `main`. Test after refactors.
- `npm run validate` must pass before any change is done (husky enforces it
  on push); new logic ships with tests (coverage gate is 90%, don't game it
  with exclusions), prettier owns formatting, knip stays clean.
- Keep the phone page functional without a build step until Phase 6.
- Protocol changes are additive only; bump a `"v"` field if semantics change.
- Prefer measured numbers over assumptions: when touching latency-relevant
  code, run/extend the Phase-2 harness and report before/after p50/p95.
- Ask before adding dependencies beyond: ws, @nut-tree-fork/nut-js, koffi
  (Windows input path), mkcert (dev tooling, not a dep).
- Commit style: small commits per phase step, message prefix `P<phase>:`.

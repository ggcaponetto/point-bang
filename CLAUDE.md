# CLAUDE.md — Phone Lightgun (WebXR → PC)

Project brief and working agreement. Read fully before making changes.

## Commands

Requires Node ≥ 23.6 (native type stripping runs .ts directly — no build).

```
npm install
npm start                        # node cli.ts serve — http+ws on :8443
npm run start:adb                # USB flow only: runs `adb reverse` itself, no WiFi logs
npm run start:wifi               # WiFi flow only: https URLs (certs) or Chrome-flag URLs
npm run check                    # self-diagnosis: assets present? input addon loadable?
npm test                         # vitest + coverage, FAILS below 90% on any metric
npm run test:watch
npm run typecheck                # tsc --noEmit (strict; also checks public/math.js JSDoc)
npm run ip                       # LAN IPs, WiFi interface marked
npm run wifi                     # 2.4 vs 5 GHz check (netsh / nmcli / iw)
npm run format / format:check    # prettier (printWidth 100)
npm run knip                     # unused files/exports/deps — keep it clean
npm run validate                 # format:check + typecheck + knip + test
npm run build:sea                # single executable -> dist/point-bang[.exe]
npm run smoke                    # exercise the built executable

node cli.ts --help               # every option is a flag; npm start -- --port 9000
npm start -- --input none        # headless: print the aim, never touch the cursor
npm start -- --screen 2560x1440  # screen assumed when there is none to measure
npm start -- --pause-combo alt+p # tracking-pause hotkey (default shift+space; off = none)
npm start -- --no-qr             # skip the setup QR in the banner
npm start -- --key off           # disable the session key (trusted LAN); --key <v> pins one
npm start -- --page-url https://you.example/phone/   # QR targets a self-hosted page
npm run docs:build               # ALSO publishes public/ -> Pages /phone/ (build/pages.mjs)
                                 # AND builds site/ -> Pages /start/ (build/site.mjs)
npm run release -- patch         # bump package.json+lib/version.ts, validate, commit, tag
                                 # then: git push origin main vX.Y.Z -> release.yml ships binaries
npm run start:tunnel             # serve + ngrok in ONE process (needs a free authtoken)
npm run tunnel                   # ngrok ONLY, to run beside a plain `npm start`
npm start -- --tunnel ngrok --tunnel-url https://you.ngrok-free.app   # reserved domain
npm run tunnel -- --port 9000 --url https://you.ngrok-free.app
adb reverse tcp:8443 tcp:8443    # phone via USB; re-run after cable replug/adb restart
```

Every command is one CLI (`cli.ts`, yargs): `serve` (default), `tunnel`, `ip`,
`wifi`, `check`. Flags replaced the `PORT`/`PREDICT_MS` env vars — `FOO=bar cmd` is
bash-only syntax and this project's primary platform is Windows. Both env
vars are still honoured as defaults.

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
├── cli.ts             # THE entry (yargs): logic-free, works as script and as SEA
├── server.ts          # wires http/https + ws + cursor loop; no isMain block
├── lib/               # typed, unit-tested logic
│   ├── cli.ts         #   flag surface (buildParser) + command dispatch (runCli)
│   ├── protocol.ts    #   message types + parseMessage (never crash on garbage)
│   ├── buttons.ts     #   action parsing (key combos/mouse) + executor + config load
│   ├── cursor.ts      #   MouseLike interface, scaleToScreen, apply-latest loop
│   ├── jitter.ts      #   JitterWindow p50/p95/max
│   ├── predict.ts     #   AimPredictor: velocity fit + lookahead (opt-in, default OFF)
│   ├── static.ts      #   normalizeUrlPath + safeResolve (traversal) + content types
│   ├── assets.ts      #   AssetSource: public/ on disk OR embedded SEA assets
│   ├── certs.ts       #   optional mkcert TLS loading
│   ├── native.ts      #   loads libnut.node AND koffi: require in dev, extract+dlopen in a SEA
│   ├── input.ts       #   MouseLike/KeyboardLike over raw libnut
│   ├── hotkey.ts      #   pause combo: parser + GetAsyncKeyState/XQueryKeymap probes + poller
│   ├── virtual.ts     #   same interfaces, but PRINT the aim — headless/no-DISPLAY mode
│   ├── tunnel.ts      #   optional public HTTPS URL via the ngrok agent (opt-in)
│   ├── rtc.ts         #   WebRTC intake: offer→answer via werift behind PeerLike; DC→handleMessage
│   ├── cors.ts        #   allowlist CORS (hosted page + same-origin; NEVER *)
│   ├── qr.ts          #   setup QR: DEFAULT_PAGE_URL + LAN addrs in the fragment
│   ├── check.ts       #   `point-bang check` self-diagnosis
│   ├── version.ts     #   VERSION literal (no package.json inside an executable)
│   ├── net.ts         #   lanIPv4 + report formatting
│   └── wifi.ts        #   band detection: netsh / nmcli / iw, all locale-tolerant
├── build/
│   ├── sea.mjs        # esbuild -> sea-config -> postject. The ONLY core build step.
│   ├── pages.mjs      # copies PUBLIC_ASSETS + logo -> docs/public/ (docs:build step)
│   ├── site.mjs       # builds site/ -> docs/public/start/ (docs:build step)
│   ├── release.mjs    # semver bump (package.json + lib/version.ts) + validate + tag
│   └── smoke.mjs      # runs the built binary: --version/--help/ip/check
├── site/              # hosted start page: React + MUI + i18next (EN/DE/IT) — its own
│                      #   npm package ON PURPOSE (user request 2026-08-12): the only
│                      #   place a bundler exists; core stays buildless. WebXR check +
│                      #   player onboarding, published at /point-bang/start/.
├── assets/logo.svg    # crosshair-in-phone mark: docs favicon/brand, README, site hero
├── public/
│   ├── index.html     # phone page: XR/DOM glue only (script type=module)
│   ├── transport.js   # PC link: RTC-first ladder, WS fallback, LNA fetches (JSDoc,
│   │                  #   injectable Peer/Socket/fetch — tested like math.js)
│   ├── buttons.json   # 20 assignable buttons: label/action/visible/rect (phone + PC read it)
│   └── math.js        # phone math: V, OneEuro, intersectUV… (plain JS + JSDoc,
│                      #   imported by BOTH Chrome and vitest — keep it dependency-free)
├── test/              # vitest suites + fixtures/ (self-signed cert for https tests)
├── .gitattributes     # eol=lf everywhere — a CRLF clone breaks husky + prettier
├── .husky/            # pre-commit: prettier+typecheck; pre-push: npm run validate
└── .mcp.json          # context7 MCP server (up-to-date library docs in Claude Code)
```

Verified working end-to-end: phone calibrates, PC cursor follows aim.
Served on :8443. Dev transport is `adb reverse tcp:8443 tcp:8443` + phone
opening http://localhost:8443 (localhost = secure context, so no HTTPS needed;
USB = near-zero network jitter). Static files must live in `public/` — a past
bug was files placed flat next to the server causing 404s. They are also the
SEA asset list in `lib/assets.ts`; adding a file to `public/` means adding it
there too, or the executable 404s what the checkout serves fine.

WiFi testing (no adb): if mkcert certs exist in `certs/{cert.pem,key.pem}`
(next to the program — the repo root, or beside the executable; `--certs`
overrides), the server additionally serves https+wss on :8444 and prints LAN URLs; phone
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
- Post-calibration UI: the `visible` buttons from buttons.json (pointerdown/up
  → button down/up messages) — an entry with a `rect` ({x,y,w,h} in % of the
  screen) is absolutely placed in #btnLayer (defaults: big LEFT/RIGHT click
  buttons + A/B); without one it falls into the scrollable strip, "fire" into
  the big red slot — and the aim-adjust panel (nudge pad shifting sent u,v by
  0.5%/tap — applied AFTER the filter, zeroed on recalibrate — plus the
  smoothing slider).

What server.ts already contains:

- Apply-latest cursor pattern: only newest aim sample applied per ~2ms tick,
  never a queue of stale positions. `pyautogui`-style pause pitfalls avoided.
  `setMouseDelay(0)`/`setKeyboardDelay(0)` — libnut's defaults sleep inside
  button press/release (~200ms per fire click); moveMouse itself is 0.2ms.
- Jitter stats: prints p50/p95/max of (arrival − t) minus window-min every 2s.
  (Clock offset unknown → only jitter is meaningful, not absolute latency.)
- `fire` → left click via libnut.
- Pause hotkey (`--pause-combo`, default shift+space, `off` disables): a PC
  key combo toggles a gate that drops aim/fire/button-downs at the socket
  while paused (button-UPs still pass — nothing stays stuck down), so the
  real mouse can be used mid-session. Predictor resets on pause. Injectable
  as `pauseProbe` — server tests pass `pauseCombo: "off"` or a fake probe,
  never the real keyboard.

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
— ids/labels/actions/placement configured in `public/buttons.json` (single
source of truth: phone renders `visible` buttons from it where their `rect`
says, PC maps ids to key combos or mouse press/release via lib/buttons.ts and
reports malformed rects). down/up as separate events so holds work; keys
release in reverse order.

Transports (2026-08-12): the SAME JSON rides either the WS or a WebRTC
DataChannel — `server.ts` feeds both into one `handleMessage`. Signaling is
`POST /rtc/offer {"sdp","key"}` → `{"sdp"}` (400 bad/413 big/403
foreign-Origin or missing/wrong key); phone offers, PC answers via lib/rtc.ts.
Both intakes are gated by the session key (lib/auth.ts, 2026-08-12): a per-run
secret in the QR/URL fragment — WS presents it as `?key=`, signaling in the
body; loopback is exempt unless `serve --tunnel ngrok` (which forwards the
internet to loopback); `--key off` disables, `--key <v>` pins. Keys never ride
the query/path of the page URL — fragments don't reach the page host.

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
- **Cursor injection: the raw libnut addon** (`@nut-tree-fork/libnut-linux` /
  `-win32`), not the nut-js wrapper (user decision 2026-08-11, supersedes the
  original nut-js choice). Three reasons: nut-js's `bindings`-based module
  lookup cannot survive bundling into a single executable; it dragged `jimp`
  (~120 transitive packages) along for screen capture we never use; and we
  only need six calls — `moveMouse`, `mouseClick`, `mouseToggle`, `keyToggle`,
  `getScreenSize`, `set*Delay`. Key names in buttons.json are libnut's
  vocabulary (`control`, `f4`, `numpad_7`), validated at config load.
  If a game rejects synthetic input or needs true absolute injection, add a
  Windows-only path using `koffi` FFI → `SendInput` with
  `MOUSEEVENTF_ABSOLUTE`, behind the same interface.
- **Single executable via Node SEA** (user decision 2026-08-11). `cli.ts` is
  the only entry; `build/sea.mjs` bundles it to CJS with esbuild, lists
  `public/*` and `libnut.node` as SEA assets, and injects with postject. A
  SEA blob cannot hold a native addon, so `lib/native.ts` writes the addon
  (plus the Windows CRT DLLs) to a version-keyed temp dir and `process.dlopen`s
  it. **This is the only build step and nothing in the dev loop may depend on
  it** — `node cli.ts` must always run straight from source. Constraints it
  imposes: no top-level await in `cli.ts` (CJS), `import.meta.url` is rewritten
  by a define, and no cross-compiling (build on the OS you ship for).
- **Pause hotkey: poll global key state via koffi FFI** (user request
  2026-08-12). `--pause-combo` (default `shift+space`) toggles tracking so
  the real mouse works mid-session; resume without reconnecting. Reading is
  passive polling every 25ms — `GetAsyncKeyState` on Windows, one
  `XQueryKeymap` snapshot on X11 — NOT a hook or grab: nothing is swallowed,
  the focused game still receives the combo, and no admin rights are needed.
  koffi was already the sanctioned FFI dep; the raw `koffi.node` exposes the
  same `load`/`func` API as its npm wrapper, so the SEA extracts and dlopens
  it exactly like libnut (see the CRT pitfall below). Combos use the
  buttons.json key vocabulary (`lib/buttons.normalizeKey`); layout-dependent
  punctuation is rejected as unwatchable. Headless boxes and macOS degrade to
  a logged "pause hotkey: unavailable — reason", never a crash.
- **Public tunnel: drive the `ngrok` CLI, never its SDK** (user request
  2026-08-11). `--tunnel ngrok` gives the phone an HTTPS origin from any
  network — a secure context, so WebXR needs neither mkcert nor a Chrome flag,
  and `wss://` rides the same tunnel because the page derives its WS scheme
  from `location.protocol`. The `@ngrok/ngrok` SDK is a native addon and a SEA
  blob cannot hold one, so we spawn the binary, exactly as `lib/adb` and
  `lib/wifi` shell out. The URL is read from the agent's documented local API
  (`127.0.0.1:4040/api/tunnels`, matched on OUR port and `proto: https`), not
  scraped from log lines; an agent already running is adopted rather than
  fought with, since the free plan allows one session. `--log=stdout` is
  mandatory or the agent's full-screen TUI eats the terminal. Verified against
  agent 3.39: `--region` is deprecated (it auto-picks lowest latency) — hence
  `--tunnel-url` for a reserved domain instead. This is a setup convenience,
  NOT a play transport: it adds a public-internet round trip, and Phase 4's
  WebRTC plan is unaffected.
- **Transport:** WebSocket over the adb/USB tunnel is the dev default and a
  legitimate final mode (steady ~3ms, zero WiFi jitter, phone charges; wired
  guns are period-accurate). Wireless play mode (IMPLEMENTED 2026-08-12) =
  WebRTC DataChannel (`ordered:false, maxRetransmits:0`) to avoid TCP
  head-of-line stalls on WiFi; WS stays the automatic fallback when RTC
  negotiation fails on same-origin flows.
- **Consumer wireless setup: QR → GitHub Pages → Local Network Access →
  WebRTC** (user decision 2026-08-12; supersedes "mkcert HTTPS" as the
  wireless story — mkcert and the Chrome flag are demoted to fallbacks).
  Customers must never generate certificates. The industry patterns were
  native companion app (out: abandons the browser premise), Plex-style
  per-device certs (out: needs a domain + DNS + CA automation), and
  hosted-page + P2P — chosen. Mechanics: `docs:build` copies `public/` into
  `docs/public/phone/`, so the existing Pages workflow serves the page at
  https://ggcaponetto.github.io/point-bang/phone/ (real HTTPS ⇒ WebXR secure
  context, zero workflow changes, one source of truth). The startup QR
  encodes that URL plus up to 3 LAN addresses (WiFi first) in the FRAGMENT
  (never the query — it must not reach GitHub). Signaling is ONE
  `fetch(http://<pc>:8443/rtc/offer, {targetAddressSpace:"local"})` — Chrome
  142+ LNA exempts it from mixed content behind a one-tap permission prompt;
  **LNA covers fetch only, never WebSockets**, so from the Pages origin
  there is no WS and no fallback, and the failure message says what to
  check. The PC answers via `werift` (0.24.4 EXACT pin, pure TS — a native
  WebRTC addon cannot live in the SEA), vanilla ICE, `iceServers: []`
  (werift's default is a Google STUN — never dial out to talk across the
  room). CORS is an allowlist of the `--page-url` origin + same-origin, 403
  otherwise, `Access-Control-Allow-Private-Network: true` on preflight for
  pre-142 Chromes. buttons.json is fetched FROM THE PC in remote mode so the
  customer's local config beats the published copy.
- **Session key on every network intake** (user request 2026-08-12: "somebody
  else on the LAN might control my pc — we don't want that"). CORS never
  protected against non-browser clients (no Origin header ⇒ allowed), so a
  per-run secret gates the WS upgrade (`?key=`) and `/rtc/offer` (body field).
  It travels ONLY in URL fragments (QR, printed URLs, tunnel URL) — never the
  query, which would reach the page host. Loopback exempt by default so the
  adb flow stays typeable; `serve --tunnel ngrok` drops the exemption (agent
  forwards the internet to loopback). The standalone `tunnel` command cannot
  enforce it and says so. Timing-safe compare; `--key off|auto|<value>`.
- **Filtering split:** One Euro filter phone-side (kills ARCore micro-jumps;
  adaptive: smooth when slow, responsive when flicking). Extrapolation
  PC-side (fit velocity over last samples, project to now; hides network
  jitter and ~1 frame of delay) — but OFF by default (user decision
  2026-08-11): the projected lead reads as the cursor running ahead of aim,
  clearest in raw-aim mode, and the user rejected the feel. `--predict-ms 0`
  now means a strict newest-sample passthrough (no age projection either);
  positive values opt back in for harness experiments. Don't double-smooth,
  and don't raise the default back above 0 without a user decision.
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
3. **Extrapolation + prediction PC-side.** IMPLEMENTED but OFF BY DEFAULT
   (lib/predict.ts; user decision 2026-08-11 — the lead felt wrong, see Tech
   decisions): least-squares velocity over last ~120ms, projected age+N ms
   ahead (capped 45ms), cursor loop pulls the target every 2ms; predictor
   resets on tracking lost. `--predict-ms N` opts in; 0 (default) is a strict
   newest-sample passthrough. Exit criterion still open: the Phase-2 harness
   must show a measured motion-to-cursor win before it can ever default on.
4. **Wireless mode.** IMPLEMENTED 2026-08-12 (see the QR tech decision):
   scan-to-play QR, Pages-hosted page, LNA signaling, WebRTC DataChannel
   over the LAN, WS auto-fallback on same-origin flows. Exit criterion
   STILL OPEN: cable-free play with p95 jitter < 15ms on 5GHz, and honest
   numbers printed comparing USB vs WiFi — needs a phone-in-hand session.
5. **Game integration.** Absolute input verified in MAME (`-lowlatency`,
   lightgun device settings), RetroArch cores, and one Sinden-compatible PC
   title. Windowed-game support: PC reads foreground window rect, maps u,v
   into it. Exit: Time Crisis–style title fully playable, shots land where
   aimed from two different standing positions.
6. **Polish.** Multi-gun (2 phones, distinct WS ids → two cursors/inputs
   where the game supports it), config persistence (last calibration method,
   smoothing, aspect), phone haptics on fire (`navigator.vibrate`).
   Distribution is done: `npm run build:sea` ships a single executable for
   Windows and Linux, built and smoke-tested per-OS in CI, and
   `npm run release` + a tag push publishes them as GitHub Release
   artifacts (release.yml, 2026-08-12). Quality tracking: Codecov +
   SonarQube Cloud run in CI once the CODECOV_TOKEN/SONAR_TOKEN secrets
   exist; badges live in README and on /start/.

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
- **koffi.node must NEVER be extracted next to libnut's bundled VC++ runtime
  DLLs.** `process.dlopen` uses LOAD_WITH_ALTERED_SEARCH_PATH, so siblings
  satisfy CRT imports first — and koffi, built against a newer MSVC than
  libnut's shipped msvcp140/vcruntime140, access-violates (0xC0000005) on its
  first call under the old ones. That is why `loadKoffi` extracts into a
  `koffi/` SUBdirectory of the cache dir. Verified: side-by-side crashes,
  separate dirs work in either load order.
- Pause-hotkey limits: polling sees synthetic keys too (our own injected
  combos would trigger it — don't map a phone button to the pause combo). On
  Wayland the X11 keymap only updates while an X11/Xwayland window has focus
  (Proton/X11 games: fine; native Wayland apps: keys invisible). Headless =
  hotkey off with a logged reason. The combo is NOT swallowed — the focused
  game still receives it, so pick one the game ignores.
- libnut on Linux needs X11 + the XTEST extension (`libx11`, `libxtst`);
  Wayland needs Xwayland and a headless box cannot inject at all. Worse, with
  the libs present but no `DISPLAY`, libnut prints "Could not open main
  display" and **kills the process** — it does not throw, so no try/catch can
  save you. `lib/check.ts` and `startServer` both guard on `hasDisplay()`
  _before_ calling in (`serve` falls back to the printing devices in
  `lib/virtual.ts`); keep any new native call behind the same guard. Windows games in exclusive
  fullscreen sometimes ignore synthetic cursor moves ⇒ koffi/SendInput path.
- Windows raises a Defender Firewall prompt on the first `serve`; dismissing
  it silently breaks the WiFi flow while USB keeps working. The rule is
  **per-executable path**: node.exe being allowed says nothing about
  dist\point-bang.exe (verified 2026-08-12 — npm flow connected, exe did
  not), and DENYING the prompt writes a permanent Block rule that
  suppresses future prompts for that binary. Troubleshooting documents the
  admin-PowerShell check/fix.
- `--tunnel ngrok` publishes a socket that moves the mouse and presses keys to
  the public internet. Since the session key (2026-08-12) it is authenticated —
  `serve --tunnel ngrok` drops the loopback exemption so tunnel traffic must
  present the key — but the full printed URL (`#key=…`) is still the
  credential, and the banner says so; do not quiet it. The standalone `tunnel`
  command CANNOT enforce the key (a separately-started server sees its traffic
  as exempt loopback) and warns accordingly.
  Other tunnel facts, all confirmed against agent 3.39: the free plan
  shows a one-time ERR_NGROK_6024 interstitial to browsers (tap "Visit Site" —
  the `ngrok-skip-browser-warning` header cannot help a phone that is simply
  navigating), allows one agent session at a time, and gives a random URL
  unless a reserved one is passed. The agent attaches `err` to routine `info`
  records too, so only `eror`/`crit` levels may be reported as a failure — and
  its real errors are multi-line with CRLF, so flatten before logging.
- Static files must be in `public/`; path traversal guard exists in server.
- **LNA covers `fetch()` only — never WebSockets.** From the Pages origin,
  `ws://<lan-ip>` is mixed content with no exemption; the only data path is
  the DataChannel, and transport.js deliberately never constructs a WS in
  remote mode. Do not "add the WS fallback" there — it cannot work.
- `qrcode-terminal`'s `generate` reads its error-correction level off `this`:
  a detached reference (`const g = qrcode.generate`) throws
  "bad rs block @ … errorCorrectLevel:undefined". lib/qr.ts wraps it in an
  arrow for exactly this reason.
- CORS on the server is an allowlist (the `--page-url` origin + same-origin
  via the Host header) — never loosen it to `*`: `/rtc/offer` ends at the
  mouse and keyboard. Same-origin browser POSTs DO send an Origin header,
  which is why the Host comparison exists; removing it breaks the localhost
  and tunnel flows.
- Chrome obfuscates its host ICE candidates as mDNS `.local` names; werift
  connects anyway because the phone reaches the PC's real-IP candidate and
  the PC learns the phone peer-reflexively from its STUN checks. WiFi
  **client isolation** (hotel/guest networks) blocks exactly this — the
  signaling fetch succeeds but the DataChannel never opens.
- The Pages copy of the phone page is GENERATED (`docs/public/` is
  gitignored; `build/pages.mjs` fills it during `docs:build`). Never commit
  files there and never edit them — edit `public/` and rebuild.
- **No `FOO=bar cmd` in scripts or docs** — cmd.exe and PowerShell both reject
  it. Add a CLI flag instead. Likewise no `cp`/`rm`/`mkdir` in npm scripts:
  `build/*.mjs` are Node programs precisely so they run on both shells.
- Missing `.gitattributes` was a latent Windows-only breakage: `core.autocrlf`
  rewrites the husky hooks (MSYS `sh` chokes on `\r`), the PEM fixtures, and
  makes `prettier --check` fail on a fresh clone. It is pinned to `eol=lf`.
- Anything parsing external command output must split on `/\r?\n/` — Windows
  tools emit CRLF and a bare `"\n"` split leaves a `\r` that eats the line.
- Linux WiFi interfaces are `wlp2s0`/`wlx…`, matching neither "wifi" nor
  "wlan" — `lib/net.ts` matches `^wl` for that reason.
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
- Everything must work on **Windows and Linux**. Platform-specific behavior
  goes in `lib/` behind an injectable function (`exec`, `platform`) so both
  paths are unit-testable from either machine — never a bare `process.platform`
  check inline. CI runs the gates on both OSes.
- `npm run validate` must pass before any change is done (husky enforces it
  on push); new logic ships with tests (coverage gate is 90%, don't game it
  with exclusions), prettier owns formatting, knip stays clean.
- Keep the phone page functional without a build step until Phase 6.
- Protocol changes are additive only; bump a `"v"` field if semantics change.
- Prefer measured numbers over assumptions: when touching latency-relevant
  code, run/extend the Phase-2 harness and report before/after p50/p95.
- Ask before adding dependencies beyond: ws, yargs, @nut-tree-fork/libnut-*,
  esbuild + postject (SEA build only), koffi (IN USE since 2026-08-12: pause
  hotkey key-state; also the future SendInput path), werift (IN USE since
  2026-08-12: WebRTC PC-side — pinned EXACT, pure TS on purpose), qrcode-terminal
  (setup QR), mkcert (dev tooling, not a dep).
- knip ignores the `@nut-tree-fork/libnut-*` packages: they are resolved by a
  computed specifier at runtime, so static analysis can't see them.
- Commit style: small commits per phase step, message prefix `P<phase>:`.

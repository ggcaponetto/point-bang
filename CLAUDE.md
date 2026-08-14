# CLAUDE.md — Phone Lightgun (WebXR → PC)

Project brief and working agreement. Read fully before making changes.

## Commands

Requires Node ≥ 23.6 (native type stripping runs .ts directly — no build for
the PC side or the phone page; the button editor is the one built artifact,
see the editor tech decision).

```
npm install                      # ONE install: npm workspaces (root + editor + site)
npm start                        # node cli.ts serve — http+ws on :8443
npm run start:adb                # USB flow only: runs `adb reverse` itself, no WiFi logs
npm run start:wifi               # WiFi flow only: QR (hosted page + LNA) + Chrome-flag fallback
npm run check                    # self-diagnosis: assets present? input addon loadable?
npm test                         # vitest + coverage, FAILS below 90% on any metric
npm run test:watch
npm run typecheck                # tsc --noEmit (strict; also checks public/math.js JSDoc)
npm run ip                       # LAN IPs, WiFi interface marked
npm run wifi                     # 2.4 vs 5 GHz check (netsh / nmcli / iw)
npm run monitors                 # list monitors + the indices --monitor takes
npm start -- --monitor 2         # aim at monitor 2; 'all' spans every monitor
npm run format / format:check    # prettier (printWidth 100)
npm run knip                     # unused files/exports/deps — keep it clean
npm run loc                      # LOC budget gate: FAILS above 50k non-blank source lines
npm run validate                 # format:check + typecheck + knip + loc + test + editor validate
npm run build:editor             # editor workspace -> public/editor.html (serve auto-runs it)
npm run -w editor dev            # editor dev server (proxies /buttons* to :8443)
npm run -w editor test           # editor vitest (jsdom; model/i18n gated at 90%)
npm run build:sea                # single executable -> dist/point-bang[.exe] (builds editor first)
npm run smoke                    # exercise the built executable

node cli.ts --help               # every option is a flag; npm start -- --port 9000
                                 # a busy DEFAULT port falls back to a free one (all
                                 # printed URLs follow); a busy EXPLICIT --port refuses
npm start -- --input none        # headless: print the aim, never touch the cursor
npm start -- --screen 2560x1440  # screen assumed when there is none to measure
npm start -- --pause-combo alt+p # tracking-pause hotkey (default shift+s; off = none)
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
`wifi`, `check`. Flags replaced the `PORT` env var — `FOO=bar cmd` is
bash-only syntax and this project's primary platform is Windows. The env var
is still honoured as a default.

REMOVED SURFACE (user decision 2026-08-13 — do not reintroduce): `--predict-ms`
and all cursor prediction/lookahead (the cursor shows exactly the newest phone
sample; lib/predict.ts is gone, superseding the 2026-08-11 "off by default"
decision); mkcert HTTPS/`--certs`/`--https-port`/:8444 (wireless is the QR
flow — hosted page + Local Network Access + WebRTC — with the Chrome flag as
the only fallback; there is no https/wss server anymore); `--no-qr` (the QR
always prints outside adb mode — there is no use case for hiding it).

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
WebXR gives top-class latency (~15–30ms phone-side; the user-facing wording —
"gyro" has a bad reputation) WITH absolute aim, because
ARCore fuses IMU at high rate and only corrects with the camera. Commercial
guns (Sinden = camera + white screen border, Gun4IR/AimTrak = IR beacons) don't
use this approach; the only prior art is a hobbyist native app
(github.com/Wosk1947/LightGun, Huawei AR Engine). This niche is open.

## Current state — WORKING POC (do not break)

```
./
├── cli.ts             # THE entry (yargs): logic-free, works as script and as SEA
├── server.ts          # wires http + ws + cursor loop; no isMain block
├── lib/               # typed, unit-tested logic
│   ├── cli.ts         #   flag surface (buildParser) + command dispatch (runCli)
│   ├── protocol.ts    #   message types + parseMessage (never crash on garbage)
│   ├── buttons.ts     #   button config validation + executor (action parsing lives in math.js)
│   ├── buttonstore.ts #   THE buttons.json at runtime: live file > asset copy; editor save target
│   ├── cursor.ts      #   MouseLike interface, scaleToScreen, apply-latest loop
│   ├── jitter.ts      #   JitterWindow p50/p95/max
│   ├── static.ts      #   normalizeUrlPath + safeResolve (traversal) + content types
│   ├── assets.ts      #   AssetSource: public/ on disk OR embedded SEA assets
│   ├── native.ts      #   loads libnut.node AND koffi: require in dev, extract+dlopen in a SEA
│   ├── input.ts       #   MouseLike/KeyboardLike over raw libnut
│   ├── hotkey.ts      #   pause combo: parser + GetAsyncKeyState/XQueryKeymap probes + poller
│   ├── virtual.ts     #   same interfaces, but PRINT the aim — headless/no-DISPLAY mode
│   ├── tunnel.ts      #   optional public HTTPS URL via the ngrok agent (opt-in)
│   ├── rtc.ts         #   WebRTC intake: offer→answer via werift behind PeerLike; DC→handleMessage
│   ├── cors.ts        #   allowlist CORS (hosted page + same-origin; NEVER *)
│   ├── qr.ts          #   setup QR: DEFAULT_PAGE_URL + LAN addrs in the fragment
│   ├── editorbuild.ts #   serve's editor auto-build: mtime staleness, never fatal
│   ├── check.ts       #   `point-bang check` self-diagnosis
│   ├── version.ts     #   VERSION literal (no package.json inside an executable)
│   ├── net.ts         #   lanIPv4 + report formatting
│   ├── monitors.ts    #   monitor rects: EnumDisplayDevices (koffi) / xrandr; --monitor + `monitors`
│   └── wifi.ts        #   band detection: netsh / nmcli / iw, all locale-tolerant
├── build/
│   ├── sea.mjs        # esbuild -> sea-config -> postject; builds the editor first
│   ├── pages.mjs      # copies PHONE_ASSETS + logo -> docs/public/ (docs:build step)
│   ├── site.mjs       # builds the site workspace -> docs/public/start/ (docs:build)
│   ├── release.mjs    # semver bump (package.json + lib/version.ts) + validate + tag
│   └── smoke.mjs      # runs the built binary: --version/--help/ip/check
├── editor/            # the button editor: Vite + React + MUI + i18next WORKSPACE
│   ├── src/model.ts   #   the pure editor logic (was public/editor.js) — 90% gated
│   ├── src/locales.ts #   EN/DE/IT catalogs (was editor-i18n.js; flat keys, {param})
│   ├── src/...        #   components: PhoneCanvas drag/resize, tabbed InspectorPanel
│   └── test/          #   own vitest (jsdom): model/i18n gated, app smoke-rendered
├── site/              # hosted start page: React + MUI + i18next (EN/DE/IT) — a
│                      #   workspace since 2026-08-13 (root lockfile), still excluded
│                      #   from validate/knip: only docs:build pays for its build.
│                      #   WebXR check + onboarding, published at /point-bang/start/.
├── assets/logo.svg    # crosshair-in-phone mark: docs favicon/brand, README, site hero
├── public/
│   ├── index.html     # phone page: XR/DOM glue only (script type=module)
│   ├── transport.js   # PC link: RTC-first ladder, WS fallback, LNA fetches (JSDoc,
│   │                  #   injectable Peer/Socket/fetch — tested like math.js)
│   ├── buttons.json   # 20 assignable buttons: label/action/visible/rect (phone + PC read it)
│   ├── editor.html    # GENERATED (gitignored): the editor workspace's single-file
│   │                  #   build output — never edit or commit it; serve rebuilds it
│   └── math.js        # phone math + the shared button vocabulary: V, OneEuro, intersectUV,
│                      #   normalizeKey/parseAction… (plain JS + JSDoc, imported by
│                      #   Chrome, vitest AND the editor bundle — keep it dependency-free)
├── test/              # vitest suites
├── .gitattributes     # eol=lf everywhere — a CRLF clone breaks husky + prettier
├── .husky/            # pre-commit: prettier+typecheck; pre-push: npm run validate
└── .mcp.json          # context7 MCP server (up-to-date library docs in Claude Code)
```

Verified working end-to-end: phone calibrates, PC cursor follows aim.
Served on :8443. Dev transport is `adb reverse tcp:8443 tcp:8443` + phone
opening http://localhost:8443 (localhost = secure context, so no HTTPS needed;
USB = near-zero network jitter). Static files must live in `public/` — a past
bug was files placed flat next to the server causing 404s. They are also the
SEA asset list in `lib/assets.ts` (split 2026-08-13: `PHONE_ASSETS` are the
committed sources that also publish to Pages; `editor.html` is the GENERATED
editor bundle — never commit or hand-edit it, and never publish it to Pages);
adding a file to `public/` means adding it to the right list too, or the
executable 404s what the checkout serves fine.

WiFi (no adb): the QR flow — hosted page + Local Network Access + WebRTC —
is THE wireless story (see the tech decision below). The only fallback is
the Chrome flag `#unsafe-treat-insecure-origin-as-secure` with
http://<PC-IP>:8443, printed in wifi mode. There is NO https/wss server:
mkcert/TLS support was removed 2026-08-13 (user decision — customers must
never touch certificates, and the QR flow needs none). :8443 http must
never break.

What index.html already contains (reuse, don't reinvent):

- XR session boilerplate: `immersive-ar`, required `hit-test` + `dom-overlay`,
  optional `local-floor` (fallback `local`) + `anchors`; throwaway WebGL layer
  (AR sessions must render; we clear to transparent).
- Two calibration methods behind a UI toggle (user decision 2026-08-13:
  **two-ray is the DEFAULT and the recommended method** — monitors are bad
  ARCore surfaces, so hit-test demoted from default to alternative; keep the
  docs recommending two-ray):
  1. **two-ray** (default): aim at 3 screen corners (TL, TR, BL), 2 captures
     per corner from positions ≥50cm apart; closest-point-between-two-rays;
     captures with >12cm ray gap are rejected with a retry prompt. Needs no
     trackable surface.
  2. **hit-test**: CAPTURE each corner once; each corner gets an XRAnchor;
     corner positions are re-read from anchor poses every frame so
     calibration self-corrects — when ARCore finds a surface at all.
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
  buttons + A/B); without one it falls into the scrollable strip (no special
  ids — the trigger is just b0) — and the aim-adjust panel (nudge pad shifting sent u,v by
  0.5%/tap — applied AFTER the filter, zeroed on recalibrate — plus the
  smoothing slider, plus — multi-monitor only — the SWAP button that reassigns
  the aimed plane to the next monitor if calibration was done in the wrong
  order; see Protocol v2).

What server.ts already contains:

- Apply-latest cursor pattern: only newest aim sample applied per ~2ms tick,
  never a queue of stale positions. `pyautogui`-style pause pitfalls avoided.
  `setMouseDelay(0)`/`setKeyboardDelay(0)` — libnut's defaults sleep inside
  button press/release (~200ms per fire click); moveMouse itself is 0.2ms.
- Jitter stats: prints p50/p95/max of (arrival − t) minus window-min every 2s.
  (Clock offset unknown → only jitter is meaningful, not absolute latency.)
- `fire` → left click via libnut.
- Pause hotkey (`--pause-combo`, default shift+s, `off` disables): a PC
  key combo toggles a gate that drops aim/fire/button-downs at the socket
  while paused (button-UPs still pass — nothing stays stuck down), so the
  real mouse can be used mid-session. The pending aim sample is cleared on
  pause so resume cannot flick the cursor. Injectable
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
reports malformed rects/vibrate values). down/up as separate events so holds
work; keys release in reverse order. Per-button haptics (2026-08-12): optional
`vibrate` — absent/true = 10ms tick, false = off, number = pulse ms (cap 100;
`normalizeVibrate` in math.js) — fired phone-side on pointerdown only. Kept
VERY short by user requirement (Time-Crisis rapid fire) and because the motor
shakes the IMU ARCore tracks; per-button `false` is the escape hatch if aim
wobbles on fire. iOS has no vibration API — silent no-op.

Edge + gamepad triggers (2026-08-13, additive buttons.json fields — the wire
messages are ordinary `button` down/up, so servers need nothing): optional
per-button `edge` ("left"|"right"|"top"|"bottom"|"any") presses the button
when aim is held past that screen edge >150ms and releases the INSTANT aim
comes back on screen / is lost / crosses to another edge — the Time Crisis
reload/duck, generalized to all four edges ("any" = every edge; `EdgeGesture`
in math.js; fed RAW pre-filter aim so smoothing lag can never delay the
release; margin 0.1 so ordinary edge-of-screen play and typical inter-monitor
bezels don't false-trigger). Several buttons may share an edge and "any"
fires alongside a specific assignment — the fan-out mirrors the pad model
exactly (per-edge target arrays + an any-list + held-set bookkeeping); the
old one-button-per-edge rule was dropped 2026-08-13. Optional
per-button `pad` (gamepad button index, or "any" for one-button BT clickers)
presses it from a physical Bluetooth control via the poll-only Gamepad API
(`diffPressed` in math.js, sampled every XR frame across all connected pads);
the HUD shows the index of the last physical press so any device's layout is
discoverable. Edge/pad assignments work on INVISIBLE buttons too — a reload
button needs no on-screen spot. Both release forcibly on recalibrate and on a
live config reload (nothing sticks down); the editor exposes an edge dropdown
and a pad field per button. Volume-key capture during XR remains untested.

v2 (IMPLEMENTED 2026-08-12, additive): `aim`/`calib` gain optional `m` = 1-based
monitor index (per-monitor calibration). The phone learns the aim targets via
`GET /monitors` → `{"monitors":[{"i","label","w","h","primary"}]}` (labels +
resolutions only, no layout coordinates; CORS'd and ungated like buttons.json —
the aim intakes stay key-guarded). >1 targets ⇒ the phone calibrates one plane
per monitor and tags aim with `m`; the PC maps it into that monitor's rect and
drops the pending sample on a switch. Aim without `m` (old phone page) maps into
the spanning rect; an old server 404s `/monitors` and the phone stays
single-plane — compatible in both directions.

Transports (2026-08-12): the SAME JSON rides either the WS or a WebRTC
DataChannel — `server.ts` feeds both into one `handleMessage`. Signaling is
`POST /rtc/offer {"sdp","key"}` → `{"sdp"}` (400 bad/413 big/403
foreign-Origin or missing/wrong key); phone offers, PC answers via lib/rtc.ts.
Both intakes are gated by the session key (lib/auth.ts, 2026-08-12): a per-run
secret in the QR/URL fragment — WS presents it as `?key=`, signaling in the
body; loopback is exempt unless `serve --tunnel ngrok` (which forwards the
internet to loopback); `--key off` disables, `--key <v>` pins. Keys never ride
the query/path of the page URL — fragments don't reach the page host.

v2 (IMPLEMENTED 2026-08-12, additive): calibration indicator + monitor swap.
`{"type":"calib","stage":"target","m":k}` = "about to capture corners of
monitor k" — the PC parks the cursor at that monitor's center so the user aims
at the right panel (wrong-order calibration was how aim ended on the wrong
monitor). Sent before EVERY corner prompt on purpose: sends are fire-and-forget
and the DataChannel is lossy, so the idempotent re-send is the loss recovery —
no sticky server state anywhere. While multi-monitor calibration is incomplete
the phone tags aim with `cal:1` and the PC drops those samples (the parked
cursor must not be fought by aim from already-done planes); resume is the
absence of the tag. Plane→monitor assignment is PHONE state only — `m` is just
the slot index + 1 — so the post-calibration SWAP button in the aim panel
permutes the per-monitor arrays (`swapMonitorSlots` in math.js) and the server
needs no swap awareness; it drops the pending sample on the `m` change anyway.

v2 (IMPLEMENTED 2026-08-13, additive): live button config. The FIRST
server→client message: `{"type":"buttons","rev":N}` = "config changed,
re-fetch buttons.json and re-render" — sent once per WS client, and 3× over
each DataChannel (0/150/400ms; that transport is lossy) with the per-run
monotonic `rev` as the dedupe. Old phones have no message listener and ignore
it. Producer: `POST /buttons {"key?","config"}` (the editor page at
/editor.html, printed in the banner) — /rtc/offer's guard ladder (403 CORS /
413 / 403 key / 400 shape), then STRICT validation (any parse problem ⇒ 400 +
problems, nothing written), atomic write, live executor swap (no restart),
push. Reads and writes go through `lib/buttonstore.ts`: ONE resolved file
(explicit `--buttons` > `public/buttons.json` in a checkout > `buttons.json`
next to the SEA exe, absent = baked asset copy) that `GET /buttons.json` also
serves — the phone and the PC map can no longer disagree (pre-editor,
`--buttons` changed only the PC map). Phone-side: `transport.js` gained
`parseServerMessage` + an `onMessage` hook, and index.html's `renderButtons`
is idempotent (held buttons get a forced `pointercancel` → button-up before
the rebuild, so nothing sticks down mid-session; calibration state untouched).

Still planned (additive): `{"type":"ping","t":...}` / `{"type":"pong",...}`
for RTT, aim gains optional `du,dv` velocity for PC-side extrapolation.

## Tech decisions (already made — with rationale; don't relitigate silently)

- **TypeScript PC-side, no build step** (user decision 2026-08-10, supersedes
  the original all-JS choice; AMENDED 2026-08-13 — see the editor decision
  below: the BUTTON EDITOR is now a built React workspace, everything else
  keeps this rule). Node ≥23.6 native type stripping runs .ts
  directly — so keep to erasable syntax only (no enums/namespaces/parameter
  properties; `erasableSyntaxOnly` enforces this). Phone page stays buildless:
  inline JS glue + `public/math.js` ES module (plain JS + JSDoc, type-checked
  via `checkJs`, imported by both Chrome and vitest). Don't introduce a
  bundler or a compile step into the PHONE page or the PC side; edit + phone
  reload beats a bundler for tuning.
- **The button editor is a Vite + React + MUI + i18next workspace** (user
  decision 2026-08-13, deliberately superseding "no bundler anywhere": the
  editor will keep growing and needed a solid basis + a better UI than the
  long scrollable column). Repo is npm workspaces now (root + `editor/` +
  `site/`, ONE root lockfile; root `overrides` pins ONE react 19 — vitepress
  drags an optional react-18 peer that would otherwise split MUI and the app
  across two React copies). vite-plugin-singlefile builds the whole app into
  the single generated `public/editor.html`, which is why `lib/assets.ts`,
  the SEA and the `/editor.html` URL needed no structural change. `serve`
  auto-builds it when missing/stale (`lib/editorbuild.ts`, never fatal);
  `build/sea.mjs` rebuilds it unconditionally. The editor package owns its
  tests (jsdom vitest; `src/model.ts` = the old editor.js logic + locales
  gated at 90%, React glue smoke-tested only) and joins `validate`/CI via
  `npm run -w editor validate`. Dev loop: `npm run -w editor dev` proxies
  /buttons* to a running `npm start`. The editor is NOT published to Pages
  (pages.mjs copies PHONE_ASSETS only — it works only against the local PC).
- **Vitest, 90% coverage enforced** (same decision). Thresholds live in
  vitest.config.ts; `npm test` fails below 90% on any metric. Logic goes in
  `lib/` or `public/math.js` where it's unit-testable (editor logic:
  `editor/src/model.ts` under the editor package's own identical gate);
  entry files stay thin with `isMain` guards. Server behavior is
  integration-tested with an injected fake MouseLike — tests must never move
  the real cursor or click.
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
  it. **Nothing in the dev loop may depend on it** — `node cli.ts` must always
  run straight from source (since 2026-08-13 sea.mjs also runs the editor
  workspace build first, so release artifacts never bake a stale editor —
  that build has its own auto-run in `serve` and never blocks the dev loop
  either). Constraints it
  imposes: no top-level await in `cli.ts` (CJS), `import.meta.url` is rewritten
  by a define, and no cross-compiling (build on the OS you ship for).
- **Pause hotkey: poll global key state via koffi FFI** (user request
  2026-08-12). `--pause-combo` (default `shift+s`) toggles tracking so
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
  network — a secure context, so WebXR needs no Chrome flag, and `wss://`
  rides the same tunnel because the page derives its WS scheme from
  `location.protocol`. The `@ngrok/ngrok` SDK is a native addon and a SEA
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
  WebRTC** (user decision 2026-08-12; 2026-08-13 the mkcert HTTPS path was
  REMOVED outright — the Chrome flag is the sole fallback now).
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
- **Multi-monitor: enumerate via EnumDisplayDevicesW/EnumDisplaySettingsExW
  (koffi) on Windows, `xrandr --query` on Linux** (2026-08-12). libnut only
  knows the primary screen; `EnumDisplayMonitors` was rejected because it
  needs a C callback and the minimal `Ffi` type (load+func only) deliberately
  has none — the chosen pair works with Buffer out-params, the same trick as
  `XQueryKeymap`. Struct offsets in lib/monitors.ts were verified live on a
  real negative-origin dual-monitor box, and the fake-Ffi tests write buffers
  at those exact offsets. Selection semantics: default `primary` degrades to
  the old whole-screen behavior when detection fails (never regress, headless
  CI included); explicit `--monitor all|N` that can't be honored refuses to
  start. `--monitor` maps aim only — cursor injection already spans the
  virtual desktop. With `--monitor all` the phone calibrates EACH monitor as
  its own plane (user decision 2026-08-12): one spanning plane is physically
  wrong — bezels add distance that contains no pixels and monitors may be
  angled — so aim carries a per-monitor index instead (see Protocol v2), and
  smoothing/nudge state is per monitor with resets at the seam.
- **Filtering: One Euro phone-side, NOTHING PC-side** (user decision
  2026-08-13, supersedes the 2026-08-11 "prediction off by default"). All
  PC-side extrapolation/lookahead was REMOVED — lib/predict.ts is gone; the
  cursor loop pulls the strict newest sample and that is the whole story.
  History for context: prediction was tried, the projected lead read as the
  cursor running ahead of aim, the user rejected the feel and later ordered
  the code path deleted. Do not reintroduce any lookahead, and don't add
  smoothing PC-side on top of One Euro.
- **Latency budget** (measured targets): phone-side pose→send < 20ms typical;
  transport jitter p95 < 5ms on USB; motion-to-cursor (slow-mo camera test)
  30–60ms. Game+display adds 30–80ms on top and dominates — that's tuned in
  the game/OS (exclusive fullscreen, monitor game mode, MAME `-lowlatency`),
  not in our code.

## Roadmap (each phase has an exit criterion; finish one before the next)

1. **Buttons & gestures.** MOSTLY DONE 2026-08-13: off-screen edge gestures
   (any edge → any configured button, hold semantics) and physical triggers
   via the Gamepad API (`edge`/`pad` in buttons.json, see Protocol v2) are
   implemented; start/coin are just buttons.json entries via the editor.
   Still open: volume-key capture as trigger if the browser allows it
   in-session (test; may not fire during XR), and the phase exit criterion:
   play a browser duck-hunt clone with off-screen reload working.
2. **Measurement harness.** PC test page (fullscreen grid of dots) + logging:
   click each dot's aim, output px error table; RTT ping/pong; drift check
   (aim center at t=0 and t=10min). Exit: a written accuracy/jitter/drift
   report generated by the harness.
3. **Extrapolation + prediction PC-side.** CLOSED — REMOVED 2026-08-13 (user
   decision, see the Filtering tech decision): the phase was implemented,
   rejected on feel, and finally deleted. The cursor is a strict
   newest-sample passthrough; this phase must not be reopened.
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

- WebXR requires a secure context: the hosted (QR) page, http://localhost via
  the adb tunnel, an ngrok URL, or the phone-side Chrome flag. `navigator.xr`
  undefined ⇒ opened via plain-HTTP IP without the flag.
- `adb reverse` mappings die on cable replug / adb restart; re-run it.
- Monitor is a bad ARCore surface (emissive, low texture): hit-test may land
  on the wall behind the screen — a constant few-cm offset that the u,v math
  mostly self-corrects; if hit-test finds nothing, that's why two-ray mode
  is the default. Room clutter around the monitor improves tracking; blank walls and
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
- Port semantics follow the --monitor precedent (2026-08-13): a busy DEFAULT
  port degrades to an OS-assigned free one (bind 0 — every printed URL/QR uses
  the RESOLVED port, and adb reverse runs AFTER the bind on that port); a busy
  explicit `--port`/`PORT` refuses with a clean one-liner (code EADDRINUSE, the
  CLI prints message-only). Don't relitigate. Also: ws's WebSocketServer
  FORWARDS the attached http server's 'error' events — a WSS without an
  'error' listener turns a bind failure into an unhandled throw mid-emit that
  aborts the server's own error handling; the no-op listeners in startServer
  are what keep EADDRINUSE catchable.
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
- Multi-monitor traps: a monitor left of/above the primary has a NEGATIVE
  origin (dmPosition is signed — `readInt32LE`, and no pixel-coordinate
  sentinel like (-1,-1) is safe); node.exe is DPI-unaware, so DEVMODE's
  physical pixels disagree with a virtualized SetCursorPos above 100% scaling
  — `lib/monitors.makeDpiAware` opts the process in before enumerating; in
  xrandr output `disconnected` CONTAINS `connected`, so match the token,
  never the substring; a connected-but-off output has no geometry and is not
  part of the desktop.
- One calibration plane must never span two monitors: bezels are physical
  distance with no pixels, so a spanned plane lands offset on the far panel
  (and angled monitors break it outright) — that is WHY per-monitor planes
  exist. Anything smoothing aim (One Euro phone-side; PC-side keeps only the
  newest sample) must reset when the aimed monitor changes, or it drags
  the cursor across the bezel seam. The phone treats a `/monitors` failure
  (old server, PC unreachable) as "one plane" silently — never an error.
- Linux WiFi interfaces are `wlp2s0`/`wlx…`, matching neither "wifi" nor
  "wlan" — `lib/net.ts` matches `^wl` for that reason.
- Overlay controls (the strip, the aim panel) start hidden via **inline**
  style, and JS reveals them with `style.display=""`. Never move the hiding
  into a CSS rule: clearing the inline style falls back to the stylesheet, so
  a CSS `display:none` can never be un-hidden that way (past bug: FIRE and the
  smoothing slider were unreachable — calibration worked, clicking didn't).
- Don't add smoothing PC-side on top of One Euro; don't let any queue of aim
  samples build anywhere (always newest-wins).
- Jitter matters more than average latency for feel. Any change should be
  judged by p95, not p50.
- Game-input UI must react on pointerDOWN. A `"click"` listener fires on
  finger RELEASE, silently adding the whole tap duration (~100ms) — this was
  the trigger's hidden latency for a while. Also: the phone no longer
  sends v1 `{"type":"fire"}` (the trigger is a buttons.json button now), but the
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
- **50k LOC budget** (user decision 2026-08-14): the whole repo must stay
  maintainable by a solo developer, capped at 50,000 non-blank lines across
  git-tracked source files (ts/tsx/js/mjs/html/css — generated files don't
  count because they aren't tracked). `npm run loc` (build/loc.mjs) prints
  the per-directory breakdown and FAILS above the budget; it runs inside
  `validate`, so CI and the pre-push hook enforce it. Nearing the budget
  means deleting or simplifying, not raising the number — raising it is a
  user decision. Don't game the count by moving logic into uncounted
  extensions (json/md/yml). The README's "Lines of Code" badge is
  SonarCloud's ncloc measure — a slightly different count (Sonar excludes
  comments and only counts what it analyzes), fine for display; the gate is
  the authority.
- Keep the phone page functional without a build step until Phase 6.
- Protocol changes are additive only; bump a `"v"` field if semantics change.
- Prefer measured numbers over assumptions: when touching latency-relevant
  code, run/extend the Phase-2 harness and report before/after p50/p95.
- Ask before adding dependencies beyond: ws, yargs, @nut-tree-fork/libnut-*,
  esbuild + postject (SEA build only), koffi (IN USE since 2026-08-12: pause
  hotkey key-state; also the future SendInput path), werift (IN USE since
  2026-08-12: WebRTC PC-side — pinned EXACT, pure TS on purpose), qrcode-terminal
  (setup QR).
- knip ignores the `@nut-tree-fork/libnut-*` packages: they are resolved by a
  computed specifier at runtime, so static analysis can't see them.
- Commit style: small commits per phase step, message prefix `P<phase>:`
  (`feat:`/`fix:`/`docs:` for work outside a numbered phase).
- **Trunk-based development (2026-08-12):** `main` is protected by the
  "trunk" GitHub ruleset — changes land through a short-lived branch and a
  PR with the four CI checks green (`validate`/`sea` × ubuntu/windows);
  squash-merge, delete the branch. The repo-admin role bypasses the ruleset
  so `npm run release` (direct commit+tag on main) keeps working.

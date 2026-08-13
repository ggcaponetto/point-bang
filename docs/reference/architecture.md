# Architecture

## The pipeline

```
┌─────────────────────────── phone (Chrome, WebXR) ───────────────────────────┐
│ ARCore 6DoF pose ─→ forward ray ─→ ray×screen-plane ─→ (u,v) ─→ One Euro    │
│                                                          filter │ WebSocket │
└─────────────────────────────────────────────────────────────────┼───────────┘
                                            USB tunnel or WiFi    │
┌─────────────────────────────── PC (Node) ───────────────────────┼───────────┐
│ parseMessage ─→ newest aim sample ─→ 2ms cursor loop                        │
│              └→ button executor (key combos / mouse via libnut)            │
└─────────────────────────────────────────────────────────────────────────────┘
```

The phone runs a WebXR `immersive-ar` session: ARCore's visual-inertial
tracking provides absolute, drift-corrected 6DoF pose at gyro-class latency.
The aim ray is intersected with a screen plane calibrated once per session
from three corner captures (each pinned to a WebXR anchor that keeps
self-correcting as ARCore refines its map). Normalized coordinates stream
over a WebSocket to the PC, which scales them to pixels and injects absolute
mouse input.

## Why this approach

Camera+marker tracking in the browser costs 60–120ms. Pure gyro drifts in
yaw and needs constant recentering. WebXR gives gyro-class latency
(~15–30ms phone-side) **with** absolute aim, because ARCore fuses IMU at
high rate and only corrects with the camera. Commercial guns (Sinden's
camera + white border, Gun4IR/AimTrak's IR beacons) don't use this approach.

## Code layout

```
./
├── cli.ts             # the only entry: yargs commands, dev and executable alike
├── server.ts          # http + ws + everything wired together
├── lib/               # typed, unit-tested logic (see the API docs)
│   ├── cli.ts         #   flag surface + command dispatch
│   ├── protocol.ts    #   message parsing — never crashes on garbage
│   ├── buttons.ts     #   action parsing + executor + config loading
│   ├── cursor.ts      #   MouseLike interface + the 2ms pull loop
│   ├── jitter.ts      #   p50/p95/max transport jitter stats
│   ├── native.ts      #   loads libnut.node + koffi (from disk, or out of the SEA blob)
│   ├── input.ts       #   MouseLike/KeyboardLike over libnut (delays zeroed!)
│   ├── hotkey.ts      #   pause combo: key-state polling via koffi FFI
│   ├── assets.ts      #   phone page from disk or from embedded SEA assets
│   ├── static.ts      #   URL normalization + traversal guard + content types
│   ├── check.ts       #   `point-bang check` self-diagnosis
│   ├── net.ts         #   LAN address discovery
│   ├── wifi.ts        #   band detection: netsh / nmcli / iw
│   ├── adb.ts         #   USB tunnel setup
│   ├── rtc.ts         #   WebRTC intake: offer→answer via werift, DataChannel→handler
│   ├── cors.ts        #   allowlist CORS for the hosted page's cross-origin fetches
│   └── qr.ts          #   setup QR: page URL + LAN addresses in the fragment
├── build/
│   ├── sea.mjs        # esbuild -> sea blob -> postject: the single executable
│   ├── pages.mjs      # copies public/ into the docs artifact -> GitHub Pages /phone/
│   └── smoke.mjs      # exercises the built binary
├── public/
│   ├── index.html     # phone page: XR/DOM glue (buildless, ES module)
│   ├── transport.js   # PC link: RTC-first ladder + WS fallback (JSDoc-typed, tested)
│   ├── math.js        # pure math + button vocabulary shared by Chrome AND vitest
│   ├── editor.html    # live button editor (PC browser): DOM glue only
│   ├── editor.js      # editor logic: drag/resize/hit-test/validation (tested)
│   └── buttons.json   # 20 assignable buttons, read by both sides
└── test/              # vitest suites, 90% coverage enforced
```

## Design decisions worth knowing

- **No build step in development.** Node ≥ 23.6 runs the TypeScript directly
  via type stripping; Chrome loads the phone page and its math module as-is.
  Edit + reload beats a bundler for tuning. The one exception is
  `npm run build:sea`, which bundles for distribution only — nothing in the
  dev loop depends on it.
- **One CLI, two homes.** `cli.ts` is the entry for both `node cli.ts` and the
  single executable; the only difference is where assets come from
  (`lib/assets.ts`).
- **Apply-latest, never queue.** The cursor loop pulls the newest target
  position each tick; no queue of stale positions can form anywhere.
- **All filtering is phone-side.** One Euro smoothing on the phone kills
  ARCore micro-jumps adaptively; the PC applies strictly the newest sample
  and adds nothing — no smoothing, no prediction — so the cursor never
  double-smooths and never runs ahead of your aim.
- **Page origin ≠ server origin.** The phone page is published to GitHub
  Pages (`/phone/`, copied from `public/` at docs-build time) so the QR flow
  gets an HTTPS origin without the customer touching certificates. The same
  files served by the PC keep every same-origin flow working — one source,
  two origins. Cross-origin, the page may only fetch `buttons.json` and
  `/monitors`, and POST to `/rtc/offer` and `/buttons`, gated by an Origin
  allowlist (`--page-url`); the state-changing POSTs additionally require
  the session key.
- **Session key (`lib/auth.ts`).** CORS only constrains browsers — curl and
  any device on the LAN send no Origin — so both aim intakes are gated by a
  per-run key: the WebSocket upgrade takes it as `?key=`, `/rtc/offer` in
  the JSON body. The key travels in the URL **fragment** of the QR and every
  printed URL, so it reaches the phone without ever reaching the page host.
  Comparison is timing-safe. Loopback connections are exempt by default (the
  adb/USB flow; a local process could move the mouse directly anyway) —
  except under `serve --tunnel ngrok`, where the exemption is dropped
  because the agent forwards the public internet to loopback. `--key off`
  restores the old open-LAN behaviour; `--key <value>` pins a stable key.
- **Everything injectable.** The server takes mouse/keyboard/ports/config as
  options — integration tests drive a real server with fake devices, and a
  future Windows SendInput path can replace libnut behind the same
  interfaces. The same applies to the platform probes: `netsh`, `nmcli`, `iw`
  and `adb` are all reached through injectable functions, so Windows and Linux
  behaviour is unit-testable from either machine.
- **Latency budget:** phone pose→send < 20ms typical; USB transport jitter
  p95 < 5ms; motion-to-cursor 30–60ms. The game and display add 30–80ms on
  top and dominate — tune those in the game/OS.

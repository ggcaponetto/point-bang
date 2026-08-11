# Architecture

## The pipeline

```
┌─────────────────────────── phone (Chrome, WebXR) ───────────────────────────┐
│ ARCore 6DoF pose ─→ forward ray ─→ ray×screen-plane ─→ (u,v) ─→ One Euro    │
│                                                          filter │ WebSocket │
└─────────────────────────────────────────────────────────────────┼───────────┘
                                            USB tunnel or WiFi    │
┌─────────────────────────────── PC (Node) ───────────────────────┼───────────┐
│ parseMessage ─→ AimPredictor (velocity fit, +20ms) ─→ 2ms cursor loop       │
│              └→ button executor (key combos / mouse via libnut)            │
└─────────────────────────────────────────────────────────────────────────────┘
```

The phone runs a WebXR `immersive-ar` session: ARCore's visual-inertial
tracking provides absolute, drift-corrected 6DoF pose at gyro-class latency.
The aim ray is intersected with a screen plane calibrated once per session
from three corner captures (each pinned to a WebXR anchor that keeps
self-correcting as ARCore refines its map). Normalized coordinates stream
over a WebSocket to the PC, which predicts, scales, and injects absolute
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
├── server.ts          # http/https + ws + everything wired together
├── lib/               # typed, unit-tested logic (see the API docs)
│   ├── cli.ts         #   flag surface + command dispatch
│   ├── protocol.ts    #   message parsing — never crashes on garbage
│   ├── buttons.ts     #   action parsing + executor + config loading
│   ├── cursor.ts      #   MouseLike interface + the 2ms pull loop
│   ├── predict.ts     #   AimPredictor: velocity fit, capped lookahead
│   ├── jitter.ts      #   p50/p95/max transport jitter stats
│   ├── native.ts      #   loads libnut.node (from disk, or out of the SEA blob)
│   ├── input.ts       #   MouseLike/KeyboardLike over libnut (delays zeroed!)
│   ├── assets.ts      #   phone page from disk or from embedded SEA assets
│   ├── static.ts      #   URL normalization + traversal guard + content types
│   ├── certs.ts       #   optional mkcert TLS
│   ├── check.ts       #   `point-bang check` self-diagnosis
│   ├── net.ts         #   LAN address discovery
│   ├── wifi.ts        #   band detection: netsh / nmcli / iw
│   └── adb.ts         #   USB tunnel setup
├── build/
│   ├── sea.mjs        # esbuild -> sea blob -> postject: the single executable
│   └── smoke.mjs      # exercises the built binary
├── public/
│   ├── index.html     # phone page: XR/DOM/WS glue (buildless, ES module)
│   ├── math.js        # pure math shared by Chrome AND vitest (JSDoc-typed)
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
  (`lib/assets.ts`) and where `certs/` is looked for.
- **Apply-latest, never queue.** The cursor loop pulls the newest predicted
  position each tick; no queue of stale positions can form anywhere.
- **Filtering split.** One Euro smoothing lives phone-side (kills ARCore
  micro-jumps adaptively); extrapolation lives PC-side (hides network
  jitter). They compose; they never double-smooth.
- **Everything injectable.** The server takes mouse/keyboard/ports/config as
  options — integration tests drive a real server with fake devices, and a
  future Windows SendInput path can replace libnut behind the same
  interfaces. The same applies to the platform probes: `netsh`, `nmcli`, `iw`
  and `adb` are all reached through injectable functions, so Windows and Linux
  behaviour is unit-testable from either machine.
- **Latency budget:** phone pose→send < 20ms typical; USB transport jitter
  p95 < 5ms; motion-to-cursor 30–60ms. The game and display add 30–80ms on
  top and dominate — tune those in the game/OS.

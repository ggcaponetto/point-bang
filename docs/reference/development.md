# Development

## Commands

```sh
npm install              # also installs husky hooks
npm start                # server, both USB+WiFi modes
npm run start:adb        # USB flow — sets up the adb tunnel itself
npm run start:wifi       # WiFi flow — prints the URLs to open
npm run start:tunnel     # server + public ngrok HTTPS URL, one process
npm run tunnel           # the ngrok tunnel alone, beside a running `npm start`
npm run check            # verify the phone page files + the input addon

npm test                 # vitest + coverage, fails under 90% on any metric
npm run test:watch
npm run typecheck        # tsc --noEmit, strict (covers public/math.js JSDoc)
npm run format           # prettier
npm run knip             # unused files/exports/dependencies
npm run validate         # format:check + typecheck + knip + test

npm run build:sea        # single executable -> dist/point-bang[.exe]
npm run smoke            # exercise the built executable

npm run docs:dev         # typedoc + vitepress dev server
npm run docs:build       # build the docs site (docs/.vitepress/dist)

npm run ip               # LAN IPs, WiFi interface marked
npm run wifi             # 2.4 vs 5 GHz check
```

Everything is one CLI underneath — `npm start` is `node cli.ts serve`. Pass
flags through npm with `--`:

```sh
npm start -- --port 9000 --mode adb
node cli.ts --help
```

## Building the executable

`npm run build:sea` produces a self-contained `dist/point-bang` (or
`point-bang.exe`) for **the OS you run it on** — there is no cross-compiling,
because the binary embeds that platform's native input addon. `build/sea.mjs`
bundles `cli.ts` to CommonJS with esbuild, lists `public/*` and `libnut.node`
(plus the VC++ runtime DLLs on Windows) as SEA assets, and injects the blob
into a copy of the Node binary with postject. CI builds and smoke-tests both
Windows and Linux binaries and uploads them as artifacts.

This is the project's **only** build step. `node cli.ts` still runs straight
from source, and the phone page stays buildless.

## Testing the QR/remote flow without the hosted page

The published start/phone pages come from `main` — useless while you are
_changing_ the phone page. An ngrok tunnel gives your **working copy** a
real HTTPS origin, so you can exercise the exact remote code path (URL
fragment → Local Network Access fetch → `/rtc/offer` → DataChannel) with
zero deploys:

```sh
# terminal 2 — a stable public URL for your local server
npm run tunnel                    # prints e.g. https://xyz.ngrok-free.app

# terminal 1 — allowlist that origin and point the QR at it
npm start -- --page-url https://xyz.ngrok-free.app/
```

Scan the printed QR. The phone loads **your local page over the tunnel**,
sees the `#pc=<lan-ip>:8443` fragment, and goes remote-mode: LNA permission
prompt, cross-origin signaling (allowed because `--page-url` seeds the CORS
allowlist), DataChannel across the LAN. Everything the GitHub-Pages flow
does, but against uncommitted code.

Notes:

- With a reserved ngrok domain (`--tunnel-url`), `npm run start:tunnel --
--page-url https://you.ngrok-free.app/` does it in one process and the
  URL survives restarts.
- Without `--page-url`, the tunnel flow is **same-origin** mode instead:
  signaling rides the tunnel, ICE usually can't cross networks, and the
  page falls back to WS over the tunnel — that's the right recipe for
  testing the page UI itself, and the wrong one for testing LNA/CORS.
- The `#pc=` fragment works from any origin serving the page.

## The ngrok tunnel

`--tunnel ngrok` exposes the local server on a public HTTPS URL. Players
never need it — the QR flow is secure by default — but as a developer it
buys you a real secure origin for uncommitted code (above), a demo URL that
works from any network, and a way to test on a phone that can't reach the
LAN.

```sh
npm run start:tunnel        # server + tunnel in ONE process (= serve --tunnel ngrok)

npm start                   # or keep them apart, so either restarts alone:
npm run tunnel              # terminal 2 (= point-bang tunnel)
```

One-time setup: install the [ngrok](https://ngrok.com) agent and register a
free authtoken with `ngrok config add-authtoken <token>`. The server then
prints:

```
TUNNEL: https://abc123.ngrok-free.app  <-- open this on the phone, from any network
```

Because the URL is HTTPS, it is a secure context: WebXR works with no Chrome
flag, and the aim WebSocket upgrades to `wss://` over the same tunnel — the
page derives its WebSocket scheme from its own protocol.
`tunnel` exposes port 8443 by default; pass `--port` for another one.

Things to know:

- ⚠️ **The printed URL ends in `#key=…` — treat the whole thing as a
  credential.** With the tunnel in-process (`serve --tunnel ngrok`), every
  connection must present that session key, tunnel traffic included. But
  anyone you hand the full URL can still move your mouse and press keys;
  don't share it, and Ctrl+C when done.
- **The standalone `tunnel` command cannot enforce the key.** A separately
  started server sees tunnel traffic as loopback and exempts it — the
  command says so at startup. Use `serve --tunnel ngrok` when the tunnel
  should be authenticated.
- **This is tooling, not a play transport.** Every packet detours through
  ngrok's network — use USB or LAN WiFi to actually shoot things.
- `TUNNEL: failed — ERR_NGROK_4018` means the agent has no credential: run
  the `add-authtoken` step. Either way the server **keeps serving**; only
  the public URL is missing.
- The free plan shows a one-time **"Visit Site"** interstitial
  (ERR_NGROK_6024) to browsers. Tap through it; it won't come back for that
  URL.
- Free accounts get one reserved domain — pass it with
  `--tunnel-url https://you.ngrok-free.app` so the URL survives restarts
  instead of being random each session.
- Only one ngrok session may run at a time on the free plan (ERR_NGROK_108).
  If an agent is already forwarding this port, point-bang adopts it rather
  than failing.
- There's no region flag: current agents pick the lowest-latency region
  themselves.

## The fallback phone transport: the Chrome flag

The QR flow needs the phone to reach the internet once (to load the hosted
page) and a current Chrome. When either is missing — a de-Googled phone, a
pinned old Chrome, an offline LAN — the fallback is Chrome's insecure-origin
flag, which makes the PC's plain-HTTP page a secure context. It is
deliberately absent from the player guide.

The fallback talks to the PC over the network, so it is subject to the
session key: open the URLs exactly as the server prints them — they carry
`#key=…` — or start with `--key off` on a network you trust.

1. On the phone, open `chrome://flags/#unsafe-treat-insecure-origin-as-secure`.
2. Enable it and add `http://<PC-IP>:8443` — `npm run ip` prints your
   addresses with the Wi-Fi interface marked, and `start:wifi` prints them
   ready-made (with the key appended).
3. Relaunch Chrome and open the printed URL. No HTTPS involved.

## Quality gates

- **Husky**: pre-commit runs prettier check + typecheck; pre-push runs the
  full `npm run validate`.
- **CI**: every push and PR runs the gates on **both ubuntu-latest and
  windows-latest**, then builds and smoke-tests the executable on each; pushes
  to `main` also rebuild and deploy this docs site.
- **Line endings**: `.gitattributes` pins everything to LF. Without it a
  Windows clone gets CRLF, which breaks the husky hooks, the PEM test
  fixtures and `prettier --check` on a fresh checkout with zero edits.
- **Coverage** thresholds (90% lines/functions/branches/statements) are
  enforced in `vitest.config.ts` — the suite fails below them.
- Tests **never touch real input devices**: the server is integration-tested
  with injected fake mouse/keyboard on ephemeral ports.

## Repo conventions

- TypeScript is run natively by Node ≥ 23.6 — **erasable syntax only** (no
  enums, no parameter properties; `erasableSyntaxOnly` enforces it).
- The phone page stays buildless: inline ES-module glue plus
  `public/math.js`, which is plain JS with JSDoc types so Chrome and vitest
  share one implementation.
- Protocol changes are **additive only**.
- Anything platform-specific (`netsh`, `nmcli`, `adb`, path separators, line
  endings) belongs in `lib/` behind an injectable function, so both OS paths
  are unit-testable from either machine.
- Input goes through the raw `libnut` addon (`lib/native.ts` → `lib/input.ts`),
  not the nut-js wrapper: its `bindings`-based module lookup cannot survive
  bundling into a single executable. knip is told to ignore the
  `@nut-tree-fork/libnut-*` packages because they are resolved by a computed
  specifier at runtime.
- Latency-relevant changes should be judged by the server's p95 jitter
  print, not by feel alone.

See `CLAUDE.md` in the repo root for the full working agreement and the
project roadmap.

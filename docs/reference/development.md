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
- The `#pc=` fragment works from any origin serving the page — you can also
  hand-type it onto a mkcert HTTPS URL.

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

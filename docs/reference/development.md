# Development

## Commands

```sh
npm install              # also installs husky hooks
npm start                # server, both USB+WiFi modes (PORT env overrides)
npm run start:adb        # USB flow — sets up the adb tunnel itself
npm run start:wifi       # WiFi flow — prints the URLs to open

npm test                 # vitest + coverage, fails under 90% on any metric
npm run test:watch
npm run typecheck        # tsc --noEmit, strict (covers public/math.js JSDoc)
npm run format           # prettier
npm run knip             # unused files/exports/dependencies
npm run validate         # format:check + typecheck + knip + test

npm run docs:dev         # typedoc + vitepress dev server
npm run docs:build       # build the docs site (docs/.vitepress/dist)

npm run ip               # LAN IPs, WiFi interface marked
npm run wifi             # 2.4 vs 5 GHz check (Windows)
```

## Quality gates

- **Husky**: pre-commit runs prettier check + typecheck; pre-push runs the
  full `npm run validate`.
- **CI**: every push and PR runs `validate` on GitHub Actions; pushes to
  `main` also rebuild and deploy this docs site.
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
- Latency-relevant changes should be judged by the server's p95 jitter
  print, not by feel alone.

See `CLAUDE.md` in the repo root for the full working agreement and the
project roadmap.

# Contributing to point-bang

Thanks for helping turn phones into lightguns! All kinds of contributions
are welcome: bug fixes, features, docs, translations for the
[start page](https://ggcaponetto.github.io/point-bang/start/), and
especially **community guides, hacks and mods** — write-ups about your
setup (cabinet builds, RetroArch configs, phone grips, game
compatibility) get linked from the official docs. Open a PR against
`docs/guide/first-game.md`'s community table, or an issue with a link.

## Ground rules

Be kind. The [Code of Conduct](CODE_OF_CONDUCT.md) applies to all project
spaces.

## Dev setup

Requires **Node ≥ 23.6** (TypeScript runs natively — no build step) and,
for the physical loop, an ARCore Android phone with Chrome.

```sh
git clone https://github.com/ggcaponetto/point-bang.git
cd point-bang
npm install              # also installs the husky hooks
npm run start:adb        # USB dev flow (adb on PATH)
npm test                 # vitest + coverage
npm run validate         # the full gate: format + types + knip + tests
```

The [development reference](https://ggcaponetto.github.io/point-bang/reference/development)
covers the architecture, testing the wireless flow with ngrok, and building
the single executable. `CLAUDE.md` in the repo root is the detailed working
agreement — worth a read before larger changes.

## The bar for merging

- **`npm run validate` must pass.** Husky enforces it on push: prettier,
  strict `tsc`, knip (no dead code/deps), and the test suite with **90%
  coverage on every metric**. Don't game the gate with exclusions.
- **New logic ships with tests.** Unit-testable code goes in `lib/` or
  `public/*.js` (JSDoc-typed, shared with Chrome); entry files stay thin.
  Tests never touch real input devices or the network.
- **Windows and Linux, equally.** Platform-specific behavior lives behind
  injectable functions so both paths are unit-testable from either OS. No
  `FOO=bar cmd` in scripts or docs; no `cp`/`rm`/`mkdir` in npm scripts.
- **The protocol is additive-only**, and the phone page stays buildless
  (the React start page in `site/` is deliberately a separate package).
- **Never break the POC flow**: `npm start` + adb tunnel + 3-corner
  calibration must always work on `main`.
- **Ask before adding dependencies** — open an issue first. The current
  allowlist is in `CLAUDE.md`.
- Latency-relevant changes are judged by the server's **p95 jitter print**,
  not by feel alone.

## Commit style

Small commits. Prefix with the roadmap phase (`P4: …`) when the work
belongs to one, otherwise conventional prefixes (`feat:`, `fix:`, `docs:`,
`ci:`, `chore:`).

## Editor setup

`.vscode/extensions.json` recommends **SonarLint** (live code-quality
feedback matching the SonarQube gate on CI), **Prettier** and **Vitest**.
VS Code offers to install them when you open the repo.

## Releases (maintainers)

`npm run release -- patch|minor|major` bumps `package.json` and
`lib/version.ts` in sync, runs the full gate, commits and tags. Pushing the
tag triggers the release workflow, which builds and smoke-tests the
Windows and Linux executables and attaches them to a GitHub Release.

// Publishes the phone page to GitHub Pages by copying public/ into
// docs/public/phone/ — VitePress copies docs/public/ verbatim into the
// artifact that .github/workflows/docs.yml already deploys, so the page
// lands at https://ggcaponetto.github.io/point-bang/phone/ with zero
// workflow changes. Copied at build time (docs:build), never committed:
// public/ stays the single source of truth for the checkout, the SEA
// executable and the hosted page alike.
//
// A Node program, not `cp` — npm scripts must run on cmd/PowerShell too.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PHONE_ASSETS } from "../lib/assets.ts";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEST = path.join(ROOT, "docs", "public", "phone");

// PHONE_ASSETS only: the editor (a generated bundle) works exclusively
// against the local PC server — publishing it to Pages would be dead weight.
fs.mkdirSync(DEST, { recursive: true });
for (const name of PHONE_ASSETS) {
  const src = path.join(ROOT, "public", name);
  if (!fs.existsSync(src)) throw new Error(`missing public asset: ${src}`);
  fs.copyFileSync(src, path.join(DEST, name));
}
// the logo doubles as the docs-site favicon/brand mark
fs.copyFileSync(
  path.join(ROOT, "assets", "logo.svg"),
  path.join(ROOT, "docs", "public", "logo.svg"),
);
console.log(`pages: copied ${PHONE_ASSETS.length} phone-page files + logo -> ${DEST}`);

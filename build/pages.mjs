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
import { PUBLIC_ASSETS } from "../lib/assets.ts";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEST = path.join(ROOT, "docs", "public", "phone");

fs.mkdirSync(DEST, { recursive: true });
for (const name of PUBLIC_ASSETS) {
  const src = path.join(ROOT, "public", name);
  if (!fs.existsSync(src)) throw new Error(`missing public asset: ${src}`);
  fs.copyFileSync(src, path.join(DEST, name));
}
console.log(`pages: copied ${PUBLIC_ASSETS.length} phone-page files -> ${DEST}`);

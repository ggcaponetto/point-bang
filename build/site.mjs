// Builds the hosted start page (site/ — React + MUI + i18next) into
// docs/public/start/, which VitePress copies verbatim into the Pages
// artifact. site/ is an npm workspace: the root `npm install` provides its
// dependencies (one lockfile), but it stays out of `validate` — only the
// docs pipeline pays for its bundler.
//
// A Node program, not shell built-ins — npm scripts must run on cmd/PS too.

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = path.join(ROOT, "site");

// the logo is the site's favicon + hero image; site/public/ is generated
fs.mkdirSync(path.join(SITE, "public"), { recursive: true });
fs.copyFileSync(path.join(ROOT, "assets", "logo.svg"), path.join(SITE, "public", "logo.svg"));

// workspace commands run from the ROOT (that is where npm resolves -w)
execSync("npm run -w site build", { cwd: ROOT, stdio: "inherit" });
console.log("site: built -> docs/public/start/");

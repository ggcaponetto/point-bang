// Builds the hosted start page (site/ — React + MUI + i18next) into
// docs/public/start/, which VitePress copies verbatim into the Pages
// artifact. site/ is a separate npm package on purpose: the core project
// keeps its no-build-step rule; only the docs pipeline pays for a bundler.
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

const run = (cmd) => execSync(cmd, { cwd: SITE, stdio: "inherit" });
if (!fs.existsSync(path.join(SITE, "node_modules"))) run("npm ci");
run("npm run build");
console.log("site: built -> docs/public/start/");

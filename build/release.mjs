#!/usr/bin/env node
// Cuts a release: bumps package.json AND lib/version.ts in lockstep (the
// executable has no package.json, so the literal is the version of record —
// test/version.test.ts asserts they match), runs the full validate gate,
// commits and tags. Pushing is deliberately left to the maintainer:
//
//   npm run release -- patch|minor|major        (default: patch)
//   git push origin main vX.Y.Z
//
// The tag push triggers .github/workflows/release.yml, which builds and
// smoke-tests the Windows and Linux executables and attaches them to a
// GitHub Release. A Node program, not shell built-ins — cmd/PS-safe.

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const run = (cmd) => execSync(cmd, { cwd: ROOT, stdio: "inherit" });
const out = (cmd) => execSync(cmd, { cwd: ROOT }).toString().trim();

const kind = process.argv[2] ?? "patch";
if (!["major", "minor", "patch"].includes(kind)) {
  console.error("usage: npm run release -- [major|minor|patch]");
  process.exit(1);
}
if (out("git status --porcelain") !== "") {
  console.error("release: working tree not clean — commit or stash first");
  process.exit(1);
}

run(`npm version ${kind} --no-git-tag-version`);
const version = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;

const versionTs = path.join(ROOT, "lib", "version.ts");
const src = fs.readFileSync(versionTs, "utf8");
const updated = src.replace(
  /export const VERSION = "[^"]+";/,
  `export const VERSION = "${version}";`,
);
if (updated === src) {
  console.error("release: VERSION literal not found in lib/version.ts");
  process.exit(1);
}
fs.writeFileSync(versionTs, updated);

run("npm run validate");
run("git add package.json package-lock.json lib/version.ts");
run(`git commit -m "release: v${version}"`);
run(`git tag v${version}`);
console.log(`\nrelease: v${version} tagged. Ship it with:\n\n  git push origin main v${version}\n`);

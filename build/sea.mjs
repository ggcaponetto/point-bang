#!/usr/bin/env node
/**
 * Builds the `point-bang` single executable for whichever OS runs this script.
 *
 * Node's SEA format takes one CommonJS file plus a set of named assets, so the
 * steps are: bundle the ESM/TypeScript sources into CJS, collect the phone
 * page and the libnut addon as assets, generate the blob, copy the Node binary
 * and inject the blob into the copy.
 *
 * Everything here is plain Node — no shell built-ins, no `cp`/`rm`, no `&&`
 * chains — so it behaves identically under bash and cmd.exe. It is the only
 * build step in the project; `node cli.ts` still runs straight from source.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import esbuild from "esbuild";

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const isWin = process.platform === "win32";

/** Native packages stay out of the bundle — they are loaded via dlopen. */
const EXTERNAL = [
  "@nut-tree-fork/libnut-linux",
  "@nut-tree-fork/libnut-win32",
  "bindings",
  "koffi",
];

/** Runtime DLLs libnut links against on Windows; they ship beside the addon. */
const WIN_SIDECARS = [
  "msvcp140.dll",
  "vcruntime140.dll",
  "vcruntime140_1.dll",
  "api-ms-win-crt-heap-l1-1-0.dll",
  "api-ms-win-crt-runtime-l1-1-0.dll",
  "api-ms-win-crt-string-l1-1-0.dll",
];

const log = (msg) => console.log(`[sea] ${msg}`);

/** Locates the prebuilt libnut addon for this platform inside node_modules. */
function nativeDir() {
  const pkg = `@nut-tree-fork/libnut-${process.platform}`;
  let entry;
  try {
    entry = require.resolve(`${pkg}/package.json`);
  } catch {
    throw new Error(`${pkg} is not installed — no libnut build for ${process.platform}`);
  }
  return path.join(path.dirname(entry), "build", "Release");
}

/** Locates the prebuilt koffi FFI addon (pause hotkey) for this platform. */
function koffiNode() {
  const triplet = `${process.platform}_${process.arch}`;
  const pkg = `@koromix/koffi-${process.platform}-${process.arch}`;
  let entry;
  try {
    entry = require.resolve(`${pkg}/package.json`);
  } catch {
    throw new Error(`${pkg} is not installed — no koffi build for ${triplet}`);
  }
  return path.join(path.dirname(entry), triplet, "koffi.node");
}

function bundle() {
  log("bundling cli.ts -> dist/bundle.cjs");
  esbuild.buildSync({
    entryPoints: [path.join(ROOT, "cli.ts")],
    outfile: path.join(DIST, "bundle.cjs"),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    external: EXTERNAL,
    // SEA requires CommonJS, where `import.meta.url` does not exist. The
    // sources use it to locate themselves, so point it at the bundle's own
    // path — the equivalent answer for a single file.
    banner: { js: 'const __pbUrl = require("url").pathToFileURL(__filename).href;' },
    define: { "import.meta.url": "__pbUrl" },
    sourcemap: false,
    minify: false,
    legalComments: "none",
  });
}

/** Copies the native files into dist/ and returns their asset entries. */
function collectAssets() {
  const dir = nativeDir();
  const assets = {};
  for (const name of ["index.html", "math.js", "buttons.json", "transport.js"])
    assets[name] = path.join(ROOT, "public", name);

  assets["libnut.node"] = path.join(dir, "libnut.node");
  assets["koffi.node"] = koffiNode();
  if (isWin) for (const dll of WIN_SIDECARS) assets[dll] = path.join(dir, dll);

  for (const [name, file] of Object.entries(assets))
    if (!fs.existsSync(file)) throw new Error(`missing asset ${name}: ${file}`);
  return assets;
}

function writeConfig(assets) {
  const config = {
    main: path.join(DIST, "bundle.cjs"),
    output: path.join(DIST, "sea.blob"),
    disableExperimentalSEAWarning: true,
    // useCodeCache would speed startup but is refused when the bundle is built
    // by a different Node version than the one being embedded; not worth the
    // fragility for a program that then runs for hours.
    assets,
  };
  const file = path.join(DIST, "sea-config.json");
  fs.writeFileSync(file, JSON.stringify(config, null, 2));
  return file;
}

function main() {
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });

  bundle();
  const assets = collectAssets();
  log(`assets: ${Object.keys(assets).join(", ")}`);
  const configFile = writeConfig(assets);

  log("generating the SEA blob");
  execFileSync(process.execPath, ["--experimental-sea-config", configFile], { stdio: "inherit" });

  const exe = path.join(DIST, isWin ? "point-bang.exe" : "point-bang");
  fs.copyFileSync(process.execPath, exe);
  if (!isWin) fs.chmodSync(exe, 0o755);

  log(`injecting into ${path.basename(exe)}`);
  const postject = require.resolve("postject/dist/cli.js");
  const args = [
    postject,
    exe,
    "NODE_SEA_BLOB",
    path.join(DIST, "sea.blob"),
    "--sentinel-fuse",
    "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
  ];
  // macOS would additionally need --macho-segment-name NODE_SEA plus a
  // re-signing pass; Windows and Linux need neither.
  execFileSync(process.execPath, args, { stdio: "inherit" });

  const mb = (fs.statSync(exe).size / 1024 / 1024).toFixed(1);
  log(`done: ${exe} (${mb} MB)`);
}

main();

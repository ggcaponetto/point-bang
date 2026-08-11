#!/usr/bin/env node
/**
 * `point-bang` executable entry.
 *
 * Deliberately logic-free: it only tells {@link runCli} where the program
 * lives and how to reach embedded assets, because those two answers are the
 * only things that differ between `node cli.ts` and the single executable.
 *
 * @module
 */
import path from "node:path";
import { isSea, getRawAsset } from "node:sea";
import { fileURLToPath } from "node:url";
import { runCli } from "./lib/cli.ts";

const sea = isSea();
// In a SEA there is no source tree — `certs/` is looked for next to the
// executable the user actually launched.
const appDir = sea ? path.dirname(process.execPath) : path.dirname(fileURLToPath(import.meta.url));

// `.then` rather than top-level await: the single-executable build wraps this
// file in CommonJS, where a top-level await cannot exist.
void runCli(undefined, {
  isSea: sea,
  getAsset: (key) => getRawAsset(key) as ArrayBuffer,
  appDir,
}).then((code) => {
  process.exitCode = code;
});

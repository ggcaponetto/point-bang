#!/usr/bin/env node
/**
 * Smoke-tests the built executable: it must report its version, print help,
 * list interfaces, and — the part that actually matters for a SEA — prove the
 * phone page files really did get baked into the binary.
 *
 * `serve` is deliberately not exercised here: moving a real cursor needs a
 * desktop session, which CI does not have. `check` reports the input addon's
 * status without requiring one.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const exe = path.join(ROOT, "dist", process.platform === "win32" ? "point-bang.exe" : "point-bang");

if (!fs.existsSync(exe)) {
  console.error(`smoke: ${exe} does not exist — run "npm run build:sea" first`);
  process.exit(1);
}

let failed = 0;
const run = (name, args, expect) => {
  const r = spawnSync(exe, args, { encoding: "utf8" });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  const ok = r.status === 0 && expect.every((e) => out.includes(e));
  console.log(`smoke: ${name} ${ok ? "ok" : "FAILED"}`);
  if (!ok) {
    failed++;
    console.error(`  exit=${r.status}\n${out}`);
  }
};

run("--version", ["--version"], ["0."]);
run("--help", ["--help"], ["serve", "wifi", "check"]);
run("ip", ["ip"], []);
// The asset lines prove index.html, math.js and buttons.json travelled inside
// the executable; without them the phone would get a 404 instead of the page.
// "pause hotkey:" proves the koffi FFI addon extracted and loaded from the
// blob (its status may still be "unavailable" on a headless runner).
run("check", ["check"], ["asset index.html", "asset math.js", "action(s) mapped", "pause hotkey:"]);

process.exit(failed ? 1 : 0);

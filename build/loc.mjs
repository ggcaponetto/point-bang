#!/usr/bin/env node
/**
 * Repo size gate: counts non-blank lines in git-tracked source files and
 * FAILS above 50k. The point is solo-developer maintainability — the repo
 * must stay small enough for one person to hold in their head. Part of
 * `npm run validate`; raising BUDGET is a user decision, not a fix.
 *
 * Only git-tracked files count, so generated output (public/editor.html,
 * docs/public/, dist/) is excluded by construction. Markdown/JSON/YAML are
 * config and docs, not code — excluded on purpose; don't dodge the gate by
 * moving logic into an uncounted extension.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUDGET = 50_000;
const CODE_EXT = /\.(ts|tsx|mts|cts|js|mjs|cjs|jsx|html|css)$/;

const ls = spawnSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" });
if (ls.status !== 0) {
  console.error(`loc: git ls-files failed\n${ls.stderr ?? ""}`);
  process.exit(1);
}

const byDir = new Map();
let total = 0;
for (const file of ls.stdout.split(/\r?\n/)) {
  if (!CODE_EXT.test(file)) continue;
  let text;
  try {
    text = fs.readFileSync(path.join(ROOT, file), "utf8");
  } catch {
    continue; // tracked but deleted in the working tree
  }
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "").length;
  const dir = file.includes("/") ? file.slice(0, file.indexOf("/")) : ".";
  byDir.set(dir, (byDir.get(dir) ?? 0) + lines);
  total += lines;
}

for (const [dir, lines] of [...byDir].sort((a, b) => b[1] - a[1])) {
  console.log(`loc: ${String(lines).padStart(6)}  ${dir}`);
}
const pct = Math.round((total / BUDGET) * 100);
console.log(`loc: ${String(total).padStart(6)}  total (${pct}% of the ${BUDGET} budget)`);

if (total > BUDGET) {
  console.error(
    `loc: FAILED — ${total} non-blank source lines exceed the ${BUDGET} budget. ` +
      `Delete or simplify before adding more; the budget keeps this repo solo-maintainable.`,
  );
  process.exit(1);
}

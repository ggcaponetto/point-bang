import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { editorBuildPlan, ensureEditorBuilt, newestMtime } from "../lib/editorbuild.ts";

/** A throwaway checkout: editor/src + public, shaped like the real repo. */
function makeRoot(opts: { editorDir?: boolean; built?: boolean } = {}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pb-editorbuild-"));
  fs.mkdirSync(path.join(root, "public"));
  fs.writeFileSync(path.join(root, "public", "math.js"), "// math");
  fs.writeFileSync(path.join(root, "public", "transport.js"), "// transport");
  if (opts.editorDir !== false) {
    fs.mkdirSync(path.join(root, "editor", "src"), { recursive: true });
    fs.writeFileSync(path.join(root, "editor", "src", "main.tsx"), "// app");
    fs.writeFileSync(path.join(root, "editor", "editor.html"), "<html>");
    fs.writeFileSync(path.join(root, "editor", "vite.config.ts"), "// cfg");
    fs.writeFileSync(path.join(root, "editor", "package.json"), "{}");
  }
  if (opts.built) fs.writeFileSync(path.join(root, "public", "editor.html"), "<built>");
  return root;
}

const touch = (file: string, msFromNow: number) => {
  const t = new Date(Date.now() + msFromNow);
  fs.utimesSync(file, t, t);
};

describe("newestMtime", () => {
  it("returns 0 for a missing path and recurses into directories", () => {
    const root = makeRoot();
    expect(newestMtime(path.join(root, "nope"))).toBe(0);
    const deep = path.join(root, "editor", "src", "main.tsx");
    touch(deep, 60_000);
    expect(newestMtime(path.join(root, "editor"))).toBe(fs.statSync(deep).mtimeMs);
  });
});

describe("editorBuildPlan", () => {
  it("builds when the output is missing", () => {
    const plan = editorBuildPlan(makeRoot());
    expect(plan).toEqual({ build: true, reason: "editor: not built yet" });
  });
  it("builds when any source is newer than the output", () => {
    const root = makeRoot({ built: true });
    touch(path.join(root, "editor", "src", "main.tsx"), 60_000);
    expect(editorBuildPlan(root)).toEqual({ build: true, reason: "editor: sources changed" });
  });
  it("rebuilds when the bundled shared modules change", () => {
    const root = makeRoot({ built: true });
    touch(path.join(root, "public", "math.js"), 60_000);
    expect(editorBuildPlan(root).build).toBe(true);
  });
  it("skips when the output is fresh", () => {
    const root = makeRoot({ built: true });
    touch(path.join(root, "public", "editor.html"), 60_000);
    expect(editorBuildPlan(root)).toEqual({ build: false, reason: "editor: up to date" });
  });
  it("without editor/ serves an existing build and reports a fully absent editor", () => {
    expect(editorBuildPlan(makeRoot({ editorDir: false, built: true })).build).toBe(false);
    const gone = editorBuildPlan(makeRoot({ editorDir: false }));
    expect(gone.build).toBe(false);
    expect(gone.reason).toContain("unavailable");
  });
});

describe("ensureEditorBuilt", () => {
  it("runs the workspace build from the root when stale", () => {
    const root = makeRoot();
    const calls: Array<{ cmd: string; cwd: string }> = [];
    const logs: string[] = [];
    ensureEditorBuilt({
      root,
      log: (l) => logs.push(l),
      exec: (cmd, opts) => calls.push({ cmd, cwd: opts.cwd }),
    });
    expect(calls).toEqual([{ cmd: "npm run -w editor build", cwd: root }]);
    expect(logs.some((l) => l.includes("not built yet"))).toBe(true);
  });
  it("does nothing when the build is fresh", () => {
    const root = makeRoot({ built: true });
    touch(path.join(root, "public", "editor.html"), 60_000);
    const calls: string[] = [];
    ensureEditorBuilt({ root, log: () => {}, exec: (cmd) => calls.push(cmd) });
    expect(calls).toEqual([]);
  });
  it("never builds inside the SEA", () => {
    const calls: string[] = [];
    ensureEditorBuilt({ root: makeRoot(), isSea: true, log: () => {}, exec: (c) => calls.push(c) });
    expect(calls).toEqual([]);
  });
  it("never builds under --public, but hints when the editor is absent there", () => {
    const root = makeRoot();
    const other = fs.mkdtempSync(path.join(os.tmpdir(), "pb-public-"));
    const calls: string[] = [];
    const logs: string[] = [];
    ensureEditorBuilt({
      root,
      publicDir: other,
      log: (l) => logs.push(l),
      exec: (c) => calls.push(c),
    });
    expect(calls).toEqual([]);
    expect(logs.some((l) => l.includes("--public"))).toBe(true);
  });
  it("logs a failed build and keeps going — the phone flow must not die", () => {
    const logs: string[] = [];
    ensureEditorBuilt({
      root: makeRoot(),
      log: (l) => logs.push(l),
      exec: () => {
        throw new Error("vite exploded\nlong stack");
      },
    });
    expect(logs.some((l) => l.includes("build failed — vite exploded"))).toBe(true);
    expect(logs.some((l) => l.includes("npm run -w editor build"))).toBe(true);
  });
});

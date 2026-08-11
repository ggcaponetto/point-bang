import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCheck } from "../lib/check.ts";
import { diskAssets } from "../lib/assets.ts";
import type { LibNut } from "../lib/native.ts";

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");

const okNative = () =>
  Promise.resolve({
    getScreenSize: () => ({ width: 1920, height: 1080 }),
  } as unknown as LibNut);

/** A display is present unless a test says otherwise. */
const withDisplay = { DISPLAY: ":0" };

describe("runCheck", () => {
  it("passes on a complete install and reports the screen size", async () => {
    const logs: string[] = [];
    const code = await runCheck({
      assets: diskAssets(PUBLIC),
      log: (l) => logs.push(l),
      loadNative: okNative,
      env: withDisplay,
    });
    expect(code).toBe(0);
    expect(logs.some((l) => l.startsWith("asset index.html"))).toBe(true);
    expect(logs).toContain("buttons: 5 action(s) mapped");
    expect(logs).toContain("input: ready — screen 1920x1080");
  });

  it("fails when an embedded asset is missing", async () => {
    const logs: string[] = [];
    const code = await runCheck({
      assets: {
        async read() {
          return null;
        },
      },
      log: (l) => logs.push(l),
      loadNative: okNative,
      env: withDisplay,
    });
    expect(code).toBe(1);
    expect(logs.filter((l) => l.includes("MISSING"))).toHaveLength(3);
  });

  it("reports an unusable input addon without failing — CI has no display", async () => {
    const logs: string[] = [];
    const code = await runCheck({
      assets: diskAssets(PUBLIC),
      log: (l) => logs.push(l),
      platform: "linux",
      env: withDisplay,
      loadNative: () => Promise.reject(new Error("libXtst.so.6: cannot open")),
    });
    expect(code).toBe(0);
    expect(logs.some((l) => l.includes("UNAVAILABLE"))).toBe(true);
    expect(logs.some((l) => l.includes("XTEST"))).toBe(true);
  });

  it("never calls into libnut on a headless Linux box", async () => {
    // libnut answers a missing display by killing the process, not by
    // throwing — so the guard has to come before the call, not around it.
    const logs: string[] = [];
    let called = false;
    const code = await runCheck({
      assets: diskAssets(PUBLIC),
      log: (l) => logs.push(l),
      platform: "linux",
      env: {},
      loadNative: () => {
        called = true;
        return okNative();
      },
    });
    expect(called).toBe(false);
    expect(code).toBe(0);
    expect(logs.some((l) => l.includes("no DISPLAY set"))).toBe(true);
  });

  it("gives non-Linux platforms a generic hint", async () => {
    const logs: string[] = [];
    await runCheck({
      assets: diskAssets(PUBLIC),
      log: (l) => logs.push(l),
      platform: "win32",
      env: {},
      loadNative: () => Promise.reject(new Error("boom")),
    });
    expect(logs.some((l) => l.includes("troubleshooting"))).toBe(true);
  });
});

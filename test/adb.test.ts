import { describe, it, expect } from "vitest";
import { adbReverse } from "../lib/adb.ts";

describe("adbReverse", () => {
  it("reports success with the phone URL, spawning adb with literal args", () => {
    const calls: { file: string; args: string[] }[] = [];
    const r = adbReverse(8443, (file, args) => {
      calls.push({ file, args });
    });
    expect(r.ok).toBe(true);
    expect(calls).toEqual([{ file: "adb", args: ["reverse", "tcp:8443", "tcp:8443"] }]);
    expect(r.detail).toContain("http://localhost:8443");
  });

  it("refuses a port that is not a sane TCP port — nothing is spawned", () => {
    const calls: unknown[] = [];
    for (const bad of [NaN, 0, 70000, 8443.5]) {
      const r = adbReverse(bad, (...c) => {
        calls.push(c);
      });
      expect(r.ok).toBe(false);
      expect(r.detail).toContain("invalid port");
    }
    expect(calls).toEqual([]);
  });

  it("explains failure and gives the manual command", () => {
    const r = adbReverse(8443, () => {
      throw new Error("no devices/emulators found\nmore noise");
    });
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("no devices/emulators found");
    expect(r.detail).not.toContain("more noise");
    expect(r.detail).toContain("adb reverse tcp:8443 tcp:8443");
  });
});

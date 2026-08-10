import { describe, it, expect } from "vitest";
import { adbReverse } from "../lib/adb.ts";

describe("adbReverse", () => {
  it("reports success with the phone URL", () => {
    const cmds: string[] = [];
    const r = adbReverse(8443, (c) => {
      cmds.push(c);
    });
    expect(r.ok).toBe(true);
    expect(cmds).toEqual(["adb reverse tcp:8443 tcp:8443"]);
    expect(r.detail).toContain("http://localhost:8443");
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

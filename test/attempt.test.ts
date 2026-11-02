import { describe, expect, it } from "vitest";
import { attempt } from "../lib/attempt.ts";

describe("attempt", () => {
  it("resolves with the function's value", async () => {
    await expect(attempt(() => 42)).resolves.toBe(42);
  });

  it("adopts a returned promise", async () => {
    await expect(attempt(() => Promise.resolve("x"))).resolves.toBe("x");
  });

  it("turns a synchronous throw into a rejection instead of throwing", async () => {
    let p: Promise<never> | undefined;
    expect(() => {
      p = attempt(() => {
        throw new Error("boom");
      });
    }).not.toThrow();
    await expect(p).rejects.toThrow("boom");
  });

  it("wraps a non-Error throw in an Error", async () => {
    await expect(
      attempt(() => {
        throw JSON.parse('"raw"'); // a non-Error value, as foreign code may throw
      }),
    ).rejects.toThrow("raw");
  });
});

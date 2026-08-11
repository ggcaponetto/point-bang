import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  parseAction,
  loadButtonConfig,
  parseButtonConfig,
  createButtonExecutor,
  type KeyboardLike,
} from "../lib/buttons.ts";
import type { MouseLike } from "../lib/cursor.ts";

describe("parseAction", () => {
  it("parses mouse actions", () => {
    expect(parseAction("mouse:left")).toEqual({ kind: "mouse", button: "left" });
    expect(parseAction("mouse:right")).toEqual({ kind: "mouse", button: "right" });
    expect(parseAction("mouse:middle")).toEqual({ kind: "mouse", button: "middle" });
    expect(parseAction("mouse:side")).toBeNull();
  });
  it("parses single keys into libnut's names", () => {
    expect(parseAction("key:r")).toEqual({ kind: "key", keys: ["r"] });
    expect(parseAction("key:5")).toEqual({ kind: "key", keys: ["5"] });
    expect(parseAction("key:f12")).toEqual({ kind: "key", keys: ["f12"] });
    expect(parseAction("key:enter")).toEqual({ kind: "key", keys: ["enter"] });
    expect(parseAction("key:Escape")).toEqual({ kind: "key", keys: ["escape"] });
    expect(parseAction("key:numpad7")).toEqual({ kind: "key", keys: ["numpad_7"] });
    expect(parseAction("key:pgdn")).toEqual({ kind: "key", keys: ["pagedown"] });
    expect(parseAction("key:-")).toEqual({ kind: "key", keys: ["-"] });
  });
  it("keeps win, cmd and meta apart instead of collapsing them", () => {
    expect(parseAction("key:win")).toEqual({ kind: "key", keys: ["win"] });
    expect(parseAction("key:cmd")).toEqual({ kind: "key", keys: ["cmd"] });
    expect(parseAction("key:super")).toEqual({ kind: "key", keys: ["meta"] });
  });
  it("parses combos, modifiers first", () => {
    expect(parseAction("key:ctrl+shift+f")).toEqual({
      kind: "key",
      keys: ["control", "shift", "f"],
    });
    expect(parseAction("key:alt+f4")).toEqual({ kind: "key", keys: ["alt", "f4"] });
  });
  it("rejects unknown keys and malformed specs", () => {
    expect(parseAction("key:notakey")).toBeNull();
    expect(parseAction("key:ctrl+")).toBeNull();
    expect(parseAction("key:")).toBeNull();
    expect(parseAction("gamepad:a")).toBeNull();
    expect(parseAction("")).toBeNull();
  });
});

describe("loadButtonConfig", () => {
  const write = (obj: unknown): string => {
    const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "btn-")), "buttons.json");
    fs.writeFileSync(p, JSON.stringify(obj));
    return p;
  };

  it("maps assigned actions, skips unassigned, reports bad ones", () => {
    const p = write({
      buttons: [
        { id: "b1", label: "RELOAD", action: "mouse:right", visible: true },
        { id: "b2", label: "START", action: "key:1", visible: true },
        { id: "b3", label: "unused", action: "", visible: false },
        { id: "b4", label: "broken", action: "key:nope", visible: true },
        { label: "no id", action: "key:a", visible: true },
      ],
    });
    const cfg = loadButtonConfig(p);
    expect([...cfg.actions.keys()]).toEqual(["b1", "b2"]);
    expect(cfg.actions.get("b1")).toEqual({ kind: "mouse", button: "right" });
    expect(cfg.problems).toEqual([
      'button b4: unknown action "key:nope"',
      "button without id skipped",
    ]);
  });

  it("disables buttons on unreadable config", () => {
    const cfg = loadButtonConfig(path.join(os.tmpdir(), "nope", "buttons.json"));
    expect(cfg.actions.size).toBe(0);
    expect(cfg.problems[0]).toContain("buttons disabled");
  });

  it("tolerates a config without a buttons array", () => {
    const cfg = loadButtonConfig(write({}));
    expect(cfg.actions.size).toBe(0);
    expect(cfg.problems).toEqual([]);
  });
});

describe("parseButtonConfig", () => {
  it("reads config text directly — the form the executable uses", () => {
    const cfg = parseButtonConfig(
      JSON.stringify({ buttons: [{ id: "fire", action: "mouse:left" }] }),
    );
    expect(cfg.actions.get("fire")).toEqual({ kind: "mouse", button: "left" });
  });
  it("disables buttons on malformed JSON rather than throwing", () => {
    const cfg = parseButtonConfig("{{{ not json");
    expect(cfg.actions.size).toBe(0);
    expect(cfg.problems[0]).toContain("buttons disabled");
  });
});

describe("createButtonExecutor", () => {
  function fakes() {
    const calls: string[] = [];
    const mouse = {
      setPosition: vi.fn(),
      click: vi.fn(),
      press: vi.fn(async (b: string) => void calls.push(`m-press:${b}`)),
      release: vi.fn(async (b: string) => void calls.push(`m-release:${b}`)),
      screenSize: vi.fn(),
    } as unknown as MouseLike;
    const keyboard: KeyboardLike = {
      async pressKeys(keys) {
        calls.push(`k-press:${keys.join(",")}`);
      },
      async releaseKeys(keys) {
        calls.push(`k-release:${keys.join(",")}`);
      },
    };
    return { calls, mouse, keyboard };
  }

  it("presses and releases mouse buttons", async () => {
    const { calls, mouse, keyboard } = fakes();
    const exec = createButtonExecutor(
      new Map([["b1", { kind: "mouse", button: "right" } as const]]),
      mouse,
      keyboard,
    );
    expect(await exec("b1", true)).toBe(true);
    expect(await exec("b1", false)).toBe(true);
    expect(calls).toEqual(["m-press:right", "m-release:right"]);
  });

  it("presses combos in order and releases in reverse", async () => {
    const { calls, mouse, keyboard } = fakes();
    const exec = createButtonExecutor(
      new Map([["b2", { kind: "key", keys: ["control", "shift", "f"] } as const]]),
      mouse,
      keyboard,
    );
    await exec("b2", true);
    await exec("b2", false);
    expect(calls).toEqual(["k-press:control,shift,f", "k-release:f,shift,control"]);
  });

  it("returns false for unmapped ids", async () => {
    const { mouse, keyboard } = fakes();
    const exec = createButtonExecutor(new Map(), mouse, keyboard);
    expect(await exec("b99", true)).toBe(false);
  });
});

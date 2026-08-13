import { describe, it, expect } from "vitest";
import {
  clampRectMove,
  resizeRect,
  pointerToPct,
  hitTest,
  updateButton,
  configProblems,
  parseVibrateField,
  parsePadField,
  nextFreeRect,
  composeAction,
  decomposeAction,
  decomposeVibrate,
  resetButton,
} from "../public/editor.js";

const R = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });

describe("clampRectMove", () => {
  it("moves by the delta, snapped to whole percent", () => {
    expect(clampRectMove(R(10, 10, 20, 10), 5.4, -2.6)).toEqual(R(15, 7, 20, 10));
  });
  it("never pushes the rect off screen", () => {
    expect(clampRectMove(R(10, 10, 20, 10), -50, -50)).toEqual(R(0, 0, 20, 10));
    expect(clampRectMove(R(70, 80, 20, 10), 50, 50)).toEqual(R(80, 90, 20, 10));
  });
});

describe("resizeRect", () => {
  const rect = R(20, 20, 40, 30);
  it("drags each corner: the opposite edges stay put", () => {
    expect(resizeRect(rect, "se", 10, 5)).toEqual(R(20, 20, 50, 35));
    expect(resizeRect(rect, "nw", 10, 5)).toEqual(R(30, 25, 30, 25));
    expect(resizeRect(rect, "ne", 10, -5)).toEqual(R(20, 15, 50, 35));
    expect(resizeRect(rect, "sw", -10, 5)).toEqual(R(10, 20, 50, 35));
  });
  it("enforces the minimum size", () => {
    expect(resizeRect(rect, "se", -100, -100)).toEqual(R(20, 20, 4, 4));
    expect(resizeRect(rect, "nw", 100, 100)).toEqual(R(56, 46, 4, 4));
  });
  it("keeps the rect inside the screen", () => {
    expect(resizeRect(rect, "se", 100, 100)).toEqual(R(20, 20, 80, 80));
    expect(resizeRect(rect, "nw", -100, -100)).toEqual(R(0, 0, 60, 50));
  });
});

describe("pointerToPct", () => {
  it("converts client pixels to frame percent", () => {
    const frame = { left: 100, top: 50, width: 400, height: 200 };
    expect(pointerToPct(300, 150, frame)).toEqual({ x: 50, y: 50 });
    expect(pointerToPct(100, 50, frame)).toEqual({ x: 0, y: 0 });
  });
});

describe("hitTest", () => {
  const buttons = [
    { id: "under", rect: R(10, 10, 40, 40) },
    { id: "over", rect: R(30, 30, 40, 40) },
    { id: "noRect", rect: null },
  ];
  it("hits the topmost (last-rendered) button", () => {
    expect(hitTest(buttons, 40, 40)).toEqual({ id: "over", part: "body" });
    expect(hitTest(buttons, 15, 15)).toEqual({ id: "under", part: "body" });
  });
  it("a corner handle beats the body", () => {
    expect(hitTest(buttons, 30, 30, 2)).toEqual({ id: "over", part: "nw" });
    expect(hitTest(buttons, 70, 70, 2)).toEqual({ id: "over", part: "se" });
    expect(hitTest(buttons, 69, 31, 2)).toEqual({ id: "over", part: "ne" });
    expect(hitTest(buttons, 31, 69, 2)).toEqual({ id: "over", part: "sw" });
  });
  it("misses empty space and rect-less buttons", () => {
    expect(hitTest(buttons, 90, 5)).toBeNull();
    expect(hitTest([{ id: "noRect", rect: null }], 50, 50)).toBeNull();
  });
});

describe("updateButton", () => {
  const cfg = {
    "//": "doc string must survive round-trips",
    buttons: [
      { id: "b1", label: "A", action: "key:a", extra: "unknown field" },
      { id: "b2", label: "B", action: "" },
    ],
  };
  it("patches one button immutably, preserving unknown keys", () => {
    const next = updateButton(cfg, "b1", { label: "AA" });
    expect(next.buttons[0]).toEqual({
      id: "b1",
      label: "AA",
      action: "key:a",
      extra: "unknown field",
    });
    expect((next as unknown as { "//": string })["//"]).toBe("doc string must survive round-trips");
    expect(cfg.buttons[0].label).toBe("A"); // original untouched
    expect(next.buttons[1]).toBe(cfg.buttons[1]); // other entries by reference
  });
});

describe("configProblems", () => {
  it("mirrors the server verdicts (same validators, same strings)", () => {
    const problems = configProblems({
      buttons: [
        { id: "b1", action: "mouse:left", rect: { x: 2, y: 30, w: 44, h: 30 }, vibrate: 5 },
        { id: "b2", action: "key:nope" },
        { id: "b3", action: "key:a", rect: [1, 2] },
        { id: "b4", action: "key:b", vibrate: "loud" },
        { action: "key:c" },
      ],
    });
    expect(problems).toEqual([
      'button b2: unknown action "key:nope"',
      "button b3: bad rect ignored (need {x,y,w,h} in % of the screen)",
      "button b4: bad vibrate ignored (need true/false or a pulse in ms)",
      "button without id skipped",
    ]);
  });
  it("adds the duplicate-id check the server tolerates", () => {
    expect(configProblems({ buttons: [{ id: "b1" }, { id: "b1" }] })).toEqual([
      "button b1: duplicate id",
    ]);
  });
  it("mirrors the edge/pad verdicts (same strings as the server)", () => {
    expect(
      configProblems({
        buttons: [
          { id: "b1", edge: "bottom", pad: 0 },
          { id: "b2", edge: "up" },
          { id: "b3", edge: "bottom" }, // shared edge is fine — both fire
          { id: "b4", edge: "any" }, // any edge is fine
          { id: "b5", pad: "sometimes" },
        ],
      }),
    ).toEqual([
      "button b2: bad edge ignored (need left/right/top/bottom/any)",
      'button b5: bad pad ignored (need a gamepad button index or "any")',
    ]);
  });
  it("rejects a config without a buttons array", () => {
    expect(configProblems(null)).toEqual(['config must be {"buttons": [...]}']);
    expect(configProblems({})).toEqual(['config must be {"buttons": [...]}']);
  });
  it("accepts the clean case", () => {
    expect(configProblems({ buttons: [{ id: "b1", action: "key:a", visible: true }] })).toEqual([]);
  });
});

describe("nextFreeRect", () => {
  it("takes the top-left corner on an empty screen", () => {
    expect(nextFreeRect([])).toEqual(R(0, 0, 20, 16));
  });
  it("skips past existing buttons in reading order", () => {
    // a full-width bar across the top forces the next row down
    expect(nextFreeRect([R(0, 0, 100, 20)])).toEqual(R(0, 21, 20, 16));
    // top-left taken → next slot to the right
    expect(nextFreeRect([R(0, 0, 20, 16)])).toEqual(R(21, 0, 20, 16));
  });
  it("honors a custom size", () => {
    expect(nextFreeRect([], 44, 30)).toEqual(R(0, 0, 44, 30));
  });
  it("falls back to center when the screen is full", () => {
    expect(nextFreeRect([R(0, 0, 100, 100)], 20, 16)).toEqual(R(40, 42, 20, 16));
  });
});

describe("parseVibrateField", () => {
  it("maps the inspector text to config values", () => {
    expect(parseVibrateField("")).toEqual({ vibrate: undefined });
    expect(parseVibrateField("true")).toEqual({ vibrate: true });
    expect(parseVibrateField("false")).toEqual({ vibrate: false });
    expect(parseVibrateField(" 25 ")).toEqual({ vibrate: 25 });
    expect(parseVibrateField("loud")).toBeNull();
    expect(parseVibrateField("-3")).toBeNull();
  });
});

describe("composeAction", () => {
  it("composes the three kinds", () => {
    expect(composeAction("none", "left", [], "")).toBe("");
    expect(composeAction("mouse", "right", [], "")).toBe("mouse:right");
    expect(composeAction("key", "left", [], "r")).toBe("key:r");
  });
  it("orders modifiers ctrl,shift,alt,win regardless of input order", () => {
    expect(composeAction("key", "left", ["win", "ctrl", "shift"], "f")).toBe(
      "key:ctrl+shift+win+f",
    );
  });
  it("supports mods-only combos and returns empty for nothing pressed", () => {
    expect(composeAction("key", "left", ["ctrl", "shift"], "")).toBe("key:ctrl+shift");
    expect(composeAction("key", "left", [], "")).toBe("");
  });
});

describe("decomposeAction", () => {
  it("handles none and mouse", () => {
    expect(decomposeAction(undefined)).toEqual({ kind: "none" });
    expect(decomposeAction("")).toEqual({ kind: "none" });
    expect(decomposeAction("mouse:middle")).toEqual({ kind: "mouse", button: "middle" });
  });
  it("decomposes combos into builder spellings", () => {
    expect(decomposeAction("key:ctrl+shift+f")).toEqual({
      kind: "key",
      mods: ["ctrl", "shift"],
      key: "f",
    });
    expect(decomposeAction("key:control+a")).toEqual({ kind: "key", mods: ["ctrl"], key: "a" });
    expect(decomposeAction("key:pgup")).toEqual({ kind: "key", mods: [], key: "pageup" });
  });
  it("round-trips the canonical-spelling traps", () => {
    expect(decomposeAction("key:capslock")).toEqual({ kind: "key", mods: [], key: "capslock" });
    expect(decomposeAction("key:numpad7")).toEqual({ kind: "key", mods: [], key: "numpad7" });
  });
  it("supports mods-only combos", () => {
    expect(decomposeAction("key:ctrl+shift")).toEqual({
      kind: "key",
      mods: ["ctrl", "shift"],
      key: "",
    });
  });
  it("marks the unrepresentable as raw (advanced text row)", () => {
    expect(decomposeAction("key:a+b")).toEqual({ kind: "raw" }); // two main keys
    expect(decomposeAction("key:cmd+c")).toEqual({ kind: "raw" }); // cmd is not a checkbox
    expect(decomposeAction("key:nope")).toEqual({ kind: "raw" }); // unknown key
    expect(decomposeAction("gamepad:a")).toEqual({ kind: "raw" }); // unparseable
  });
  it("round-trips through composeAction for representable specs", () => {
    for (const spec of ["mouse:left", "key:r", "key:ctrl+shift+f", "key:ctrl+shift"]) {
      const d = decomposeAction(spec);
      if (d.kind === "mouse") expect(composeAction("mouse", d.button, [], "")).toBe(spec);
      if (d.kind === "key") expect(composeAction("key", "left", d.mods, d.key)).toBe(spec);
    }
  });
});

describe("resetButton", () => {
  it("returns the slot to factory empty, dropping every optional field", () => {
    const cfg = {
      "//": "doc",
      buttons: [
        {
          id: "b4",
          label: "DUCK",
          action: "key:r",
          visible: true,
          rect: { x: 1, y: 2, w: 3, h: 4 },
          vibrate: 5,
          edge: "any",
          pad: 0,
        },
        { id: "b5", label: "B5", action: "", visible: false },
      ],
    };
    const next = resetButton(cfg, "b4");
    expect(next.buttons[0]).toEqual({ id: "b4", label: "B4", action: "", visible: false });
    expect(next.buttons[1]).toBe(cfg.buttons[1]); // others by reference
    expect((next as unknown as { "//": string })["//"]).toBe("doc"); // config keys survive
    expect(cfg.buttons[0].label).toBe("DUCK"); // original untouched
  });
});

describe("decomposeVibrate", () => {
  it("maps config values to the feedback form state", () => {
    expect(decomposeVibrate(undefined)).toEqual({ mode: "default", ms: 10 });
    expect(decomposeVibrate(true)).toEqual({ mode: "default", ms: 10 });
    expect(decomposeVibrate(false)).toEqual({ mode: "off", ms: 10 });
    expect(decomposeVibrate(0)).toEqual({ mode: "off", ms: 10 });
    expect(decomposeVibrate(25)).toEqual({ mode: "custom", ms: 25 });
    expect(decomposeVibrate("loud")).toEqual({ mode: "default", ms: 10 });
  });
});

describe("parsePadField", () => {
  it("maps the inspector text to config values", () => {
    expect(parsePadField("")).toEqual({ pad: undefined });
    expect(parsePadField("any")).toEqual({ pad: "any" });
    expect(parsePadField(" ANY ")).toEqual({ pad: "any" });
    expect(parsePadField("7")).toEqual({ pad: 7 });
    expect(parsePadField("0")).toEqual({ pad: 0 });
    expect(parsePadField("-1")).toBeNull();
    expect(parsePadField("1.5")).toBeNull();
    expect(parsePadField("trigger")).toBeNull();
  });
});

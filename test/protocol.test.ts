import { describe, it, expect } from "vitest";
import { parseMessage } from "../lib/protocol.ts";

describe("parseMessage", () => {
  it("parses aim", () => {
    expect(parseMessage('{"type":"aim","u":0.5,"v":0.3,"t":123,"q":1}')).toEqual({
      type: "aim",
      u: 0.5,
      v: 0.3,
      t: 123,
      q: 1,
    });
  });
  it("parses fire", () => {
    expect(parseMessage('{"type":"fire"}')).toEqual({ type: "fire" });
  });
  it("parses calib", () => {
    const m = parseMessage('{"type":"calib","stage":"corner","i":0,"x":0.1,"y":1.2,"z":-0.5}');
    expect(m).toMatchObject({ type: "calib", stage: "corner", i: 0 });
  });
  it("parses all state values", () => {
    for (const tracking of ["good", "limited", "lost"])
      expect(parseMessage(JSON.stringify({ type: "state", tracking }))).toEqual({
        type: "state",
        tracking,
      });
  });
  it("parses button (protocol v2)", () => {
    expect(parseMessage('{"type":"button","id":"b7","down":true}')).toEqual({
      type: "button",
      id: "b7",
      down: true,
    });
    expect(parseMessage('{"type":"button","id":"b7"}')).toBeNull();
    expect(parseMessage('{"type":"button","down":true}')).toBeNull();
  });
  it("accepts Buffer input", () => {
    expect(parseMessage(Buffer.from('{"type":"fire"}'))).toEqual({ type: "fire" });
  });
  it("rejects garbage", () => {
    expect(parseMessage("not json")).toBeNull();
    expect(parseMessage("42")).toBeNull();
    expect(parseMessage("null")).toBeNull();
    expect(parseMessage('{"type":"warp"}')).toBeNull();
    expect(parseMessage('{"u":0.5,"v":0.5}')).toBeNull();
  });
  it("rejects structurally wrong messages", () => {
    expect(parseMessage('{"type":"aim","u":"x","v":0.5}')).toBeNull();
    expect(parseMessage('{"type":"aim","u":0.5}')).toBeNull();
    expect(parseMessage('{"type":"calib"}')).toBeNull();
    expect(parseMessage('{"type":"state","tracking":"great"}')).toBeNull();
  });
});

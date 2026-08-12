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
  it("keeps a valid aim monitor index and drops a malformed one, not the sample", () => {
    expect(parseMessage('{"type":"aim","u":0.5,"v":0.3,"m":2}')).toEqual({
      type: "aim",
      u: 0.5,
      v: 0.3,
      m: 2,
    });
    for (const bad of ["0", "-1", "1.5", '"two"']) {
      expect(parseMessage(`{"type":"aim","u":0.5,"v":0.3,"m":${bad}}`)).toEqual({
        type: "aim",
        u: 0.5,
        v: 0.3,
      });
    }
  });
  it("passes the calib monitor index through and drops a malformed one", () => {
    expect(parseMessage('{"type":"calib","stage":"corner","i":1,"m":2}')).toMatchObject({
      i: 1,
      m: 2,
    });
    for (const bad of ["0", "1.5", '"two"']) {
      const m = parseMessage(`{"type":"calib","stage":"target","m":${bad}}`);
      expect(m).toMatchObject({ type: "calib", stage: "target" });
      expect(m).not.toHaveProperty("m");
    }
  });
  it("keeps the aim calibration tag only when it is the literal 1", () => {
    expect(parseMessage('{"type":"aim","u":0.5,"v":0.3,"m":1,"cal":1}')).toEqual({
      type: "aim",
      u: 0.5,
      v: 0.3,
      m: 1,
      cal: 1,
    });
    for (const bad of ["0", "2", "true", '"1"']) {
      expect(parseMessage(`{"type":"aim","u":0.5,"v":0.3,"cal":${bad}}`)).toEqual({
        type: "aim",
        u: 0.5,
        v: 0.3,
      });
    }
  });
  it("parses calib stage target (v2 additive)", () => {
    expect(parseMessage('{"type":"calib","stage":"target","m":2}')).toEqual({
      type: "calib",
      stage: "target",
      m: 2,
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

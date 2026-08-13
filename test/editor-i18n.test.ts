import { describe, it, expect } from "vitest";
import { translations, pickLanguage, makeT } from "../public/editor-i18n.js";

describe("translations", () => {
  it("de and it cover exactly the same keys as en (no missing, no extra)", () => {
    const en = Object.keys(translations.en).sort();
    expect(Object.keys(translations.de).sort()).toEqual(en);
    expect(Object.keys(translations.it).sort()).toEqual(en);
  });
});

describe("pickLanguage", () => {
  it("a stored supported choice wins over everything", () => {
    expect(pickLanguage(["de-DE"], "it")).toBe("it");
  });
  it("matches navigator languages by prefix, in order", () => {
    expect(pickLanguage(["de-CH", "en-US"], null)).toBe("de");
    expect(pickLanguage(["it-IT"], null)).toBe("it");
    expect(pickLanguage(["fr-FR", "it"], null)).toBe("it");
  });
  it("falls back to en for unknown, unsupported-stored, or empty input", () => {
    expect(pickLanguage(["fr-FR", "ja"], null)).toBe("en");
    expect(pickLanguage([], "klingon")).toBe("en");
    expect(pickLanguage([], null)).toBe("en");
  });
});

describe("makeT", () => {
  it("translates and interpolates {params}", () => {
    const t = makeT("de");
    expect(t("header.save")).toBe("Speichern");
    expect(t("status.saved", { rev: 3 })).toContain("(Rev 3)");
  });
  it("falls back to en for a missing key, then echoes the key", () => {
    const t = makeT("de");
    expect(makeT("it")("header.title")).toBe("Editor dei pulsanti");
    expect(t("no.such.key")).toBe("no.such.key");
  });
  it("an unknown language behaves as en", () => {
    expect(makeT("xx")("header.save")).toBe("Save");
  });
});

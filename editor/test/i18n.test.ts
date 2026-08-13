import { describe, it, expect } from "vitest";
import { en, de, it as itCatalog } from "../src/locales";
import i18n from "../src/i18n";

describe("locales", () => {
  it("de and it cover exactly the same keys as en", () => {
    const keys = Object.keys(en).sort();
    expect(Object.keys(de).sort()).toEqual(keys);
    expect(Object.keys(itCatalog).sort()).toEqual(keys);
  });
});

describe("i18n", () => {
  it("keeps flat dotted keys as literal keys", async () => {
    await i18n.changeLanguage("en");
    expect(i18n.t("header.title")).toBe("Button editor");
  });
  it("interpolates the single-brace placeholders the catalogs ship with", async () => {
    await i18n.changeLanguage("en");
    expect(i18n.t("status.saved", { rev: 3 })).toContain("(rev 3)");
    expect(i18n.t("placement.placed", { x: 1, y: 2, w: 3, h: 4 })).toBe(
      "placed at 1,2 — 3×4% of the screen",
    );
  });
  it("switches languages and falls back to en for unknown ones", async () => {
    await i18n.changeLanguage("de");
    expect(i18n.t("header.save")).toBe("Speichern");
    await i18n.changeLanguage("it");
    expect(i18n.t("header.save")).toBe("Salva");
    await i18n.changeLanguage("fr");
    expect(i18n.t("header.save")).toBe("Save");
  });
  it("echoes missing keys instead of rendering blanks", async () => {
    await i18n.changeLanguage("en");
    expect(i18n.t("no.such.key")).toBe("no.such.key");
  });
});

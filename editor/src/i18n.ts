// i18next setup for the editor. Two deliberate deviations from i18next's
// defaults keep the catalogs byte-identical to the old hand-rolled module:
// flat dotted keys (keySeparator: false — "status.saved" IS the key, not a
// path) and single-brace interpolation ({rev}, not {{rev}}). The detector
// reads/writes localStorage "pb.lang" — the exact key the old editor used,
// so stored language choices survive the migration.

import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";
import { en, de, it } from "./locales";

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      de: { translation: de },
      it: { translation: it },
    },
    fallbackLng: "en",
    supportedLngs: ["en", "de", "it"],
    nonExplicitSupportedLngs: true,
    keySeparator: false,
    nsSeparator: false,
    interpolation: { prefix: "{", suffix: "}", escapeValue: false },
    detection: {
      order: ["localStorage", "navigator"],
      lookupLocalStorage: "pb.lang",
      caches: ["localStorage"],
    },
  });

export default i18n;

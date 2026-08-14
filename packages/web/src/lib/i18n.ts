import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import adminEn from "@/locales/en/admin.json";
import binsEn from "@/locales/en/bins.json";
import calibrationEn from "@/locales/en/calibration.json";
import cardsEn from "@/locales/en/cards.json";
import collectionsEn from "@/locales/en/collections.json";
import commonEn from "@/locales/en/common.json";
import gamesEn from "@/locales/en/games.json";
import notificationsEn from "@/locales/en/notifications.json";
import reviewEn from "@/locales/en/review.json";
import scannerEn from "@/locales/en/scanner.json";
import settingsEn from "@/locales/en/settings.json";

/**
 * English only, deliberately — but still a list.
 *
 * German shipped alongside it for a while and was never once read; every
 * feature since paid a translation tax for a locale nobody switched to. The
 * translations are gone, the machinery is not: strings stay in namespaced
 * locale files behind `t()`, so adding a language is dropping a folder next to
 * `en/` and naming it here, not retrofitting i18n through the whole app.
 *
 * Note this is the *UI* locale. Which language a card catalog is printed in is
 * a separate axis entirely — see LANGUAGE_LABELS in lib/languages.ts, which
 * still covers German and is unaffected by any of this.
 */
export const SUPPORTED_LANGUAGES = ["en"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

// Language names are shown in their own language regardless of the active UI
// locale (i.e. a future "Deutsch" stays "Deutsch" when viewing the English UI).
export const LANGUAGE_NATIVE_NAMES: Record<SupportedLanguage, string> = {
  en: "English",
};

const LANGUAGE_STORAGE_KEY = "language";

const resources = {
  en: {
    common: commonEn,
    collections: collectionsEn,
    scanner: scannerEn,
    bins: binsEn,
    calibration: calibrationEn,
    cards: cardsEn,
    review: reviewEn,
    notifications: notificationsEn,
    admin: adminEn,
    games: gamesEn,
    settings: settingsEn,
  },
};

/**
 * A stored preference still wins over the default.
 *
 * With one language this can only ever return "en", and the lookup looks
 * pointless — it is the part that makes adding a language a data change. It
 * also quietly retires a stale choice: a browser that picked "de" back when
 * that existed has it in localStorage, and the membership check drops it
 * rather than initialising i18next to a locale with no resources behind it.
 */
function getInitialLanguage(): SupportedLanguage {
  const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
  if ((SUPPORTED_LANGUAGES as readonly string[]).includes(stored ?? "")) {
    return stored as SupportedLanguage;
  }
  return "en";
}

void i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: getInitialLanguage(),
    fallbackLng: "en",
    ns: Object.keys(resources.en),
    defaultNS: "common",
    interpolation: { escapeValue: false },
  });

i18n.on("languageChanged", (lng) => {
  localStorage.setItem(LANGUAGE_STORAGE_KEY, lng);
});

export default i18n;

/**
 * i18n system — lightweight context-based internationalization.
 *
 * Supports 8 locales: English (en), Vietnamese (vi), Chinese (zh), Japanese
 * (ja), Korean (ko), Spanish (es), French (fr), German (de).
 *
 * Each locale lives in its own module under `./i18n/<code>.ts`; this file
 * assembles them into a single record, exposes locale metadata for the
 * language picker, and provides the React context. Per-key fallback to
 * English guarantees a value even if a locale is incomplete.
 */
import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import type { Lang, LocaleMeta, Translations } from "./i18n/types.js";
import { isLang } from "./i18n/types.js";
import { en } from "./i18n/en.js";
import { vi } from "./i18n/vi.js";
import { zh } from "./i18n/zh.js";
import { ja } from "./i18n/ja.js";
import { ko } from "./i18n/ko.js";
import { es } from "./i18n/es.js";
import { fr } from "./i18n/fr.js";
import { de } from "./i18n/de.js";

export type { Lang, LocaleMeta, Translations } from "./i18n/types.js";
export { isLang } from "./i18n/types.js";

/** localStorage key under which the chosen language is persisted. */
const LANG_KEY = "mya-lang";

/** All locales keyed by code. */
const TRANSLATIONS: Record<Lang, Translations> = { en, vi, zh, ja, ko, es, fr, de };

/** Base (English) dictionary used for per-key fallback. */
const EN: Translations = en;

/**
 * Display metadata for the language picker. Endonyms (the language's own name
 * for itself) are shown in the UI — no country flags, since languages aren't
 * countries and flag pairings inevitably create political mismappings.
 */
export const LOCALE_META: Record<Lang, LocaleMeta> = {
  en: { name: "English", endonym: "English" },
  vi: { name: "Vietnamese", endonym: "Tiếng Việt" },
  zh: { name: "Chinese", endonym: "中文" },
  ja: { name: "Japanese", endonym: "日本語" },
  ko: { name: "Korean", endonym: "한국어" },
  es: { name: "Spanish", endonym: "Español" },
  fr: { name: "French", endonym: "Français" },
  de: { name: "German", endonym: "Deutsch" },
};

/** Ordered list of locale codes for the picker. */
export const LOCALES: Lang[] = ["en", "vi", "zh", "ja", "ko", "es", "fr", "de"];

/**
 * Merge a (possibly partial) translation set over the English base. Missing
 * keys fall back to English so the UI always renders *something*. Pure and
 * unit-testable independent of React.
 */
export function withEnglishFallback(t: Partial<Translations> | undefined): Translations {
  return { ...EN, ...t };
}

/** Read the persisted language, falling back to English when missing/invalid. */
export function loadStoredLang(): Lang {
  const stored = localStorage.getItem(LANG_KEY);
  return isLang(stored) ? stored : "en";
}

/** Persist the chosen language. */
export function storeLang(l: Lang): void {
  localStorage.setItem(LANG_KEY, l);
}

/** Resolve a full translation view for a language code (with EN fallback). */
export function tFor(lang: Lang): Translations {
  return withEnglishFallback(TRANSLATIONS[lang]);
}

interface I18nContextValue {
  lang: Lang;
  t: Translations;
  setLang: (lang: Lang) => void;
  toggleLang: () => void;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => loadStoredLang());

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    storeLang(l);
  }, []);

  // Backward-compat toggle: cycle through the previously two-state en↔vi pair
  // so legacy callers (collapsed-sidebar globe) keep working deterministically.
  const toggleLang = useCallback(() => {
    setLangState((prev) => {
      const next: Lang = prev === "en" ? "vi" : "en";
      storeLang(next);
      return next;
    });
  }, []);

  const t = useMemo(() => tFor(lang), [lang]);

  return (
    <I18nContext.Provider value={{ lang, t, setLang, toggleLang }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}

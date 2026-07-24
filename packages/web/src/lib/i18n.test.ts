/**
 * i18n unit tests — pure logic (no DOM).
 *
 * Covers: every locale has the full English key set with non-empty values,
 * LOCALE_META carries the correct endonyms, isLang validates codes,
 * withEnglishFallback/tFor fall back to English for missing keys, and
 * loadStoredLang/storeLang persist + fall back correctly.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  LOCALES,
  LOCALE_META,
  withEnglishFallback,
  tFor,
  isLang,
  loadStoredLang,
  storeLang,
} from "@/lib/i18n";
import type { Lang, Translations } from "@/lib/i18n";
import { en } from "@/lib/i18n/en.js";
import { vi } from "@/lib/i18n/vi.js";
import { zh } from "@/lib/i18n/zh.js";
import { ja } from "@/lib/i18n/ja.js";
import { ko } from "@/lib/i18n/ko.js";
import { es } from "@/lib/i18n/es.js";
import { fr } from "@/lib/i18n/fr.js";
import { de } from "@/lib/i18n/de.js";

/** Minimal localStorage shim for the persistence tests. */
function makeLocalStorage(): Storage {
  let store: Record<string, string> = {};
  return {
    get length() {
      return Object.keys(store).length;
    },
    clear: () => {
      store = {};
    },
    getItem: (key: string) => (key in store ? store[key]! : null),
    key: (index: number) => Object.keys(store)[index] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
  };
}

const LOCALE_FILES: Record<Lang, Translations> = { en, vi, zh, ja, ko, es, fr, de };
const EN_KEYS = Object.keys(en) as Array<keyof Translations>;

describe("[unit] i18n locale completeness", () => {
  it("ships exactly 8 locales", () => {
    expect(LOCALES).toHaveLength(8);
    expect(LOCALES).toEqual(["en", "vi", "zh", "ja", "ko", "es", "fr", "de"]);
  });

  it("LOCALE_META covers every locale code", () => {
    expect(Object.keys(LOCALE_META).sort()).toEqual([...LOCALES].sort());
  });

  it.each(LOCALES)("locale %s has the full English key set with non-empty strings", (code) => {
    const t = LOCALE_FILES[code];
    expect(t).toBeDefined();
    const keys = Object.keys(t).sort();
    expect(keys).toEqual([...EN_KEYS].sort());
    for (const key of EN_KEYS) {
      const value = t[key];
      expect(typeof value, `${code}.${String(key)} should be a string`).toBe("string");
      expect(value!.trim().length, `${code}.${String(key)} should be non-empty`).toBeGreaterThan(0);
    }
  });

  it("English is the base/fallback dictionary", () => {
    expect(en.chat).toBe("Chat");
    expect(en.loading).toBe("Loading…");
  });
});

describe("[unit] LOCALE_META endonyms", () => {
  const EXPECTED: Record<Lang, string> = {
    en: "English",
    vi: "Tiếng Việt",
    zh: "中文",
    ja: "日本語",
    ko: "한국어",
    es: "Español",
    fr: "Français",
    de: "Deutsch",
  };

  it.each(LOCALES)("locale %s has the correct endonym", (code) => {
    expect(LOCALE_META[code].endonym).toBe(EXPECTED[code]);
    expect(LOCALE_META[code].name.length).toBeGreaterThan(0);
  });
});

describe("[unit] isLang type guard", () => {
  it("accepts all supported codes", () => {
    for (const code of LOCALES) expect(isLang(code)).toBe(true);
  });

  it("rejects unknown / malformed values", () => {
    expect(isLang("xx")).toBe(false);
    expect(isLang("EN")).toBe(false);
    expect(isLang("")).toBe(false);
    expect(isLang(null)).toBe(false);
    expect(isLang(undefined)).toBe(false);
    expect(isLang(123)).toBe(false);
  });
});

describe("[unit] English fallback", () => {
  it("fills missing keys from English", () => {
    const empty = withEnglishFallback({});
    expect(empty.chat).toBe(en.chat);
    expect(empty.save).toBe(en.save);
    expect(Object.keys(empty).sort()).toEqual([...EN_KEYS].sort());
  });

  it("overrides provided keys and keeps the rest from English", () => {
    const partial = withEnglishFallback({ chat: "X" } as Partial<Translations>);
    expect(partial.chat).toBe("X");
    expect(partial.save).toBe(en.save); // fallback
  });

  it("tFor returns the locale's own values", () => {
    expect(tFor("en").chat).toBe("Chat");
    expect(tFor("vi").chat).toBe("Trò chuyện");
    expect(tFor("zh").chat).toBe("聊天");
    expect(tFor("ja").sessions).toBe("セッション");
    expect(tFor("ko").tools).toBe("도구");
    expect(tFor("es").cancel).toBe("Cancelar");
    expect(tFor("fr").save).toBe("Enregistrer");
    expect(tFor("de").delete).toBe("Löschen");
  });

  it("withEnglishFallback handles undefined input", () => {
    expect(withEnglishFallback(undefined).chat).toBe(en.chat);
  });
});

describe("[unit] lang persistence", () => {
  beforeEach(() => {
    (globalThis as { localStorage: Storage }).localStorage = makeLocalStorage();
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  });

  it("storeLang persists and loadStoredLang reads it back", () => {
    storeLang("ja");
    expect(localStorage.getItem("mya-lang")).toBe("ja");
    expect(loadStoredLang()).toBe("ja");

    storeLang("de");
    expect(loadStoredLang()).toBe("de");
  });

  it("loadStoredLang falls back to en for an invalid stored value", () => {
    localStorage.setItem("mya-lang", "garbage");
    expect(loadStoredLang()).toBe("en");
  });

  it("loadStoredLang falls back to en when nothing is stored", () => {
    expect(loadStoredLang()).toBe("en");
  });
});

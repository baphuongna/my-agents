import { describe, it, expect } from "vitest";
import { en } from "./en.js";
import { vi } from "./vi.js";
import { zh } from "./zh.js";
import { ja } from "./ja.js";
import { ko } from "./ko.js";
import { es } from "./es.js";
import { fr } from "./fr.js";
import { de } from "./de.js";
import type { Translations } from "./types.js";

const locales: Record<string, Translations> = { en, vi, zh, ja, ko, es, fr, de };

describe("[unit] i18n locales", () => {
  it("all 8 locales present", () => {
    expect(Object.keys(locales)).toHaveLength(8);
  });

  it("each locale has chat + sessions + save + cancel", () => {
    for (const [code, t] of Object.entries(locales)) {
      expect(t.chat, `${code}.chat`).toBeTypeOf("string");
      expect(t.sessions, `${code}.sessions`).toBeTypeOf("string");
      expect(t.save, `${code}.save`).toBeTypeOf("string");
      expect(t.cancel, `${code}.cancel`).toBeTypeOf("string");
    }
  });

  it("en is the base locale with English strings", () => {
    expect(en.chat).toBe("Chat");
    expect(en.sessions).toBe("Sessions");
    expect(en.save).toBe("Save");
  });

  it("vi has Vietnamese strings (not English)", () => {
    expect(vi.chat).not.toBe("Chat");
  });

  it("all locales have same key count as en", () => {
    const enKeys = Object.keys(en).length;
    for (const [code, t] of Object.entries(locales)) {
      expect(Object.keys(t).length, `${code} key count`).toBe(enKeys);
    }
  });
});

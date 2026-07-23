/**
 * Tests for the CJK bigram tokenizer (Phase 3 §3.1).
 *
 * Covers: isCjk codepoint ranges, tokenize (ASCII fast path, Korean/Chinese/
 * Japanese bigrams, mixed text, lone CJK char), and containsCjk detection.
 */
import { describe, it, expect } from "vitest";
import { isCjk, tokenize, containsCjk } from "./cjk-tokenizer.js";

// ── isCjk ─────────────────────────────────────────────────────────────────

describe("isCjk", () => {
  it("returns true for Hangul syllables (AC00–D7A3)", () => {
    expect(isCjk(0xac00)).toBe(true); // 가
    expect(isCjk(0xd7a3)).toBe(true); // 힣
    expect(isCjk(0xce98)).toBe(true); // 캘
  });

  it("returns true for Hangul Jamo (1100–11FF)", () => {
    expect(isCjk(0x1100)).toBe(true);
    expect(isCjk(0x11ff)).toBe(true);
  });

  it("returns true for Hangul compat Jamo (3130–318F)", () => {
    expect(isCjk(0x3130)).toBe(true);
    expect(isCjk(0x318f)).toBe(true);
  });

  it("returns true for CJK unified ideographs (4E00–9FFF)", () => {
    expect(isCjk(0x4e00)).toBe(true); // 一
    expect(isCjk(0x9fff)).toBe(true);
    expect(isCjk(0x4e16)).toBe(true); // 世
    expect(isCjk(0x754c)).toBe(true); // 界
  });

  it("returns true for CJK ext A (3400–4DBF)", () => {
    expect(isCjk(0x3400)).toBe(true);
    expect(isCjk(0x4dbf)).toBe(true);
  });

  it("returns true for CJK compat ideographs (F900–FAFF)", () => {
    expect(isCjk(0xf900)).toBe(true);
    expect(isCjk(0xfaff)).toBe(true);
  });

  it("returns true for Hiragana (3040–309F)", () => {
    expect(isCjk(0x3040)).toBe(true);
    expect(isCjk(0x309f)).toBe(true);
  });

  it("returns true for Katakana (30A0–30FF)", () => {
    expect(isCjk(0x30a0)).toBe(true);
    expect(isCjk(0x30ff)).toBe(true);
  });

  it("returns false for ASCII", () => {
    expect(isCjk(0x41)).toBe(false); // A
    expect(isCjk(0x7a)).toBe(false); // z
    expect(isCjk(0x30)).toBe(false); // 0
  });

  it("returns false for Latin-1 Supplement", () => {
    expect(isCjk(0xe9)).toBe(false); // é
    expect(isCjk(0xfc)).toBe(false); // ü
  });

  it("returns false for CJK punctuation (3000–303F)", () => {
    expect(isCjk(0x3000)).toBe(false); // ideographic space
    expect(isCjk(0x3001)).toBe(false); // 、
    expect(isCjk(0x303f)).toBe(false);
  });

  it("returns false for zero / negative", () => {
    expect(isCjk(0)).toBe(false);
    expect(isCjk(-1)).toBe(false);
  });
});

// ── tokenize ──────────────────────────────────────────────────────────────

describe("tokenize", () => {
  it("ASCII fast path returns single token", () => {
    const result = tokenize("hello");
    expect(result).toEqual([{ token: "hello", start: 0, end: 5 }]);
  });

  it("empty string returns single empty token (ASCII fast path)", () => {
    const result = tokenize("");
    expect(result).toEqual([{ token: "", start: 0, end: 0 }]);
  });

  it("ASCII with spaces/digits still takes fast path", () => {
    const result = tokenize("test 123 foo");
    expect(result).toEqual([{ token: "test 123 foo", start: 0, end: 12 }]);
  });

  // Korean bigrams — the canonical example from the C implementation
  it("Korean: 캘린더 → overlapping bigrams [캘린][린더]", () => {
    const result = tokenize("캘린더");
    expect(result).toEqual([
      { token: "캘린", start: 0, end: 6 },
      { token: "린더", start: 3, end: 9 },
    ]);
  });

  it("Korean 2-char run → single bigram", () => {
    const result = tokenize("한국");
    expect(result).toEqual([{ token: "한국", start: 0, end: 6 }]);
  });

  it("Korean 4-char run → 3 bigrams", () => {
    const result = tokenize("캘린더앱");
    expect(result).toHaveLength(3);
    expect(result[0]!.token).toBe("캘린");
    expect(result[1]!.token).toBe("린더");
    expect(result[2]!.token).toBe("더앱");
  });

  // Chinese bigrams
  it("Chinese: 世界 → single bigram", () => {
    const result = tokenize("世界");
    expect(result).toEqual([{ token: "世界", start: 0, end: 6 }]);
  });

  it("Chinese 3-char run → 2 overlapping bigrams", () => {
    const result = tokenize("日本語");
    expect(result).toHaveLength(2);
    expect(result[0]!.token).toBe("日本");
    expect(result[1]!.token).toBe("本語");
  });

  // Japanese Hiragana
  it("Japanese Hiragana: こんにちは → 4 bigrams", () => {
    const result = tokenize("こんにちは"); // 5 chars
    expect(result).toHaveLength(4);
    expect(result[0]!.token).toBe("こん");
    expect(result[3]!.token).toBe("ちは");
  });

  // Lone CJK char → unigram
  it("lone CJK char → unigram", () => {
    const result = tokenize("한");
    expect(result).toEqual([{ token: "한", start: 0, end: 3 }]);
  });

  it("lone CJK char surrounded by ASCII → unigram + ASCII tokens", () => {
    const result = tokenize("a한b");
    // 'a' (ASCII), '한' (CJK unigram), 'b' (ASCII)
    expect(result).toHaveLength(3);
    expect(result[0]!.token).toBe("a");
    expect(result[1]!.token).toBe("한");
    expect(result[2]!.token).toBe("b");
  });

  // Mixed text
  it("mixed ASCII + CJK: hello世界 → 3 tokens", () => {
    const result = tokenize("hello世界");
    expect(result).toHaveLength(2);
    expect(result[0]!.token).toBe("hello");
    expect(result[0]!.start).toBe(0);
    expect(result[0]!.end).toBe(5);
    expect(result[1]!.token).toBe("世界");
    expect(result[1]!.start).toBe(5);
    expect(result[1]!.end).toBe(11); // 5 + 3 + 3
  });

  it("mixed CJK + ASCII + CJK: 한hello국", () => {
    const result = tokenize("한hello국");
    expect(result).toHaveLength(3);
    expect(result[0]!.token).toBe("한"); // unigram
    expect(result[1]!.token).toBe("hello");
    expect(result[2]!.token).toBe("국"); // unigram
  });

  it("multiple CJK runs separated by space: 한국 일본", () => {
    const result = tokenize("한국 일본");
    expect(result).toHaveLength(3);
    expect(result[0]!.token).toBe("한국");
    expect(result[1]!.token).toBe(" "); // space is non-CJK
    expect(result[2]!.token).toBe("일본");
  });

  // Byte offsets are consistent
  it("byte offsets are monotonically non-decreasing", () => {
    const result = tokenize("hello世界한국");
    for (let i = 1; i < result.length; i++) {
      expect(result[i]!.start).toBeGreaterThanOrEqual(result[i - 1]!.start);
    }
  });

  // Non-ASCII non-CJK (é, ü) → treated as non-CJK segment
  it("non-ASCII non-CJK text → single token", () => {
    const result = tokenize("café");
    expect(result).toEqual([{ token: "café", start: 0, end: 5 }]);
    // c=1, a=1, f=1, é=2 bytes → total 5
  });
});

// ── containsCjk ───────────────────────────────────────────────────────────

describe("containsCjk", () => {
  it("returns false for pure ASCII", () => {
    expect(containsCjk("hello world")).toBe(false);
    expect(containsCjk("")).toBe(false);
    expect(containsCjk("test123")).toBe(false);
  });

  it("returns true for Korean text", () => {
    expect(containsCjk("캘린더")).toBe(true);
    expect(containsCjk("hello 한국")).toBe(true);
  });

  it("returns true for Chinese text", () => {
    expect(containsCjk("世界")).toBe(true);
  });

  it("returns true for Japanese text", () => {
    expect(containsCjk("こんにちは")).toBe(true);
    expect(containsCjk("カタカナ")).toBe(true);
  });

  it("returns false for non-ASCII non-CJK", () => {
    expect(containsCjk("café")).toBe(false);
    expect(containsCjk("naïve")).toBe(false);
    expect(containsCjk("日本語")).toBe(true); // 日本語 is CJK
  });

  it("returns false for CJK punctuation only", () => {
    expect(containsCjk("　")).toBe(false); // ideographic space U+3000
    expect(containsCjk("、")).toBe(false); // U+3001
  });
});

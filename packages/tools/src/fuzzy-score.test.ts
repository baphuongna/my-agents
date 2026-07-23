/**
 * fuzzyScore tests — cheap subsequence fuzzy match (§11 R35 file-search).
 *
 * Source of truth: packages/tools/src/search-index.ts `fuzzyScore`.
 *
 * fuzzyScore(name, q):
 *   - substring match → 10 + (q.length / name.length) * 5
 *   - subsequence match → 1 + maxContiguous + earlyBonus(max(0, 5-firstMatch))
 *   - not a subsequence → 0
 *
 * NOTE: fuzzyScore is case-SENSITIVE by design; callers lowercase first.
 */
import { describe, it, expect } from "vitest";
import { fuzzyScore } from "./search-index.js";

describe("fuzzyScore — no match", () => {
  it("returns 0 when q is not a subsequence of name", () => {
    expect(fuzzyScore("hello", "xyz")).toBe(0);
  });

  it("returns 0 when q has chars not present in name", () => {
    expect(fuzzyScore("abc", "abd")).toBe(0);
  });

  it("returns 0 when q is longer than name", () => {
    expect(fuzzyScore("ab", "abc")).toBe(0);
  });
});

describe("fuzzyScore — substring bonus", () => {
  it("an exact substring scores in the 10–15 bonus band", () => {
    const s = fuzzyScore("readme.md", "readme");
    expect(s).toBeGreaterThanOrEqual(10);
    expect(s).toBeLessThanOrEqual(15);
  });

  it("a longer query relative to name yields a higher substring bonus", () => {
    const short = fuzzyScore("readme", "r"); // q.len/name.len = 1/6
    const long = fuzzyScore("readme", "readme"); // q.len/name.len = 1
    expect(long).toBeGreaterThan(short);
  });

  it("the full-name substring matches at exactly the top of the band", () => {
    // name.includes(q) with q===name → 10 + (1)*5 = 15
    expect(fuzzyScore("readme", "readme")).toBe(15);
  });
});

describe("fuzzyScore — subsequence scoring", () => {
  it("a pure subsequence (gaps) scores positive but below a substring", () => {
    const sub = fuzzyScore("router.ts", "rts"); // r…t…s subsequence, not substring
    const direct = fuzzyScore("router.ts", "out"); // contiguous substring
    expect(sub).toBeGreaterThan(0);
    expect(sub).toBeLessThan(direct);
  });

  it("a contiguous run scores higher than a scattered subsequence", () => {
    const contiguous = fuzzyScore("abcdefgh", "abc"); // maxContiguous=3
    const scattered = fuzzyScore("aXbXcX", "abc"); // maxContiguous=1
    expect(contiguous).toBeGreaterThan(scattered);
  });

  it("an earlier first match scores higher (early bonus)", () => {
    // 'x' matches at index 0 vs index 5 — both are single-char subsequences
    const early = fuzzyScore("xab", "x"); // firstMatch=0 → bonus 5
    const late = fuzzyScore("abcdex", "x"); // firstMatch=5 → bonus 0
    expect(early).toBeGreaterThan(late);
  });
});

describe("fuzzyScore — edge cases", () => {
  it("is case-sensitive (uppercase query against lowercase name misses)", () => {
    expect(fuzzyScore("readme", "README")).toBe(0);
  });

  it("a single matching char scores positive", () => {
    expect(fuzzyScore("readme", "r")).toBeGreaterThan(0);
  });

  it("monotonic: matching the whole prefix of a long name", () => {
    // "src/app" as a substring of "src/app/index.ts"
    const s = fuzzyScore("src/app/index.ts", "src/app");
    expect(s).toBeGreaterThanOrEqual(10);
  });
});

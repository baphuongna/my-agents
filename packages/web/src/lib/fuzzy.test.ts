/**
 * fuzzy subsequence scorer unit tests — pure logic, no DOM.
 *
 * Covers: empty query, exact/prefix/word-boundary bonuses, multi-token AND
 * semantics, ranking + stable tie-break, and edge cases (no match, case
 * insensitivity).
 */
import { describe, it, expect } from "vitest";
import {
  fuzzyScore,
  fuzzyScoreMulti,
  fuzzyRank,
  SCORE_EXACT,
} from "@/lib/fuzzy";

describe("[unit] fuzzyScore basics", () => {
  it("empty query scores 0 with no positions", () => {
    const m = fuzzyScore("anything", "");
    expect(m).toEqual({ score: 0, positions: [] });
  });

  it("returns null when query is not a subsequence", () => {
    expect(fuzzyScore("abc", "xyz")).toBeNull();
    expect(fuzzyScore("gpt-4o", "zzz")).toBeNull();
    expect(fuzzyScore("hello", "hx")).toBeNull(); // 'x' absent
  });

  it("is case-insensitive", () => {
    expect(fuzzyScore("GPT-4O", "g4o")).not.toBeNull();
    expect(fuzzyScore("Claude", "CLAU")).not.toBeNull();
  });

  it("returns the matched character indices", () => {
    // g(0) p(1) t(2) -(3) 4(4) o(5)
    const m = fuzzyScore("gpt-4o", "g4o");
    expect(m).not.toBeNull();
    expect(m!.positions).toEqual([0, 4, 5]);
  });

  it("exact full match earns the +20 exact bonus", () => {
    const m = fuzzyScore("abc", "abc");
    expect(m).not.toBeNull();
    expect(m!.positions).toEqual([0, 1, 2]);
    expect(m!.score).toBeGreaterThan(SCORE_EXACT);
  });

  it("prefix matches score higher than scattered matches", () => {
    const prefix = fuzzyScore("alpha-beta", "alpha");
    const scattered = fuzzyScore("x-a-l-p-h-a", "alpha");
    expect(prefix!.score).toBeGreaterThan(scattered!.score);
  });

  it("a query that matches a known prefix ranks the intended target first", () => {
    const sonnet = fuzzyScore("claude-sonnet-4", "son4");
    const gpt = fuzzyScore("gpt-4o", "g4o");
    expect(sonnet!.score).toBeGreaterThan(gpt!.score);
  });

  it("gives a word-boundary bonus after separators", () => {
    // 's' right after '-' sits on a word boundary; a scattered 's' in the
    // middle of a word does not. The boundary match should outscore.
    const boundary = fuzzyScore("foo-bar", "b");
    const mid = fuzzyScore("foobar", "b");
    expect(boundary!.score).toBeGreaterThan(mid!.score);
  });

  it("contiguous runs outscore scattered matches of equal length", () => {
    const contiguous = fuzzyScore("abcdef", "abc");
    const scattered = fuzzyScore("axbxcx", "abc");
    expect(contiguous!.score).toBeGreaterThan(scattered!.score);
  });

  it("prefers shorter targets for the same prefix query", () => {
    const short = fuzzyScore("abc", "abc");
    const long = fuzzyScore("abcdef", "abc");
    // both prefix, but exact match on the short one dominates.
    expect(short!.score).toBeGreaterThan(long!.score);
  });
});

describe("[unit] fuzzyScoreMulti AND semantics", () => {
  it("returns score 0 / empty positions for empty or whitespace query", () => {
    expect(fuzzyScoreMulti("abc", "")).toEqual({ score: 0, positions: [] });
    expect(fuzzyScoreMulti("abc", "   ")).toEqual({ score: 0, positions: [] });
  });

  it("every token must match (returns null if any fails)", () => {
    expect(fuzzyScoreMulti("claude-sonnet-4", "son 4")).not.toBeNull();
    expect(fuzzyScoreMulti("claude-sonnet", "son 4")).toBeNull(); // no '4'
    expect(fuzzyScoreMulti("claude-sonnet-4", "xyz son")).toBeNull();
  });

  it("aggregates positions across tokens (union, sorted)", () => {
    const m = fuzzyScoreMulti("claude-sonnet-4", "son 4");
    expect(m).not.toBeNull();
    // s(7)o(8)n(9) + 4(14)
    expect(m!.positions).toEqual([7, 8, 9, 14]);
  });

  it("sums the per-token scores", () => {
    const single = fuzzyScore("claude-sonnet-4", "son");
    const multi = fuzzyScoreMulti("claude-sonnet-4", "son 4");
    expect(multi!.score).toBeGreaterThan(single!.score);
  });
});

describe("[unit] fuzzyRank filtering + ordering", () => {
  const items = [
    { name: "gpt-4o" },
    { name: "claude-sonnet-4" },
    { name: "llama-3" },
  ];
  const toText = (i: { name: string }) => i.name;

  it("empty query returns every item in original order, score 0", () => {
    const ranked = fuzzyRank(items, "", toText);
    expect(ranked).toHaveLength(items.length);
    expect(ranked.map((r) => r.item.name)).toEqual([
      "gpt-4o",
      "claude-sonnet-4",
      "llama-3",
    ]);
    for (const r of ranked) expect(r.score).toBe(0);
  });

  it("drops non-matching items and sorts by score descending", () => {
    const ranked = fuzzyRank(items, "4", toText);
    // only gpt-4o and claude-sonnet-4 contain '4'
    expect(ranked).toHaveLength(2);
    const names = ranked.map((r) => r.item.name);
    expect(names).toContain("gpt-4o");
    expect(names).toContain("claude-sonnet-4");
    expect(ranked[0]!.score).toBeGreaterThanOrEqual(ranked[1]!.score);
  });

  it("breaks score ties by original index (stable ordering)", () => {
    // All items start with 'l'? No — use a query that scores identically.
    const dupes = [{ n: "aaa" }, { n: "aaa" }, { n: "aaa" }];
    const ranked = fuzzyRank(dupes, "aaa", (i) => i.n);
    // identical scores → original order preserved
    expect(ranked.map((r) => r.item)).toEqual(dupes);
  });

  it("returns an empty list when nothing matches", () => {
    expect(fuzzyRank(items, "zzzzzz", toText)).toEqual([]);
  });
});

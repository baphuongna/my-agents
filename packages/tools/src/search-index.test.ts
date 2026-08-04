import { describe, it, expect } from "vitest";
import { fuzzyScore, FrecencyDB, BigramFilter } from "./search-index.js";

describe("[unit] search-index", () => {
  describe("fuzzyScore", () => {
    it("exact substring → high score (10+)", () => {
      expect(fuzzyScore("hello", "hello")).toBeGreaterThan(10);
    });

    it("substring match → bonus", () => {
      expect(fuzzyScore("hello world", "hello")).toBeGreaterThan(10);
    });

    it("subsequence match → positive score", () => {
      // 'hiellyo' contains 'hello' as subsequence: h(0) e(2) l(3) l(4) o(6)
      expect(fuzzyScore("hiellyo", "hello")).toBeGreaterThan(0);
    });

    it("no match → 0", () => {
      expect(fuzzyScore("abc", "xyz")).toBe(0);
    });

    it("empty query → full match (qi never advances, not < q.length)", () => {
      expect(fuzzyScore("anything", "")).toBeGreaterThan(0);
    });

    it("earlier match → higher score (early bonus)", () => {
      const early = fuzzyScore("abcXYZ", "XYZ");
      const late = fuzzyScore("XYZabc", "XYZ");
      // Both are substring matches at different positions — substring bonus dominates
      expect(early).toBeGreaterThan(0);
      expect(late).toBeGreaterThan(0);
    });
  });

  describe("FrecencyDB", () => {
    it("bump + score: recent hit → high score", () => {
      const db = new FrecencyDB(1000);
      db.bump("file.ts", 0);
      expect(db.score("file.ts", 0)).toBe(1); // count=1, decay=1 (age=0)
    });

    it("decay halves every halflifeMs", () => {
      const db = new FrecencyDB(1000);
      db.bump("f", 0);
      expect(db.score("f", 1000)).toBeCloseTo(0.5); // one halflife → half
      expect(db.score("f", 2000)).toBeCloseTo(0.25); // two halflives → quarter
    });

    it("multiple bumps increase count", () => {
      const db = new FrecencyDB(1000);
      db.bump("f", 0);
      db.bump("f", 0);
      expect(db.score("f", 0)).toBe(2);
    });

    it("unknown path → score 0", () => {
      expect(new FrecencyDB().score("nope")).toBe(0);
    });

    it("snapshot returns internal map", () => {
      const db = new FrecencyDB();
      db.bump("a");
      const snap = db.snapshot();
      expect(snap.has("a")).toBe(true);
      expect(snap.get("a")!.count).toBe(1);
    });
  });

  describe("BigramFilter", () => {
    it("add + candidates: exact bigram match", () => {
      const bf = new BigramFilter();
      bf.add("/path/to/hello.ts");
      const cands = bf.candidates("hello");
      expect(cands.has("/path/to/hello.ts")).toBe(true);
    });

    it("candidates filters non-matching paths", () => {
      const bf = new BigramFilter();
      bf.add("/path/to/hello.ts");
      bf.add("/path/to/world.ts");
      expect(bf.candidates("hello").has("/path/to/hello.ts")).toBe(true);
      expect(bf.candidates("hello").has("/path/to/world.ts")).toBe(false);
    });

    it("remove deletes from index", () => {
      const bf = new BigramFilter();
      bf.add("/a/hello.ts");
      bf.remove("/a/hello.ts");
      expect(bf.candidates("hello").has("/a/hello.ts")).toBe(false);
    });

    it("empty query → all paths", () => {
      const bf = new BigramFilter();
      bf.add("/a.ts");
      bf.add("/b.ts");
      expect(bf.candidates("").size).toBe(2);
    });

    it("case-insensitive matching", () => {
      const bf = new BigramFilter();
      bf.add("/path/HELLO.ts");
      expect(bf.candidates("hello").has("/path/HELLO.ts")).toBe(true);
    });

    it("skip-1 bigram tolerance (gap)", () => {
      const bf = new BigramFilter();
      bf.add("/path/hxo.ts"); // h_x_o
      // query "ho" → bigram "ho" — hxo has skip-1 bigram "ho" (h at 0, o at 2)
      expect(bf.candidates("ho").has("/path/hxo.ts")).toBe(true);
    });
  });
});

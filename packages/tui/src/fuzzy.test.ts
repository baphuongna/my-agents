import { describe, it, expect } from "vitest";
import { fuzzyMatch, fuzzyFilter } from "./fuzzy.ts";

describe("fuzzyMatch", () => {
	it("an empty query matches everything with score 0", () => {
		expect(fuzzyMatch("", "anything")).toEqual({ matches: true, score: 0 });
		expect(fuzzyMatch("", "")).toEqual({ matches: true, score: 0 });
	});

	it("matches when query chars appear in order as a subsequence", () => {
		expect(fuzzyMatch("abc", "axbxc").matches).toBe(true);
		expect(fuzzyMatch("abc", "aabbcc").matches).toBe(true);
	});

	it("does not match when query chars are out of order", () => {
		expect(fuzzyMatch("cba", "abc").matches).toBe(false);
	});

	it("does not match when a query character is absent", () => {
		expect(fuzzyMatch("xyz", "abc").matches).toBe(false);
	});

	it("returns no match when the query is longer than the text", () => {
		expect(fuzzyMatch("longquery", "hi").matches).toBe(false);
	});

	it("is case-insensitive", () => {
		expect(fuzzyMatch("ABC", "abc").matches).toBe(true);
		expect(fuzzyMatch("abc", "ABC").matches).toBe(true);
		expect(fuzzyMatch("AbC", "aBc").matches).toBe(true);
	});

	it("scores an exact match better than a scattered subsequence", () => {
		const exact = fuzzyMatch("cat", "cat");
		const scattered = fuzzyMatch("cat", "c___a___t");
		expect(exact.matches).toBe(true);
		expect(scattered.matches).toBe(true);
		// lower score == better match
		expect(exact.score).toBeLessThan(scattered.score);
	});

	it("scores word-boundary matches better than mid-word matches", () => {
		const atBoundary = fuzzyMatch("b", "bar");
		const midWord = fuzzyMatch("b", "abc");
		expect(atBoundary.matches).toBe(true);
		expect(midWord.matches).toBe(true);
		expect(atBoundary.score).toBeLessThan(midWord.score);
	});

	it("swaps adjacent alpha/numeric groups so abc123 matches 123abc", () => {
		expect(fuzzyMatch("abc123", "123abc").matches).toBe(true);
		expect(fuzzyMatch("123abc", "abc123").matches).toBe(true);
	});

	it("handles unicode (CJK) subsequence matching", () => {
		expect(fuzzyMatch("日本", "日本語").matches).toBe(true);
		expect(fuzzyMatch("語", "日本語").matches).toBe(true);
		expect(fuzzyMatch("xyz", "日本語").matches).toBe(false);
	});
});

describe("fuzzyFilter", () => {
	const items = ["apple", "application", "banana", "grape", "apricot"];

	it("returns all items unchanged for an empty or whitespace query", () => {
		expect(fuzzyFilter(items, "", (s) => s)).toEqual(items);
		expect(fuzzyFilter(items, "   ", (s) => s)).toEqual(items);
	});

	it("keeps only items that fuzzy-match the query", () => {
		const result = fuzzyFilter(items, "app", (s) => s);
		expect(result).toContain("apple");
		expect(result).toContain("application");
		expect(result).not.toContain("banana");
	});

	it("returns an empty array when nothing matches", () => {
		expect(fuzzyFilter(items, "zzz", (s) => s)).toEqual([]);
	});

	it("sorts best matches first (prefix before contained-only)", () => {
		const result = fuzzyFilter(items, "ap", (s) => s);
		expect(result.length).toBeGreaterThan(0);
		const grapeIdx = result.indexOf("grape");
		const appleIdx = result.indexOf("apple");
		if (grapeIdx !== -1 && appleIdx !== -1) {
			expect(appleIdx).toBeLessThan(grapeIdx);
		}
	});

	it("requires all whitespace-separated tokens to match", () => {
		const objs = [{ t: "foo bar" }, { t: "foo baz" }, { t: "qux bar" }];
		const result = fuzzyFilter(objs, "foo bar", (o) => o.t);
		expect(result).toHaveLength(1);
		expect(result[0]!.t).toBe("foo bar");
	});

	it("supports slash-separated tokens", () => {
		const objs = [
			{ t: "src/index.ts" },
			{ t: "test/index.ts" },
			{ t: "src/other.ts" },
		];
		const result = fuzzyFilter(objs, "src index", (o) => o.t);
		expect(result.map((o) => o.t)).toContain("src/index.ts");
		expect(result.map((o) => o.t)).not.toContain("test/index.ts");
	});

	it("excludes items where any single token fails to match", () => {
		const objs = [{ t: "foo bar" }, { t: "foo qux" }];
		const result = fuzzyFilter(objs, "foo bar", (o) => o.t);
		expect(result).toHaveLength(1);
		expect(result[0]!.t).toBe("foo bar");
	});

	it("works with a custom getText accessor", () => {
		const objs = [{ name: "alpha" }, { name: "beta" }];
		const result = fuzzyFilter(objs, "alp", (o) => o.name);
		expect(result).toHaveLength(1);
		expect(result[0]!.name).toBe("alpha");
	});
});

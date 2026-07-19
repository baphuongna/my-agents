/**
 * Tests cho tokenization — SPEC §5.3 edge cases.
 *
 * Ported from pi-skill-search/test/text.test.ts — imports adapted to ESM (.js).
 */
import { describe, expect, it } from "vitest";
import { tokenize } from "./text.js";

describe("tokenize", () => {
	it("returns empty set for empty string", () => {
		expect(tokenize("")).toEqual(new Set());
	});

	it("filters single-char tokens", () => {
		expect(tokenize("a")).toEqual(new Set());
		expect(tokenize("I am R")).toEqual(new Set(["am"]));
	});

	it("lowercases and handles 3D", () => {
		expect(tokenize("3D")).toEqual(new Set(["3d"]));
	});

	it("filters single letter R", () => {
		expect(tokenize("R")).toEqual(new Set());
	});

	it("splits hyphenated names", () => {
		expect(tokenize("single-cell")).toEqual(new Set(["single", "cell"]));
	});

	it("splits underscore names", () => {
		expect(tokenize("PyTorch_Lightning")).toEqual(new Set(["pytorch", "lightning"]));
	});

	it("strips Unicode diacritics", () => {
		// naïve → nave after removing non-alphanumeric
		expect(tokenize("naïve")).toEqual(new Set(["nave"]));
	});

	it("handles 10K-char input without throwing", () => {
		const long = "abc ".repeat(2500);
		const result = tokenize(long);
		expect(result).toContain("abc");
		expect(result.size).toBe(1);
	});

	it("deduplicates repeated words", () => {
		const result = tokenize("hello hello world world");
		expect(result).toEqual(new Set(["hello", "world"]));
	});

	it("removes punctuation", () => {
		const result = tokenize("hello, world! (test)");
		expect(result).toEqual(new Set(["hello", "world", "test"]));
	});

	it("handles slash-separated paths", () => {
		const result = tokenize("path/to/file");
		expect(result).toEqual(new Set(["path", "file"]));
	});

	it("preserves numbers", () => {
		const result = tokenize("python3 version 2.7");
		expect(result).toContain("python3");
		expect(result).toContain("version");
		// "2.7" becomes "27" after removing punctuation
		expect(result).toContain("27");
	});
});

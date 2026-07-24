/**
 * Tests for word-boundary navigation helpers.
 * Source: ./word-navigation.ts
 */
import { describe, it, expect } from "vitest";
import { findWordBackward, findWordForward } from "./word-navigation.ts";

describe("findWordBackward", () => {
	it("returns 0 when the cursor is already at the start", () => {
		expect(findWordBackward("hello world", 0)).toBe(0);
	});

	it("skips trailing whitespace then stops at the previous word boundary", () => {
		// cursor after the final 'd' (index 11)
		expect(findWordBackward("hello world", 11)).toBe(6);
	});

	it("moves from the middle of a word to its start", () => {
		expect(findWordBackward("hello", 3)).toBe(0);
	});

	it("respects punctuation boundaries", () => {
		// "foo.bar" cursor at 7 → start of "bar" (4)
		expect(findWordBackward("foo.bar", 7)).toBe(4);
	});

	it("skips a single atomic segment when isAtomicSegment matches", () => {
		const marker = "\x1b[200~abc\x1b[201~";
		const text = `x ${marker}`;
		const result = findWordBackward(text, text.length, {
			segment: (t) => [{ segment: t, index: 0, isWordLike: true }],
			isAtomicSegment: (s) => s === text,
		});
		expect(result).toBe(0);
	});
});

describe("findWordForward", () => {
	it("returns text.length when the cursor is already at the end", () => {
		expect(findWordForward("hello", 5)).toBe(5);
	});

	it("moves from the start of a word to its end", () => {
		expect(findWordForward("hello", 0)).toBe(5);
	});

	it("skips the whitespace gap between two words", () => {
		// cursor at 5 (after "hello") → skips the space to the end of "world"
		expect(findWordForward("hello world", 5)).toBe(11);
	});

	it("stops at the next word starting from the beginning", () => {
		expect(findWordForward("hello world", 0)).toBe(5);
	});
});

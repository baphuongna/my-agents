/**
 * Tests for pure-logic utilities in utils.ts.
 *
 * This file covers functions NOT already tested in sanitize.test.ts
 * (which covers extractAnsiCode, visibleWidth, normalizeTerminalOutput,
 * and truncateToWidth).
 */
import { describe, it, expect } from "vitest";
import {
	wrapTextWithAnsi,
	sliceByColumn,
	sliceWithWidth,
	applyBackgroundToLine,
	isWhitespaceChar,
	isPunctuationChar,
	getGraphemeSegmenter,
	getWordSegmenter,
	extractSegments,
	visibleWidth,
} from "./utils.ts";

// =============================================================================
// Segmenter singletons
// =============================================================================

describe("getGraphemeSegmenter", () => {
	it("returns an Intl.Segmenter", () => {
		const seg = getGraphemeSegmenter();
		expect(seg).toBeInstanceOf(Intl.Segmenter);
	});

	it("returns the same singleton instance", () => {
		expect(getGraphemeSegmenter()).toBe(getGraphemeSegmenter());
	});

	it("segments text into grapheme clusters", () => {
		const seg = getGraphemeSegmenter();
		const segments = [...seg.segment("ab")].map((s) => s.segment);
		expect(segments).toEqual(["a", "b"]);
	});
});

describe("getWordSegmenter", () => {
	it("returns an Intl.Segmenter", () => {
		const seg = getWordSegmenter();
		expect(seg).toBeInstanceOf(Intl.Segmenter);
	});

	it("returns the same singleton instance", () => {
		expect(getWordSegmenter()).toBe(getWordSegmenter());
	});

	it("segments text into words", () => {
		const seg = getWordSegmenter();
		const words = [...seg.segment("hello world")].filter((s) => s.isWordLike).map((s) => s.segment);
		expect(words).toEqual(["hello", "world"]);
	});

	it("grapheme and word segmenters are distinct instances", () => {
		expect(getGraphemeSegmenter()).not.toBe(getWordSegmenter());
	});
});

// =============================================================================
// Character classification
// =============================================================================

describe("isWhitespaceChar", () => {
	it("returns true for space", () => {
		expect(isWhitespaceChar(" ")).toBe(true);
	});

	it("returns true for tab and newline", () => {
		expect(isWhitespaceChar("\t")).toBe(true);
		expect(isWhitespaceChar("\n")).toBe(true);
	});

	it("returns false for letters", () => {
		expect(isWhitespaceChar("a")).toBe(false);
		expect(isWhitespaceChar("Z")).toBe(false);
	});

	it("returns false for digits", () => {
		expect(isWhitespaceChar("5")).toBe(false);
	});

	it("returns false for punctuation", () => {
		expect(isWhitespaceChar(".")).toBe(false);
	});
});

describe("isPunctuationChar", () => {
	it("returns true for common punctuation", () => {
		expect(isPunctuationChar(".")).toBe(true);
		expect(isPunctuationChar(",")).toBe(true);
		expect(isPunctuationChar("!")).toBe(true);
		expect(isPunctuationChar("?")).toBe(true);
		expect(isPunctuationChar(";")).toBe(true);
		expect(isPunctuationChar(":")).toBe(true);
	});

	it("returns true for bracket-type punctuation", () => {
		expect(isPunctuationChar("(")).toBe(true);
		expect(isPunctuationChar(")")).toBe(true);
		expect(isPunctuationChar("[")).toBe(true);
		expect(isPunctuationChar("{")).toBe(true);
		expect(isPunctuationChar("<")).toBe(true);
	});

	it("returns true for operators", () => {
		expect(isPunctuationChar("+")).toBe(true);
		expect(isPunctuationChar("-")).toBe(true);
		expect(isPunctuationChar("=")).toBe(true);
		expect(isPunctuationChar("/")).toBe(true);
		expect(isPunctuationChar("*")).toBe(true);
	});

	it("returns false for letters and digits", () => {
		expect(isPunctuationChar("a")).toBe(false);
		expect(isPunctuationChar("Z")).toBe(false);
		expect(isPunctuationChar("0")).toBe(false);
	});

	it("returns false for whitespace", () => {
		expect(isPunctuationChar(" ")).toBe(false);
		expect(isPunctuationChar("\t")).toBe(false);
	});
});

// =============================================================================
// applyBackgroundToLine
// =============================================================================

describe("applyBackgroundToLine", () => {
	it("pads short lines and applies background function", () => {
		const result = applyBackgroundToLine("hi", 5, (t) => `[${t}]`);
		expect(result).toBe("[hi   ]");
	});

	it("does not pad when line already meets width", () => {
		const result = applyBackgroundToLine("hello", 5, (t) => `<${t}>`);
		expect(result).toBe("<hello>");
	});

	it("does not pad when line exceeds width", () => {
		const result = applyBackgroundToLine("hello world", 3, (t) => `*${t}*`);
		expect(result).toBe("*hello world*");
	});

	it("passes only visible content (ANSI excluded from width calc)", () => {
		// \x1b[31m is zero-width; visible width of "hi" = 2
		const result = applyBackgroundToLine("\x1b[31mhi", 4, (t) => t.replace(/\x1b/g, "E"));
		// padding = 4 - 2 = 2 spaces
		expect(result).toContain("  ");
		expect(result.endsWith("  ")).toBe(true);
	});

	it("handles empty line by padding fully", () => {
		const result = applyBackgroundToLine("", 3, (t) => `[${t}]`);
		expect(result).toBe("[   ]");
	});
});

// =============================================================================
// wrapTextWithAnsi
// =============================================================================

describe("wrapTextWithAnsi", () => {
	it("returns empty array element for empty string", () => {
		expect(wrapTextWithAnsi("", 10)).toEqual([""]);
	});

	it("returns single line when text fits", () => {
		expect(wrapTextWithAnsi("hello", 10)).toEqual(["hello"]);
	});

	it("wraps at word boundaries", () => {
		expect(wrapTextWithAnsi("hello world", 5)).toEqual(["hello", "world"]);
	});

	it("wraps multiple words across lines", () => {
		expect(wrapTextWithAnsi("aaa bbb ccc", 3)).toEqual(["aaa", "bbb", "ccc"]);
	});

	it("breaks long words that exceed width", () => {
		expect(wrapTextWithAnsi("abcdefghij", 4)).toEqual(["abcd", "efgh", "ij"]);
	});

	it("splits on explicit newlines", () => {
		expect(wrapTextWithAnsi("a\nb", 10)).toEqual(["a", "b"]);
	});

	it("splits on carriage return newlines", () => {
		expect(wrapTextWithAnsi("a\r\nb", 10)).toEqual(["a", "b"]);
	});

	it("preserves ANSI color codes across wrapped lines", () => {
		const result = wrapTextWithAnsi("\x1b[31mhello world\x1b[0m", 5);
		expect(result).toHaveLength(2);
		// Both lines should contain the red color code
		expect(result[0]!).toContain("\x1b[31m");
		expect(result[1]!).toContain("\x1b[31m");
		// Visible widths should be within bounds
		expect(visibleWidth(result[0]!)).toBeLessThanOrEqual(5);
		expect(visibleWidth(result[1]!)).toBeLessThanOrEqual(5);
	});

	it("trims trailing whitespace from wrapped lines", () => {
		const result = wrapTextWithAnsi("hello    world", 8);
		expect(result[0]!).toBe("hello");
	});

	it("handles a single word that exactly fits", () => {
		expect(wrapTextWithAnsi("hello", 5)).toEqual(["hello"]);
	});

	it("handles CJK characters with width 2", () => {
		// Each CJK char is width 2; width=2 allows one char per line
		const result = wrapTextWithAnsi("日本語", 2);
		expect(result).toEqual(["日", "本", "語"]);
	});
});

// =============================================================================
// sliceByColumn
// =============================================================================

describe("sliceByColumn", () => {
	it("extracts a middle slice of ASCII", () => {
		expect(sliceByColumn("hello", 1, 3)).toBe("ell");
	});

	it("extracts from the beginning", () => {
		expect(sliceByColumn("hello", 0, 3)).toBe("hel");
	});

	it("returns empty string for zero length", () => {
		expect(sliceByColumn("hello", 0, 0)).toBe("");
	});

	it("returns empty string for negative length", () => {
		expect(sliceByColumn("hello", 0, -1)).toBe("");
	});

	it("handles start beyond content gracefully", () => {
		expect(sliceByColumn("hi", 10, 5)).toBe("");
	});

	it("slices CJK by display column (width 2 each)", () => {
		expect(sliceByColumn("日本語", 0, 2)).toBe("日");
		expect(sliceByColumn("日本語", 2, 2)).toBe("本");
	});

	it("with strict=true excludes wide chars that would exceed boundary", () => {
		// Width 3: with strict, the second CJK char (width 2) starting at col 2
		// would end at col 4 > 3, so it is excluded.
		expect(sliceByColumn("日本", 0, 3, true)).toBe("日");
	});

	it("with strict=false includes wide chars at boundary", () => {
		expect(sliceByColumn("日本", 0, 3, false)).toBe("日本");
	});
});

// =============================================================================
// sliceWithWidth
// =============================================================================

describe("sliceWithWidth", () => {
	it("returns text and width", () => {
		const result = sliceWithWidth("hello", 0, 3);
		expect(result.text).toBe("hel");
		expect(result.width).toBe(3);
	});

	it("returns empty for zero length", () => {
		const result = sliceWithWidth("hello", 0, 0);
		expect(result.text).toBe("");
		expect(result.width).toBe(0);
	});

	it("returns empty for negative length", () => {
		const result = sliceWithWidth("hello", 2, -1);
		expect(result.text).toBe("");
		expect(result.width).toBe(0);
	});

	it("tracks width for CJK characters", () => {
		const result = sliceWithWidth("日本", 0, 4);
		expect(result.text).toBe("日本");
		expect(result.width).toBe(4);
	});

	it("strict mode reports reduced width when wide char is excluded", () => {
		const result = sliceWithWidth("日本", 0, 3, true);
		expect(result.text).toBe("日");
		expect(result.width).toBe(2);
	});

	it("non-strict mode includes wide char at boundary with full width", () => {
		const result = sliceWithWidth("日本", 0, 3, false);
		expect(result.text).toBe("日本");
		expect(result.width).toBe(4);
	});
});

// =============================================================================
// extractSegments
// =============================================================================

describe("extractSegments", () => {
	it("extracts before and after segments around a gap", () => {
		const result = extractSegments("hello world", 5, 8, 5);
		expect(result.before).toBe("hello");
		expect(result.beforeWidth).toBe(5);
		expect(result.after).toBe("rld");
		expect(result.afterWidth).toBe(3);
	});

	it("extracts only before when afterLen is 0", () => {
		const result = extractSegments("hello", 2, 0, 0);
		expect(result.before).toBe("he");
		expect(result.beforeWidth).toBe(2);
		expect(result.after).toBe("");
		expect(result.afterWidth).toBe(0);
	});

	it("returns empty before when beforeEnd is 0", () => {
		const result = extractSegments("hello", 0, 0, 3);
		expect(result.before).toBe("");
		expect(result.beforeWidth).toBe(0);
		expect(result.after).toBe("hel");
		expect(result.afterWidth).toBe(3);
	});

	it("handles overlapping before and after regions", () => {
		// beforeEnd=3, afterStart=2: overlap at column 2
		// char 'l' at col 2: 2 < 3 && 2+1 <= 3 → goes to before
		const result = extractSegments("hello", 3, 2, 3);
		expect(result.before).toBe("hel");
		expect(result.beforeWidth).toBe(3);
		// after starts at col 2; 'l' at col 2 was consumed by before (2+1 <= 3)
		// 'l' at col 3: 3 >= 2 && 3 < 5 → after
		expect(result.after).toBe("lo");
		expect(result.afterWidth).toBe(2);
	});

	it("handles empty line", () => {
		const result = extractSegments("", 2, 5, 3);
		expect(result.before).toBe("");
		expect(result.beforeWidth).toBe(0);
		expect(result.after).toBe("");
		expect(result.afterWidth).toBe(0);
	});

	it("preserves inherited styling for after segment", () => {
		// ANSI red is active across the entire line; the after segment
		// (cols 4–5) should inherit the red styling that is active at that point.
		const line = "\x1b[31mabcdef\x1b[0m";
		const result = extractSegments(line, 2, 4, 2);
		expect(result.beforeWidth).toBe(2);
		expect(result.afterWidth).toBe(2);
		// After segment should contain inherited red styling
		expect(result.after).toContain("\x1b[31m");
	});
});

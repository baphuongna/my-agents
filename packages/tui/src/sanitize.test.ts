/**
 * Tests for text-sanitization behavior.
 *
 * NOTE: there is no standalone `sanitize.ts` module in this package; the
 * relevant pure-logic functions (ANSI extraction/stripping, visible-width for
 * Unicode, control-character normalization, and safe truncation at grapheme
 * boundaries) live in `utils.ts`. These tests exercise that behavior.
 */
import { describe, it, expect } from "vitest";
import {
	extractAnsiCode,
	visibleWidth,
	truncateToWidth,
	normalizeTerminalOutput,
} from "./utils.ts";

describe("ANSI escape extraction (extractAnsiCode)", () => {
	it("extracts a CSI SGR sequence", () => {
		const code = "\x1b[31m";
		const res = extractAnsiCode(code, 0);
		expect(res).not.toBeNull();
		expect(res!.code).toBe(code);
		expect(res!.length).toBe(code.length);
	});

	it("extracts CSI cursor/erase codes", () => {
		const res = extractAnsiCode("\x1b[2J", 0);
		expect(res).not.toBeNull();
		expect(res!.code).toBe("\x1b[2J");
	});

	it("extracts an OSC sequence terminated by BEL", () => {
		const code = "\x1b]8;;https://example.com\x07";
		const res = extractAnsiCode(code, 0);
		expect(res).not.toBeNull();
		expect(res!.code).toBe(code);
	});

	it("extracts an OSC sequence terminated by ST (ESC \\)", () => {
		const code = "\x1b]8;;https://example.com\x1b\\";
		const res = extractAnsiCode(code, 0);
		expect(res).not.toBeNull();
		expect(res!.code).toBe(code);
	});

	it("returns null at a non-escape position", () => {
		expect(extractAnsiCode("hello", 0)).toBeNull();
	});

	it("returns null for an unrecognized escape introducer", () => {
		expect(extractAnsiCode("\x1bZ", 0)).toBeNull();
	});
});

describe("ANSI stripping & visible width (visibleWidth)", () => {
	it("strips ANSI codes and counts only visible characters", () => {
		expect(visibleWidth("\x1b[31mhello\x1b[0m")).toBe(5);
	});

	it("returns 0 for the empty string", () => {
		expect(visibleWidth("")).toBe(0);
	});

	it("counts plain ASCII length directly", () => {
		expect(visibleWidth("hi there")).toBe(8);
	});

	it("counts CJK characters as width 2", () => {
		expect(visibleWidth("日本")).toBe(4);
	});

	it("counts emoji as width 2", () => {
		expect(visibleWidth("😀")).toBe(2);
	});

	it("does not count combining marks as additional width", () => {
		// 'e' + combining acute accent should be the same width as 'e' alone
		expect(visibleWidth("e\u0301")).toBe(visibleWidth("e"));
	});

	it("handles a mixed ASCII/CJK/emoji string", () => {
		expect(visibleWidth("a日b😀c")).toBe(1 + 2 + 1 + 2 + 1);
	});
});

describe("control-character normalization (normalizeTerminalOutput)", () => {
	it("expands tabs to three spaces", () => {
		expect(normalizeTerminalOutput("a\tb")).toBe("a   b");
	});

	it("leaves tabs embedded inside an ANSI/OSC sequence untouched", () => {
		const input = "\x1b]8;;\t\x07";
		expect(normalizeTerminalOutput(input)).toBe(input);
	});

	it("normalizes the Thai AM vowel (U+0E33) to its decomposition", () => {
		expect(normalizeTerminalOutput("\u0e33")).toBe("\u0e4d\u0e32");
	});

	it("passes plain ASCII through unchanged", () => {
		expect(normalizeTerminalOutput("plain text")).toBe("plain text");
	});
});

describe("safe truncation at character boundaries (truncateToWidth)", () => {
	it("returns text unchanged when it fits within maxWidth", () => {
		expect(truncateToWidth("hello", 10)).toBe("hello");
	});

	it("truncates and appends an ellipsis when too long", () => {
		const out = truncateToWidth("hello world", 8);
		expect(visibleWidth(out)).toBe(8);
		expect(out.includes("hello")).toBe(true);
		expect(out.includes("...")).toBe(true);
	});

	it("truncates safely without splitting a CJK grapheme", () => {
		const out = truncateToWidth("日本語テスト", 5);
		expect(visibleWidth(out)).toBeLessThanOrEqual(5);
		expect(out.includes("...")).toBe(true);
	});

	it("does not split an emoji sequence when truncating", () => {
		const out = truncateToWidth("😀😀😀😀", 3);
		expect(visibleWidth(out)).toBeLessThanOrEqual(3);
		expect(out.includes("...")).toBe(true);
	});

	it("returns an empty string for maxWidth <= 0", () => {
		expect(truncateToWidth("hello", 0)).toBe("");
		expect(truncateToWidth("hello", -1)).toBe("");
	});

	it("pads to exactly maxWidth when pad is true", () => {
		const out = truncateToWidth("hi", 5, "...", true);
		expect(visibleWidth(out)).toBe(5);
		expect(out.startsWith("hi")).toBe(true);
	});
});

/**
 * Tests for OSC 11 background-color and terminal color-scheme parsing.
 * Source: ./terminal-colors.ts
 */
import { describe, it, expect } from "vitest";
import {
	isOsc11BackgroundColorResponse,
	parseOsc11BackgroundColor,
	parseTerminalColorSchemeReport,
} from "./terminal-colors.ts";

describe("isOsc11BackgroundColorResponse", () => {
	it("matches a BEL-terminated rgb response", () => {
		expect(isOsc11BackgroundColorResponse("\x1b]11;rgb:1/2/3\x07")).toBe(true);
	});

	it("matches an ST-terminated response", () => {
		expect(isOsc11BackgroundColorResponse("\x1b]11;rgb:1/2/3\x1b\\")).toBe(true);
	});

	it("matches a hex response", () => {
		expect(isOsc11BackgroundColorResponse("\x1b]11;#101010\x07")).toBe(true);
	});

	it("returns false for unrelated data", () => {
		expect(isOsc11BackgroundColorResponse("hello")).toBe(false);
	});

	it("returns false for an OSC 10 (foreground) response", () => {
		expect(isOsc11BackgroundColorResponse("\x1b]10;rgb:1/2/3\x07")).toBe(false);
	});
});

describe("parseOsc11BackgroundColor", () => {
	it("parses a 6-digit hex color", () => {
		expect(parseOsc11BackgroundColor("\x1b]11;#ff8800\x07")).toEqual({ r: 255, g: 136, b: 0 });
	});

	it("parses rgb:ff/ff/ff as white", () => {
		expect(parseOsc11BackgroundColor("\x1b]11;rgb:ff/ff/ff\x07")).toEqual({ r: 255, g: 255, b: 255 });
	});

	it("parses rgb:00/00/00 as black", () => {
		expect(parseOsc11BackgroundColor("\x1b]11;rgb:00/00/00\x07")).toEqual({ r: 0, g: 0, b: 0 });
	});

	it("parses a 12-digit hex color", () => {
		expect(parseOsc11BackgroundColor("\x1b]11;#ffff00000000\x07")).toEqual({ r: 255, g: 0, b: 0 });
	});

	it("returns undefined for invalid data", () => {
		expect(parseOsc11BackgroundColor("nope")).toBeUndefined();
	});
});

describe("parseTerminalColorSchemeReport", () => {
	it("returns 'dark' for flag 1", () => {
		expect(parseTerminalColorSchemeReport("\x1b[?997;1n")).toBe("dark");
	});

	it("returns 'light' for flag 2", () => {
		expect(parseTerminalColorSchemeReport("\x1b[?997;2n")).toBe("light");
	});

	it("returns undefined for unrelated data", () => {
		expect(parseTerminalColorSchemeReport("hello")).toBeUndefined();
	});
});

/**
 * Tests for the pure terminal helpers exported from terminal.ts:
 *   - parseKeyboardProtocolNegotiationSequence
 *   - isAppleTerminalSession
 *   - normalizeAppleTerminalInput
 *
 * env-dependent tests snapshot/restore process.env.TERM_PROGRAM in
 * beforeEach/afterEach.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
	parseKeyboardProtocolNegotiationSequence,
	isAppleTerminalSession,
	normalizeAppleTerminalInput,
} from "./terminal.ts";

// The OSC sequence Apple Terminal lacks for Shift+Enter, which we synthesize.
const APPLE_SHIFT_ENTER = "\x1b[13;2u";

describe("parseKeyboardProtocolNegotiationSequence", () => {
	describe("kitty-flags", () => {
		it("parses a non-zero flags response", () => {
			expect(parseKeyboardProtocolNegotiationSequence("\x1b[?7u")).toEqual({
				type: "kitty-flags",
				flags: 7,
			});
		});

		it("parses a zero-flags response (flags: 0)", () => {
			expect(parseKeyboardProtocolNegotiationSequence("\x1b[?0u")).toEqual({
				type: "kitty-flags",
				flags: 0,
			});
		});

		it("parses multi-digit flags", () => {
			expect(parseKeyboardProtocolNegotiationSequence("\x1b[?15u")).toEqual({
				type: "kitty-flags",
				flags: 15,
			});
		});
	});

	describe("device-attributes", () => {
		it("parses a minimal DA response", () => {
			expect(parseKeyboardProtocolNegotiationSequence("\x1b[?c")).toEqual({
				type: "device-attributes",
			});
		});

		it("parses a DA response with attribute codes", () => {
			expect(parseKeyboardProtocolNegotiationSequence("\x1b[?62;1;2c")).toEqual({
				type: "device-attributes",
			});
		});

		it("parses a single-attribute DA response", () => {
			expect(parseKeyboardProtocolNegotiationSequence("\x1b[?1c")).toEqual({
				type: "device-attributes",
			});
		});
	});

	describe("invalid / non-negotiation input", () => {
		it("returns undefined for an empty string", () => {
			expect(parseKeyboardProtocolNegotiationSequence("")).toBeUndefined();
		});

		it("returns undefined for a regular key sequence (arrow key)", () => {
			expect(parseKeyboardProtocolNegotiationSequence("\x1b[A")).toBeUndefined();
		});

		it("returns undefined for plain text", () => {
			expect(parseKeyboardProtocolNegotiationSequence("hello")).toBeUndefined();
		});

		it("returns undefined for a truncated prefix", () => {
			// Missing the terminating 'u' / 'c'
			expect(parseKeyboardProtocolNegotiationSequence("\x1b[?1")).toBeUndefined();
		});

		it("returns undefined for a DA response without a leading '?'", () => {
			expect(parseKeyboardProtocolNegotiationSequence("\x1b[1c")).toBeUndefined();
		});
	});
});

describe("isAppleTerminalSession", () => {
	const originalTermProgram = process.env.TERM_PROGRAM;

	afterEach(() => {
		if (originalTermProgram === undefined) delete process.env.TERM_PROGRAM;
		else process.env.TERM_PROGRAM = originalTermProgram;
	});

	it("returns false for a non-Apple TERM_PROGRAM", () => {
		process.env.TERM_PROGRAM = "iTerm.app";
		expect(isAppleTerminalSession()).toBe(false);
	});

	it("returns false when TERM_PROGRAM is unset", () => {
		delete process.env.TERM_PROGRAM;
		expect(isAppleTerminalSession()).toBe(false);
	});

	it("only returns true on darwin when TERM_PROGRAM is Apple_Terminal", () => {
		process.env.TERM_PROGRAM = "Apple_Terminal";
		// Behavior is platform-dependent: true only on macOS.
		expect(isAppleTerminalSession()).toBe(process.platform === "darwin");
	});
});

describe("normalizeAppleTerminalInput", () => {
	describe("non-Apple terminal (passthrough)", () => {
		it("passes regular text through unchanged", () => {
			expect(normalizeAppleTerminalInput("hello", false, false)).toBe("hello");
		});

		it("passes a carriage return through even with shift", () => {
			expect(normalizeAppleTerminalInput("\r", false, true)).toBe("\r");
		});

		it("passes arrow-key sequences through unchanged", () => {
			expect(normalizeAppleTerminalInput("\x1b[A", false, false)).toBe("\x1b[A");
		});

		it("passes an empty string through unchanged", () => {
			expect(normalizeAppleTerminalInput("", false, false)).toBe("");
		});
	});

	describe("Apple terminal normalization", () => {
		it("converts Shift+Enter (\\r) into the kitty CSI-u sequence", () => {
			expect(normalizeAppleTerminalInput("\r", true, true)).toBe(APPLE_SHIFT_ENTER);
		});

		it("leaves a plain Enter (\\r) unchanged when shift is not pressed", () => {
			expect(normalizeAppleTerminalInput("\r", true, false)).toBe("\r");
		});

		it("leaves a newline (\\n) unchanged even with shift", () => {
			expect(normalizeAppleTerminalInput("\n", true, true)).toBe("\n");
		});

		it("passes regular ASCII through unchanged", () => {
			expect(normalizeAppleTerminalInput("abc", true, true)).toBe("abc");
		});

		it("passes function/arrow key sequences through unchanged", () => {
			expect(normalizeAppleTerminalInput("\x1bOA", true, false)).toBe("\x1bOA");
		});

		it("passes an empty string through unchanged", () => {
			expect(normalizeAppleTerminalInput("", true, true)).toBe("");
		});
	});
});

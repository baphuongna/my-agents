/**
 * Tests for keyboard input parsing (keys.ts).
 *
 * Covers Kitty keyboard protocol parsing, legacy terminal sequences,
 * key matching, and printable-key decoding.
 */
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import {
	isKeyRelease,
	isKeyRepeat,
	matchesKey,
	parseKey,
	decodeKittyPrintable,
	decodePrintableKey,
	Key,
	isKittyProtocolActive,
	setKittyProtocolActive,
	type KeyId,
} from "./keys.ts";

// Reset global Kitty protocol state between tests to avoid cross-test leakage.
afterEach(() => {
	setKittyProtocolActive(false);
});

// =============================================================================
// Kitty protocol flag
// =============================================================================

describe("Kitty protocol flag (isKittyProtocolActive / setKittyProtocolActive)", () => {
	it("defaults to inactive", () => {
		setKittyProtocolActive(false);
		expect(isKittyProtocolActive()).toBe(false);
	});

	it("can be activated", () => {
		setKittyProtocolActive(true);
		expect(isKittyProtocolActive()).toBe(true);
	});

	it("can be deactivated after activation", () => {
		setKittyProtocolActive(true);
		expect(isKittyProtocolActive()).toBe(true);
		setKittyProtocolActive(false);
		expect(isKittyProtocolActive()).toBe(false);
	});
});

// =============================================================================
// isKeyRelease
// =============================================================================

describe("isKeyRelease", () => {
	it("returns true for a CSI-u release event", () => {
		expect(isKeyRelease("\x1b[97;1:3u")).toBe(true);
	});

	it("returns true for a tilde-style release event", () => {
		expect(isKeyRelease("\x1b[3;1:3~")).toBe(true);
	});

	it("returns true for an arrow-key release event", () => {
		expect(isKeyRelease("\x1b[1;1:3A")).toBe(true);
	});

	it("returns false for a press event", () => {
		expect(isKeyRelease("\x1b[97;1:1u")).toBe(false);
	});

	it("returns false for a repeat event", () => {
		expect(isKeyRelease("\x1b[97;1:2u")).toBe(false);
	});

	it("returns false for non-Kitty data", () => {
		expect(isKeyRelease("\r")).toBe(false);
		expect(isKeyRelease("a")).toBe(false);
		expect(isKeyRelease("")).toBe(false);
	});

	it("returns false for bracketed paste content that happens to contain :3u", () => {
		expect(isKeyRelease("\x1b[200~data:3u")).toBe(false);
	});

	it("returns false for bracketed paste containing a MAC-like address", () => {
		expect(isKeyRelease("\x1b[200~90:62:3F:A5:12")).toBe(false);
	});

	it("returns true for home/end release events (:3H / :3F)", () => {
		expect(isKeyRelease("\x1b[1;1:3H")).toBe(true);
		expect(isKeyRelease("\x1b[1;1:3F")).toBe(true);
	});
});

// =============================================================================
// isKeyRepeat
// =============================================================================

describe("isKeyRepeat", () => {
	it("returns true for a CSI-u repeat event", () => {
		expect(isKeyRepeat("\x1b[97;1:2u")).toBe(true);
	});

	it("returns true for a tilde-style repeat event", () => {
		expect(isKeyRepeat("\x1b[3;1:2~")).toBe(true);
	});

	it("returns true for an arrow-key repeat event", () => {
		expect(isKeyRepeat("\x1b[1;1:2B")).toBe(true);
	});

	it("returns false for a press event", () => {
		expect(isKeyRepeat("\x1b[97;1:1u")).toBe(false);
	});

	it("returns false for a release event", () => {
		expect(isKeyRepeat("\x1b[97;1:3u")).toBe(false);
	});

	it("returns false for non-Kitty data", () => {
		expect(isKeyRepeat("\t")).toBe(false);
		expect(isKeyRepeat("")).toBe(false);
	});

	it("returns false for bracketed paste content containing :2u", () => {
		expect(isKeyRepeat("\x1b[200~text:2u")).toBe(false);
	});

	it("returns true for home/end repeat events (:2H / :2F)", () => {
		expect(isKeyRepeat("\x1b[1;1:2H")).toBe(true);
		expect(isKeyRepeat("\x1b[1;1:2F")).toBe(true);
	});
});

// =============================================================================
// Key helper constant
// =============================================================================

describe("Key constant", () => {
	it("provides special key identifiers", () => {
		expect(Key.escape).toBe("escape");
		expect(Key.esc).toBe("esc");
		expect(Key.enter).toBe("enter");
		expect(Key.return).toBe("return");
		expect(Key.tab).toBe("tab");
		expect(Key.space).toBe("space");
		expect(Key.backspace).toBe("backspace");
		expect(Key.delete).toBe("delete");
		expect(Key.insert).toBe("insert");
		expect(Key.home).toBe("home");
		expect(Key.end).toBe("end");
		expect(Key.pageUp).toBe("pageUp");
		expect(Key.pageDown).toBe("pageDown");
	});

	it("provides arrow key identifiers", () => {
		expect(Key.up).toBe("up");
		expect(Key.down).toBe("down");
		expect(Key.left).toBe("left");
		expect(Key.right).toBe("right");
	});

	it("provides function key identifiers", () => {
		expect(Key.f1).toBe("f1");
		expect(Key.f6).toBe("f6");
		expect(Key.f12).toBe("f12");
	});

	it("provides symbol key identifiers", () => {
		expect(Key.comma).toBe(",");
		expect(Key.period).toBe(".");
		expect(Key.slash).toBe("/");
		expect(Key.backtick).toBe("`");
		expect(Key.equals).toBe("=");
		expect(Key.asterisk).toBe("*");
	});

	it("creates single-modifier key identifiers", () => {
		expect(Key.ctrl("c")).toBe("ctrl+c");
		expect(Key.alt("x")).toBe("alt+x");
		expect(Key.shift("tab")).toBe("shift+tab");
		expect(Key.super("k")).toBe("super+k");
	});

	it("creates combined-modifier key identifiers", () => {
		expect(Key.ctrlShift("p")).toBe("ctrl+shift+p");
		expect(Key.shiftCtrl("p")).toBe("shift+ctrl+p");
		expect(Key.ctrlAlt("x")).toBe("ctrl+alt+x");
		expect(Key.altCtrl("x")).toBe("alt+ctrl+x");
	});

	it("creates triple-modifier key identifiers", () => {
		expect(Key.ctrlShiftAlt("d")).toBe("ctrl+shift+alt+d");
		expect(Key.ctrlShiftSuper("d")).toBe("ctrl+shift+super+d");
	});

	it("Key identifiers are valid for matchesKey", () => {
		expect(matchesKey("\x03", Key.ctrl("c"))).toBe(true);
		expect(matchesKey("\x1b", Key.escape)).toBe(true);
	});
});

// =============================================================================
// matchesKey – control sequences
// =============================================================================

describe("matchesKey – control sequences", () => {
	it("matches Escape", () => {
		expect(matchesKey("\x1b", "escape")).toBe(true);
		expect(matchesKey("\x1b", "esc")).toBe(true);
	});

	it("matches Ctrl+C", () => {
		expect(matchesKey("\x03", "ctrl+c")).toBe(true);
	});

	it("matches Ctrl+A", () => {
		expect(matchesKey("\x01", "ctrl+a")).toBe(true);
	});

	it("matches Ctrl+D (EOF)", () => {
		expect(matchesKey("\x04", "ctrl+d")).toBe(true);
	});

	it("matches Ctrl+Z", () => {
		expect(matchesKey("\x1a", "ctrl+z")).toBe(true);
	});

	it("does not match Escape with a modifier", () => {
		expect(matchesKey("\x1b", "ctrl+escape")).toBe(false);
		expect(matchesKey("\x1b", "shift+escape")).toBe(false);
	});

	it("does not match a double ESC as single escape", () => {
		expect(matchesKey("\x1b\x1b", "escape")).toBe(false);
	});
});

// =============================================================================
// matchesKey – arrow keys
// =============================================================================

describe("matchesKey – arrow keys", () => {
	it("matches plain arrows (CSI [ format)", () => {
		expect(matchesKey("\x1b[A", "up")).toBe(true);
		expect(matchesKey("\x1b[B", "down")).toBe(true);
		expect(matchesKey("\x1b[C", "right")).toBe(true);
		expect(matchesKey("\x1b[D", "left")).toBe(true);
	});

	it("matches plain arrows (SS3 format)", () => {
		expect(matchesKey("\x1bOA", "up")).toBe(true);
		expect(matchesKey("\x1bOB", "down")).toBe(true);
		expect(matchesKey("\x1bOC", "right")).toBe(true);
		expect(matchesKey("\x1bOD", "left")).toBe(true);
	});

	it("matches Shift+arrow sequences", () => {
		expect(matchesKey("\x1b[a", "shift+up")).toBe(true);
		expect(matchesKey("\x1b[d", "shift+left")).toBe(true);
	});

	it("matches Ctrl+arrow sequences", () => {
		expect(matchesKey("\x1b[1;5D", "ctrl+left")).toBe(true);
		expect(matchesKey("\x1b[1;5C", "ctrl+right")).toBe(true);
	});

	it("matches Alt+arrow sequences", () => {
		expect(matchesKey("\x1b[1;3D", "alt+left")).toBe(true);
		expect(matchesKey("\x1b[1;3C", "alt+right")).toBe(true);
		expect(matchesKey("\x1bp", "alt+up")).toBe(true);
		expect(matchesKey("\x1bn", "alt+down")).toBe(true);
	});

	it("does not match wrong arrow direction", () => {
		expect(matchesKey("\x1b[A", "down")).toBe(false);
		expect(matchesKey("\x1b[D", "right")).toBe(false);
	});
});

// =============================================================================
// matchesKey – special keys
// =============================================================================

describe("matchesKey – enter / tab / space / backspace", () => {
	it("matches Enter (\\r)", () => {
		expect(matchesKey("\r", "enter")).toBe(true);
		expect(matchesKey("\r", "return")).toBe(true);
	});

	it("matches numpad Enter (SS3 M)", () => {
		expect(matchesKey("\x1bOM", "enter")).toBe(true);
	});

	it("matches Tab", () => {
		expect(matchesKey("\t", "tab")).toBe(true);
	});

	it("matches Shift+Tab", () => {
		expect(matchesKey("\x1b[Z", "shift+tab")).toBe(true);
		expect(matchesKey("\x1b[Z", Key.shift("tab"))).toBe(true);
	});

	it("matches Space", () => {
		expect(matchesKey(" ", "space")).toBe(true);
	});

	it("matches Ctrl+Space (NUL)", () => {
		expect(matchesKey("\x00", "ctrl+space")).toBe(true);
	});

	it("matches Backspace (DEL 0x7f)", () => {
		expect(matchesKey("\x7f", "backspace")).toBe(true);
	});

	it("matches Alt+Backspace", () => {
		expect(matchesKey("\x1b\x7f", "alt+backspace")).toBe(true);
		expect(matchesKey("\x1b\b", "alt+backspace")).toBe(true);
	});

	it("matches Alt+Space (legacy ESC space)", () => {
		expect(matchesKey("\x1b ", "alt+space")).toBe(true);
	});
});

// =============================================================================
// matchesKey – navigation / function keys
// =============================================================================

describe("matchesKey – navigation keys", () => {
	it("matches Home", () => {
		expect(matchesKey("\x1b[H", "home")).toBe(true);
		expect(matchesKey("\x1bOH", "home")).toBe(true);
		expect(matchesKey("\x1b[1~", "home")).toBe(true);
	});

	it("matches End", () => {
		expect(matchesKey("\x1b[F", "end")).toBe(true);
		expect(matchesKey("\x1bOF", "end")).toBe(true);
	});

	it("matches Delete", () => {
		expect(matchesKey("\x1b[3~", "delete")).toBe(true);
	});

	it("matches Page Up / Page Down", () => {
		expect(matchesKey("\x1b[5~", "pageUp")).toBe(true);
		expect(matchesKey("\x1b[6~", "pageDown")).toBe(true);
	});

	it("matches Insert", () => {
		expect(matchesKey("\x1b[2~", "insert")).toBe(true);
	});
});

describe("matchesKey – function keys", () => {
	it("matches F1–F4 in SS3 format", () => {
		expect(matchesKey("\x1bOP", "f1")).toBe(true);
		expect(matchesKey("\x1bOQ", "f2")).toBe(true);
		expect(matchesKey("\x1bOR", "f3")).toBe(true);
		expect(matchesKey("\x1bOS", "f4")).toBe(true);
	});

	it("matches F1–F4 in tilde format", () => {
		expect(matchesKey("\x1b[11~", "f1")).toBe(true);
		expect(matchesKey("\x1b[12~", "f2")).toBe(true);
		expect(matchesKey("\x1b[13~", "f3")).toBe(true);
		expect(matchesKey("\x1b[14~", "f4")).toBe(true);
	});

	it("matches F5–F12", () => {
		expect(matchesKey("\x1b[15~", "f5")).toBe(true);
		expect(matchesKey("\x1b[17~", "f6")).toBe(true);
		expect(matchesKey("\x1b[21~", "f10")).toBe(true);
		expect(matchesKey("\x1b[24~", "f12")).toBe(true);
	});

	it("rejects modifier+function key combos", () => {
		expect(matchesKey("\x1bOP", "shift+f1")).toBe(false);
		expect(matchesKey("\x1b[11~", "ctrl+f1")).toBe(false);
	});
});

// =============================================================================
// matchesKey – printable / modified keys
// =============================================================================

describe("matchesKey – printable and modified keys", () => {
	it("matches a plain letter", () => {
		expect(matchesKey("a", "a")).toBe(true);
		expect(matchesKey("z", "z")).toBe(true);
	});

	it("matches a digit", () => {
		expect(matchesKey("5", "5")).toBe(true);
		expect(matchesKey("0", "0")).toBe(true);
	});

	it("matches a symbol", () => {
		expect(matchesKey("/", "/")).toBe(true);
		expect(matchesKey("-", "-")).toBe(true);
	});

	it("matches Shift+letter via uppercase", () => {
		expect(matchesKey("B", "shift+b")).toBe(true);
		expect(matchesKey("Z", "shift+z")).toBe(true);
	});

	it("does not match plain lowercase for shift+letter", () => {
		expect(matchesKey("b", "shift+b")).toBe(false);
	});

	it("matches Ctrl+letter via control character", () => {
		expect(matchesKey("\x01", "ctrl+a")).toBe(true);
		expect(matchesKey("\x0b", "ctrl+k")).toBe(true);
	});

	it("matches Ctrl+symbol (backslash)", () => {
		// Ctrl+\ = 0x1c
		expect(matchesKey("\x1c", "ctrl+\\")).toBe(true);
	});

	it("matches Kitty CSI-u for a plain key", () => {
		expect(matchesKey("\x1b[97u", "a")).toBe(true);
	});

	it("matches Kitty CSI-u for shift+key", () => {
		expect(matchesKey("\x1b[97;2u", "shift+a")).toBe(true);
	});

	it("matches Kitty CSI-u for ctrl+key", () => {
		expect(matchesKey("\x1b[97;5u", "ctrl+a")).toBe(true);
	});

	it("does not match wrong key in Kitty CSI-u", () => {
		expect(matchesKey("\x1b[98u", "a")).toBe(false);
	});

	it("returns false for empty data", () => {
		expect(matchesKey("", "a")).toBe(false);
		expect(matchesKey("", "escape")).toBe(false);
	});
});

// =============================================================================
// matchesKey – Kitty protocol mode effects
// =============================================================================

describe("matchesKey – Kitty protocol mode", () => {
	beforeEach(() => {
		setKittyProtocolActive(true);
	});

	it("matches \\x1b\\r as Shift+Enter when Kitty is active", () => {
		expect(matchesKey("\x1b\r", "shift+enter")).toBe(true);
	});

	it("matches \\n as Shift+Enter when Kitty is active", () => {
		expect(matchesKey("\n", "shift+enter")).toBe(true);
	});

	it("does not match \\x1b\\r as Alt+Enter when Kitty is active", () => {
		expect(matchesKey("\x1b\r", "alt+enter")).toBe(false);
	});

	it("does not match \\n as plain Enter when Kitty is active", () => {
		expect(matchesKey("\n", "enter")).toBe(false);
	});
});

describe("matchesKey – legacy mode (Kitty inactive)", () => {
	it("matches \\x1b\\r as Alt+Enter when Kitty is inactive", () => {
		expect(matchesKey("\x1b\r", "alt+enter")).toBe(true);
	});

	it("matches \\n as plain Enter when Kitty is inactive", () => {
		expect(matchesKey("\n", "enter")).toBe(true);
	});

	it("does not match \\x1b\\r as Shift+Enter when Kitty is inactive", () => {
		expect(matchesKey("\x1b\r", "shift+enter")).toBe(false);
	});
});

// =============================================================================
// parseKey – basic keys
// =============================================================================

describe("parseKey – basic keys", () => {
	it("parses Escape", () => {
		expect(parseKey("\x1b")).toBe("escape");
	});

	it("parses Tab", () => {
		expect(parseKey("\t")).toBe("tab");
	});

	it("parses Enter (\\r)", () => {
		expect(parseKey("\r")).toBe("enter");
	});

	it("parses Space", () => {
		expect(parseKey(" ")).toBe("space");
	});

	it("parses Backspace (DEL)", () => {
		expect(parseKey("\x7f")).toBe("backspace");
	});

	it("parses NUL as Ctrl+Space", () => {
		expect(parseKey("\x00")).toBe("ctrl+space");
	});

	it("parses plain printable characters", () => {
		expect(parseKey("a")).toBe("a");
		expect(parseKey("Z")).toBe("Z");
		expect(parseKey("5")).toBe("5");
		expect(parseKey("@")).toBe("@");
	});
});

// =============================================================================
// parseKey – navigation / arrows
// =============================================================================

describe("parseKey – arrows and navigation", () => {
	it("parses arrow keys", () => {
		expect(parseKey("\x1b[A")).toBe("up");
		expect(parseKey("\x1b[B")).toBe("down");
		expect(parseKey("\x1b[C")).toBe("right");
		expect(parseKey("\x1b[D")).toBe("left");
	});

	it("parses SS3 arrow keys", () => {
		expect(parseKey("\x1bOA")).toBe("up");
		expect(parseKey("\x1bOB")).toBe("down");
	});

	it("parses Home / End", () => {
		expect(parseKey("\x1b[H")).toBe("home");
		expect(parseKey("\x1bOH")).toBe("home");
		expect(parseKey("\x1b[F")).toBe("end");
		expect(parseKey("\x1bOF")).toBe("end");
	});

	it("parses Delete / PageUp / PageDown", () => {
		expect(parseKey("\x1b[3~")).toBe("delete");
		expect(parseKey("\x1b[5~")).toBe("pageUp");
		expect(parseKey("\x1b[6~")).toBe("pageDown");
	});

	it("parses function keys", () => {
		expect(parseKey("\x1bOP")).toBe("f1");
		expect(parseKey("\x1b[15~")).toBe("f5");
		expect(parseKey("\x1b[24~")).toBe("f12");
	});

	it("parses Shift+Tab", () => {
		expect(parseKey("\x1b[Z")).toBe("shift+tab");
	});
});

// =============================================================================
// parseKey – ctrl combinations
// =============================================================================

describe("parseKey – ctrl combinations", () => {
	it("parses raw Ctrl+letter", () => {
		expect(parseKey("\x01")).toBe("ctrl+a");
		expect(parseKey("\x03")).toBe("ctrl+c");
		expect(parseKey("\x1a")).toBe("ctrl+z");
	});

	it("parses Ctrl+symbol sequences", () => {
		expect(parseKey("\x1c")).toBe("ctrl+\\");
		expect(parseKey("\x1d")).toBe("ctrl+]");
		expect(parseKey("\x1f")).toBe("ctrl+-");
	});
});

// =============================================================================
// parseKey – alt combinations
// =============================================================================

describe("parseKey – alt combinations", () => {
	it("parses Alt+Backspace", () => {
		expect(parseKey("\x1b\x7f")).toBe("alt+backspace");
	});

	it("parses Alt+Space", () => {
		expect(parseKey("\x1b ")).toBe("alt+space");
	});

	it("parses legacy Alt+letter", () => {
		expect(parseKey("\x1ba")).toBe("alt+a");
	});

	it("parses legacy Ctrl+Alt+letter", () => {
		// ESC + Ctrl+A control char
		expect(parseKey("\x1b\x01")).toBe("ctrl+alt+a");
	});

	it("parses Alt+arrow shortcuts", () => {
		expect(parseKey("\x1bb")).toBe("alt+left");
		expect(parseKey("\x1bf")).toBe("alt+right");
	});
});

// =============================================================================
// parseKey – Kitty protocol mode
// =============================================================================

describe("parseKey – Kitty protocol active", () => {
	beforeEach(() => {
		setKittyProtocolActive(true);
	});

	it("parses \\x1b\\r as Shift+Enter", () => {
		expect(parseKey("\x1b\r")).toBe("shift+enter");
	});

	it("parses \\n as Shift+Enter", () => {
		expect(parseKey("\n")).toBe("shift+enter");
	});

	it("does not parse \\n as plain Enter", () => {
		// With Kitty active, \n is shift+enter, not enter
		expect(parseKey("\n")).not.toBe("enter");
	});
});

// =============================================================================
// parseKey – Kitty CSI-u sequences
// =============================================================================

describe("parseKey – Kitty CSI-u sequences", () => {
	it("parses a plain CSI-u letter", () => {
		expect(parseKey("\x1b[97u")).toBe("a");
	});

	it("parses a CSI-u digit", () => {
		expect(parseKey("\x1b[48u")).toBe("0");
	});

	it("parses a CSI-u escape key", () => {
		expect(parseKey("\x1b[27u")).toBe("escape");
	});

	it("parses a CSI-u enter key", () => {
		expect(parseKey("\x1b[13u")).toBe("enter");
	});

	it("parses CSI-u with modifier (ctrl+a)", () => {
		expect(parseKey("\x1b[97;5u")).toBe("ctrl+a");
	});

	it("parses CSI-u arrow keys", () => {
		// Kitty reports arrows as CSI 1;<mod>A/B/C/D
		expect(parseKey("\x1b[1;1A")).toBe("up");
		expect(parseKey("\x1b[1;3D")).toBe("alt+left");
	});
});

// =============================================================================
// parseKey – edge cases
// =============================================================================

describe("parseKey – edge cases", () => {
	it("returns undefined for empty string", () => {
		expect(parseKey("")).toBeUndefined();
	});

	it("returns undefined for unrecognized multi-char input", () => {
		expect(parseKey("abc")).toBeUndefined();
	});

	it("returns undefined for bracketed paste start", () => {
		expect(parseKey("\x1b[200~")).toBeUndefined();
	});

	it("returns undefined for malformed escape sequence", () => {
		expect(parseKey("\x1b[xyz")).toBeUndefined();
	});
});

// =============================================================================
// decodeKittyPrintable
// =============================================================================

describe("decodeKittyPrintable", () => {
	it("decodes a plain lowercase letter", () => {
		expect(decodeKittyPrintable("\x1b[97u")).toBe("a");
	});

	it("decodes a plain uppercase letter", () => {
		expect(decodeKittyPrintable("\x1b[65u")).toBe("A");
	});

	it("decodes a digit", () => {
		expect(decodeKittyPrintable("\x1b[48u")).toBe("0");
		expect(decodeKittyPrintable("\x1b[57u")).toBe("9");
	});

	it("decodes a space (codepoint 32)", () => {
		expect(decodeKittyPrintable("\x1b[32u")).toBe(" ");
	});

	it("decodes with shift, preferring shifted codepoint", () => {
		// codepoint 97 ('a'), shifted 65 ('A'), modifier 2 (shift)
		expect(decodeKittyPrintable("\x1b[97:65;2u")).toBe("A");
	});

	it("returns undefined for Ctrl-modified keys", () => {
		expect(decodeKittyPrintable("\x1b[97;5u")).toBeUndefined();
	});

	it("returns undefined for Alt-modified keys", () => {
		expect(decodeKittyPrintable("\x1b[97;3u")).toBeUndefined();
	});

	it("returns undefined for control codepoints (< 32)", () => {
		expect(decodeKittyPrintable("\x1b[27u")).toBeUndefined();
		expect(decodeKittyPrintable("\x1b[9u")).toBeUndefined();
	});

	it("returns undefined for non-CSI-u data", () => {
		expect(decodeKittyPrintable("a")).toBeUndefined();
		expect(decodeKittyPrintable("\x1b[A")).toBeUndefined();
		expect(decodeKittyPrintable("")).toBeUndefined();
	});

	it("allows Caps Lock (LOCK_MASK) without shift", () => {
		// modifier 65 = caps lock (64) + 1 base = 64 effective; allowed
		expect(decodeKittyPrintable("\x1b[97;65u")).toBe("a");
	});
});

// =============================================================================
// decodePrintableKey
// =============================================================================

describe("decodePrintableKey", () => {
	it("decodes Kitty CSI-u printable", () => {
		expect(decodePrintableKey("\x1b[97u")).toBe("a");
	});

	it("decodes modifyOtherKeys format", () => {
		// CSI 27 ; modifier ; codepoint ~  (modifier 1 = none)
		expect(decodePrintableKey("\x1b[27;1;97~")).toBe("a");
		expect(decodePrintableKey("\x1b[27;1;65~")).toBe("A");
	});

	it("returns undefined for Ctrl-modified modifyOtherKeys", () => {
		expect(decodePrintableKey("\x1b[27;5;97~")).toBeUndefined();
	});

	it("returns undefined for plain characters", () => {
		expect(decodePrintableKey("a")).toBeUndefined();
	});

	it("returns undefined for empty / non-printable", () => {
		expect(decodePrintableKey("")).toBeUndefined();
		expect(decodePrintableKey("\x1b[A")).toBeUndefined();
	});

	it("prefers Kitty CSI-u when both could match", () => {
		// Only Kitty format applies here
		expect(decodePrintableKey("\x1b[48u")).toBe("0");
	});
});

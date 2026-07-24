/**
 * Tests for the keybinding registry and native modifier detection.
 * Sources: ./keybindings.ts, ./native-modifiers.ts
 */
import { describe, it, expect } from "vitest";
import { TUI_KEYBINDINGS, getKeybindings } from "./keybindings.ts";
import { isNativeModifierPressed } from "./native-modifiers.ts";

describe("TUI_KEYBINDINGS", () => {
	it("defines editor navigation keybindings with scalar defaultKeys", () => {
		expect(TUI_KEYBINDINGS["tui.editor.cursorUp"]).toBeDefined();
		expect(TUI_KEYBINDINGS["tui.editor.cursorUp"].defaultKeys).toBe("up");
	});

	it("supports array defaultKeys", () => {
		expect(Array.isArray(TUI_KEYBINDINGS["tui.editor.cursorLeft"].defaultKeys)).toBe(true);
	});

	it("every definition exposes a defaultKeys property", () => {
		for (const def of Object.values(TUI_KEYBINDINGS)) {
			expect(def.defaultKeys).toBeDefined();
		}
	});
});

describe("getKeybindings", () => {
	it("returns a singleton KeybindingsManager", () => {
		const kb1 = getKeybindings();
		const kb2 = getKeybindings();
		expect(kb1).toBe(kb2);
	});

	it("resolves the default keys for a keybinding", () => {
		const kb = getKeybindings();
		expect(kb.getKeys("tui.editor.cursorUp")).toContain("up");
	});

	it("getDefinition returns the stored definition", () => {
		const kb = getKeybindings();
		expect(kb.getDefinition("tui.input.submit").defaultKeys).toBe("enter");
	});
});

describe("isNativeModifierPressed", () => {
	it("always returns a boolean", () => {
		expect(typeof isNativeModifierPressed("control")).toBe("boolean");
	});

	it("returns false on non-darwin platforms (no native helper)", () => {
		if (process.platform !== "darwin") {
			expect(isNativeModifierPressed("shift")).toBe(false);
		}
	});
});

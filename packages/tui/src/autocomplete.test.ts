import { describe, it, expect } from "vitest";
import { CombinedAutocompleteProvider } from "./autocomplete.ts";
import type { SlashCommand, AutocompleteItem } from "./autocomplete.ts";

/** Fresh, non-aborted AbortSignal for each getSuggestions call. */
const signal = (): AbortSignal => new AbortController().signal;

const COMMANDS: SlashCommand[] = [
	{ name: "help", description: "show help" },
	{ name: "history", description: "show history" },
	{ name: "clear", description: "clear screen" },
];

describe("CombinedAutocompleteProvider - shouldTriggerFileCompletion", () => {
	it("does not trigger while typing a slash command (no space yet)", () => {
		const p = new CombinedAutocompleteProvider(COMMANDS, "/tmp", null);
		expect(p.shouldTriggerFileCompletion(["/hel"], 0, 4)).toBe(false);
	});

	it("triggers for normal text", () => {
		const p = new CombinedAutocompleteProvider(COMMANDS, "/tmp", null);
		expect(p.shouldTriggerFileCompletion(["hello world"], 0, 11)).toBe(true);
	});

	it("triggers once a slash command has a trailing space", () => {
		const p = new CombinedAutocompleteProvider(COMMANDS, "/tmp", null);
		expect(p.shouldTriggerFileCompletion(["/help arg"], 0, 10)).toBe(true);
	});

	it("triggers for empty input", () => {
		const p = new CombinedAutocompleteProvider(COMMANDS, "/tmp", null);
		expect(p.shouldTriggerFileCompletion([""], 0, 0)).toBe(true);
	});
});

describe("CombinedAutocompleteProvider - getSuggestions (slash commands)", () => {
	it("generates suggestions from the command list matching the prefix", async () => {
		const p = new CombinedAutocompleteProvider(COMMANDS, "/tmp", null);
		const res = await p.getSuggestions(["/he"], 0, 3, { signal: signal() });
		expect(res).not.toBeNull();
		expect(res!.items.map((i) => i.value)).toContain("help");
		expect(res!.items.map((i) => i.value)).not.toContain("clear");
		expect(res!.prefix).toBe("/he");
	});

	it("returns null when no command matches", async () => {
		const p = new CombinedAutocompleteProvider(COMMANDS, "/tmp", null);
		const res = await p.getSuggestions(["/zzz"], 0, 4, { signal: signal() });
		expect(res).toBeNull();
	});

	it("is case-insensitive when matching command names", async () => {
		const p = new CombinedAutocompleteProvider(COMMANDS, "/tmp", null);
		const res = await p.getSuggestions(["/HE"], 0, 3, { signal: signal() });
		expect(res).not.toBeNull();
		expect(res!.items.map((i) => i.value)).toContain("help");
	});

	it("uses fuzzy matching so non-contiguous letters can match", async () => {
		const p = new CombinedAutocompleteProvider(COMMANDS, "/tmp", null);
		// "hp" is a subsequence of "help"
		const res = await p.getSuggestions(["/hp"], 0, 3, { signal: signal() });
		expect(res).not.toBeNull();
		expect(res!.items.map((i) => i.value)).toContain("help");
	});
});

describe("CombinedAutocompleteProvider - argument completions", () => {
	it("delegates to a command's getArgumentCompletions", async () => {
		const all: AutocompleteItem[] = [
			{ value: "foo", label: "foo" },
			{ value: "bar", label: "bar" },
		];
		const cmd: SlashCommand = {
			name: "set",
			getArgumentCompletions: async (prefix: string) =>
				all.filter((i) => i.value.startsWith(prefix)),
		};
		const p = new CombinedAutocompleteProvider([cmd], "/tmp", null);
		const res = await p.getSuggestions(["/set f"], 0, 6, { signal: signal() });
		expect(res).not.toBeNull();
		expect(res!.items.map((i) => i.value)).toEqual(["foo"]);
		expect(res!.prefix).toBe("f");
	});

	it("returns null when the matched command has no argument completer", async () => {
		const cmd: SlashCommand = { name: "set" };
		const p = new CombinedAutocompleteProvider([cmd], "/tmp", null);
		const res = await p.getSuggestions(["/set f"], 0, 6, { signal: signal() });
		expect(res).toBeNull();
	});

	it("returns null when the argument completer yields nothing", async () => {
		const cmd: SlashCommand = {
			name: "set",
			getArgumentCompletions: async () => [],
		};
		const p = new CombinedAutocompleteProvider([cmd], "/tmp", null);
		const res = await p.getSuggestions(["/set f"], 0, 6, { signal: signal() });
		expect(res).toBeNull();
	});
});

describe("CombinedAutocompleteProvider - applyCompletion", () => {
	it("completes a slash command and positions the cursor after a trailing space", () => {
		const p = new CombinedAutocompleteProvider(COMMANDS, "/tmp", null);
		const item: AutocompleteItem = { value: "help", label: "help" };
		const res = p.applyCompletion(["/he"], 0, 3, item, "/he");
		expect(res.lines[0]).toBe("/help ");
		expect(res.cursorLine).toBe(0);
		expect(res.cursorCol).toBe(6);
	});

	it("preserves text after the cursor when completing a command", () => {
		const p = new CombinedAutocompleteProvider(COMMANDS, "/tmp", null);
		const item: AutocompleteItem = { value: "help", label: "help" };
		const res = p.applyCompletion(["/hex"], 0, 3, item, "/he");
		expect(res.lines[0]).toBe("/help x");
	});

	it("completes a @ file attachment and adds a trailing space", () => {
		const p = new CombinedAutocompleteProvider(COMMANDS, "/tmp", null);
		const item: AutocompleteItem = { value: "@/src/a.ts", label: "a.ts" };
		const res = p.applyCompletion(["@/src/a"], 0, 7, item, "@/src/a");
		expect(res.lines[0]).toBe("@/src/a.ts ");
	});

	it("does not add a trailing space for a directory attachment", () => {
		const p = new CombinedAutocompleteProvider(COMMANDS, "/tmp", null);
		const item: AutocompleteItem = { value: "@/src/", label: "src/" };
		const res = p.applyCompletion(["@/src"], 0, 5, item, "@/src");
		expect(res.lines[0]).toBe("@/src/");
	});
});

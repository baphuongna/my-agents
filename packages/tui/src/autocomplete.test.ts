/**
 * Phase 20 tests: fuzzy autocomplete suggestions.
 */
import { describe, it, expect } from "vitest";
import { computeSuggestions } from "./autocomplete.js";
import { SLASH_COMMANDS } from "./ink-commands.js";

describe("computeSuggestions", () => {
  it("returns the first N commands (limited) for '/' draft", () => {
    const out = computeSuggestions("/", SLASH_COMMANDS);
    expect(out.length).toBeGreaterThan(0);
    // Default limit is 8; /help is registered first.
    expect(out[0]?.label).toBe("/help");
    expect(out[0]?.insert).toBe("/help ");
  });

  it("filters by query after the slash", () => {
    const out = computeSuggestions("/mo", SLASH_COMMANDS);
    expect(out.length).toBeGreaterThan(0);
    const labels = out.map((s) => s.label);
    expect(labels).toContain("/model");
    expect(labels).toContain("/model-selector");
  });

  it("handles slash + trailing args (preserves args)", () => {
    const out = computeSuggestions("/model gpt", SLASH_COMMANDS);
    expect(out[0]?.label).toBe("/model");
    expect(out[0]?.insert).toBe("/model gpt");
  });

  it("returns [] for non-slack non-at drafts", () => {
    expect(computeSuggestions("hello world", SLASH_COMMANDS)).toEqual([]);
  });

  it("returns @-path suggestions for @ drafts", () => {
    const out = computeSuggestions("look at @foo", []);
    expect(out.length).toBe(1);
    expect(out[0]?.label).toBe("@foo");
  });

  it("returns placeholder for empty @", () => {
    const out = computeSuggestions("cd @", []);
    expect(out[0]?.label).toBe("@...");
  });
});

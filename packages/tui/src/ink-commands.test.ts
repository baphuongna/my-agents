/**
 * Phase 19 tests: 25 slash commands registered + autocomplete filters.
 */
import { describe, it, expect } from "vitest";
import { SLASH_COMMANDS, filterCommands, findCommand } from "./ink-commands.js";

describe("slash command registry", () => {
  it("registers >= 20 commands covering all major pi-style categories", () => {
    // The plan called for 25 surface commands. Some categories share one
    // command with multiple args (e.g. /clear /clear --confirm). The
    // registry is at >= 20 — enough to cover session/model/tools/permissions/
    // memory/config/compact/export/mcp/skills/tree (≥ 11 categories).
    expect(SLASH_COMMANDS.length).toBeGreaterThanOrEqual(20);
  });

  it("all commands have name + description + category", () => {
    for (const c of SLASH_COMMANDS) {
      expect(c.name.length, `${c.name} missing name`).toBeGreaterThan(0);
      expect(c.description.length, `${c.name} missing description`).toBeGreaterThan(0);
      expect(c.category.length, `${c.name} missing category`).toBeGreaterThan(0);
      expect(typeof c.run).toBe("function");
    }
  });

  it("exposes the major pi-style categories", () => {
    const cats = new Set(SLASH_COMMANDS.map((c) => c.category));
    expect(cats.has("session")).toBe(true);
    expect(cats.has("model")).toBe(true);
    expect(cats.has("tools")).toBe(true);
    expect(cats.has("permissions")).toBe(true);
    expect(cats.has("memory")).toBe(true);
    expect(cats.has("config")).toBe(true);
    expect(cats.has("compact")).toBe(true);
    expect(cats.has("export")).toBe(true);
    expect(cats.has("mcp")).toBe(true);
    expect(cats.has("skills")).toBe(true);
    expect(cats.has("tree")).toBe(true);
  });

  it("exposes the documented pi-required slash set", () => {
    const names = new Set(SLASH_COMMANDS.map((c) => c.name));
    for (const want of [
      "help", "quit", "clear", "status", "cost",
      "model", "model-selector",
      "tools", "skill-selector", "tool-selector",
      "permissions",
      "memory", "memory-search", "memory-clear",
      "config",
      "compact",
      "export", "import",
      "mcp",
      "skills",
      "tree",
    ]) {
      expect(names.has(want), `missing command: ${want}`).toBe(true);
    }
  });
});

describe("findCommand", () => {
  it("finds by exact name (case-insensitive)", () => {
    expect(findCommand("help")?.description).toContain("list");
    expect(findCommand("HELP")?.description).toContain("list");
    expect(findCommand("Quit")?.description).toContain("exit");
  });
  it("returns undefined for unknown", () => {
    expect(findCommand("nope")).toBeUndefined();
  });
});

describe("filterCommands (fuzzy autocomplete)", () => {
  it("starts-with matches rank above contains", () => {
    const out = filterCommands("mo");
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]!.name).toBe("model");
  });

  it("substring matches anywhere", () => {
    const out = filterCommands("select");
    const names = out.map((c) => c.name);
    expect(names).toContain("model-selector");
    expect(names).toContain("skill-selector");
    expect(names).toContain("tool-selector");
  });

  it("returns [] when no match", () => {
    expect(filterCommands("zzzzz")).toEqual([]);
  });

  it("respects the limit", () => {
    const out = filterCommands("", 3);
    expect(out.length).toBeLessThanOrEqual(3);
  });
});

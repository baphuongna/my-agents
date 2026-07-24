import { describe, it, expect } from "vitest";
import {
  extract_skill_description,
  SKILL_PROMPT_DESC_LIMIT,
  parseSkillMarkdown,
} from "./skill.js";
import { SkillStore } from "./curator.js";

describe("[unit] extract_skill_description", () => {
  it("SKILL_PROMPT_DESC_LIMIT is 60 (57 visible + 3 ellipsis)", () => {
    expect(SKILL_PROMPT_DESC_LIMIT).toBe(60);
  });

  it("at-limit (60 chars) → no truncation", () => {
    const desc = "a".repeat(60);
    const result = extract_skill_description(desc);
    expect(result.truncated).toBe(false);
    expect(result.description).toBe(desc);
    expect(result.description.length).toBe(60);
  });

  it("under-limit (59 chars) → no truncation", () => {
    const desc = "a".repeat(59);
    const result = extract_skill_description(desc);
    expect(result.truncated).toBe(false);
    expect(result.description).toBe(desc);
  });

  it("over-limit (61 chars) → truncated to 57 + ellipsis", () => {
    const desc = "a".repeat(61);
    const result = extract_skill_description(desc);
    expect(result.truncated).toBe(true);
    expect(result.description).toBe("a".repeat(57) + "...");
    expect(result.description.length).toBe(60);
  });

  it("over-limit preserves the first 57 chars of the description", () => {
    const desc = "The quick brown fox jumps over the lazy dog and then some extra!";
    const result = extract_skill_description(desc);
    expect(result.truncated).toBe(true);
    expect(result.description.startsWith(desc.slice(0, 57))).toBe(true);
    expect(result.description.endsWith("...")).toBe(true);
  });

  it("empty description → no truncation", () => {
    const result = extract_skill_description("");
    expect(result.truncated).toBe(false);
    expect(result.description).toBe("");
  });

  it("exactly 1 char over → truncates correctly", () => {
    const desc = "a".repeat(61);
    const result = extract_skill_description(desc);
    expect(result.truncated).toBe(true);
    expect(result.description).toHaveLength(60);
  });
});

describe("[unit] SkillStore.renderIndexBlock — 60-char budget (P3)", () => {
  it("short descriptions render verbatim", () => {
    const store = new SkillStore();
    const skill = parseSkillMarkdown(
      "---\nname: test-skill\ndescription: Short desc\n---\nbody",
      "test.md",
    );
    store.add(skill);
    const block = store.renderIndexBlock();
    expect(block).toContain("Short desc");
    expect(block).not.toContain("(more in body)");
  });

  it("at-limit (60 chars) renders verbatim — no truncation", () => {
    const store = new SkillStore();
    const desc = "a".repeat(60);
    const skill = parseSkillMarkdown(
      `---\nname: test-skill\ndescription: ${desc}\n---\nbody`,
      "test.md",
    );
    store.add(skill);
    const block = store.renderIndexBlock();
    expect(block).toContain(desc);
    expect(block).not.toContain("...");
    expect(block).not.toContain("(more in body)");
  });

  it("over-limit (61 chars) → truncated + (more in body) suffix", () => {
    const store = new SkillStore();
    const desc = "a".repeat(61);
    const skill = parseSkillMarkdown(
      `---\nname: test-skill\ndescription: ${desc}\n---\nbody`,
      "test.md",
    );
    store.add(skill);
    const block = store.renderIndexBlock();
    expect(block).toContain("a".repeat(57) + "...");
    expect(block).toContain("(more in body)");
    // The full 61-char description is NOT in the block.
    expect(block).not.toContain("a".repeat(61));
  });
});

describe("[unit] SkillStore.index — system_prompt_preview flag (P3)", () => {
  it("at-limit → system_prompt_preview undefined", () => {
    const store = new SkillStore();
    const desc = "a".repeat(60);
    const skill = parseSkillMarkdown(
      `---\nname: test-skill\ndescription: ${desc}\n---\nbody`,
      "test.md",
    );
    store.add(skill);
    const entries = store.index();
    expect(entries[0]?.system_prompt_preview).toBeUndefined();
  });

  it("over-limit → system_prompt_preview = true", () => {
    const store = new SkillStore();
    const desc = "a".repeat(61);
    const skill = parseSkillMarkdown(
      `---\nname: test-skill\ndescription: ${desc}\n---\nbody`,
      "test.md",
    );
    store.add(skill);
    const entries = store.index();
    expect(entries[0]?.system_prompt_preview).toBe(true);
    expect(entries[0]?.description).toBe("a".repeat(57) + "...");
  });
});

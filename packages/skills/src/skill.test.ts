import { describe, it, expect } from "vitest";
import { extract_skill_description, SKILL_PROMPT_DESC_LIMIT } from "./skill.js";

describe("[unit] skills — extract_skill_description", () => {
  it("short description → verbatim, not truncated", () => {
    const r = extract_skill_description("A short skill");
    expect(r.description).toBe("A short skill");
    expect(r.truncated).toBe(false);
  });

  it("exactly at limit → verbatim", () => {
    const d = "x".repeat(SKILL_PROMPT_DESC_LIMIT);
    const r = extract_skill_description(d);
    expect(r.truncated).toBe(false);
    expect(r.description).toBe(d);
  });

  it("over limit → truncated to 57 chars + ...", () => {
    const d = "x".repeat(SKILL_PROMPT_DESC_LIMIT + 10);
    const r = extract_skill_description(d);
    expect(r.truncated).toBe(true);
    expect(r.description).toBe("x".repeat(57) + "...");
    expect(r.description.length).toBe(60);
  });

  it("empty description → empty, not truncated", () => {
    const r = extract_skill_description("");
    expect(r.description).toBe("");
    expect(r.truncated).toBe(false);
  });

  it("SKILL_PROMPT_DESC_LIMIT is 60", () => {
    expect(SKILL_PROMPT_DESC_LIMIT).toBe(60);
  });
});

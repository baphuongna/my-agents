import { describe, it, expect } from "vitest";

// Barrel smoke tests — verify public API exports are accessible
describe("[smoke] barrel exports", () => {
  it("core/index re-exports types + helpers", async () => {
    const core = await import("@my-agent/core");
    expect(core.nowWallclock).toBeTypeOf("function");
    expect(core.canonicalJson).toBeTypeOf("function");
    expect(core.createSession).toBeTypeOf("function");
  });

  it("collab/index re-exports CollabRelay", async () => {
    const collab = await import("@my-agent/collab");
    expect(collab.CollabRelay).toBeTypeOf("function");
  });

  it("council/index re-exports CouncilProvider + HindsightReviewer", async () => {
    const council = await import("@my-agent/council");
    expect(council.CouncilProvider).toBeTypeOf("function");
    expect(council.HindsightReviewer).toBeTypeOf("function");
  });

  it("skills/index re-exports parseSkillMarkdown + SkillStore", async () => {
    const skills = await import("@my-agent/skills");
    expect(skills.parseSkillMarkdown).toBeTypeOf("function");
    expect(skills.SkillStore).toBeTypeOf("function");
  });

  it("prompts/index re-exports assemblePrompt + scan + DriftGrader", async () => {
    const prompts = await import("@my-agent/prompts");
    expect(prompts.assemblePrompt).toBeTypeOf("function");
    expect(prompts.scan).toBeTypeOf("function");
    expect(prompts.DriftGrader).toBeTypeOf("function");
  });

  it("eval/index re-exports", async () => {
    const evalMod = await import("@my-agent/eval");
    expect(evalMod).toBeDefined();
  });

  it("workflows/index re-exports", async () => {
    const wf = await import("@my-agent/workflows");
    expect(wf).toBeDefined();
  });
});

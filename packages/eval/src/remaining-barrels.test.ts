import { describe, it, expect } from "vitest";

describe("[smoke] remaining barrels + entry points", () => {
  it("collab/index barrel", async () => { const m = await import("@my-agent/collab"); expect(m.CollabRelay).toBeDefined(); });
  it("council/index barrel", async () => { const m = await import("@my-agent/council"); expect(m.CouncilProvider).toBeDefined(); });
  it("prompts/index barrel", async () => { const m = await import("@my-agent/prompts"); expect(m.assemblePrompt).toBeDefined(); });
  it("skills/index barrel", async () => { const m = await import("@my-agent/skills"); expect(m.parseSkillMarkdown).toBeDefined(); });
  it("core/index barrel", async () => { const m = await import("@my-agent/core"); expect(m.nowWallclock).toBeDefined(); });
  it("dap/index barrel", async () => { const m = await import("@my-agent/dap"); expect(m).toBeDefined(); });
  it("cron/index barrel", async () => { const m = await import("@my-agent/cron"); expect(m.CronScheduler).toBeDefined(); });
});

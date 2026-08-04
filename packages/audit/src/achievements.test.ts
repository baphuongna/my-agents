import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("[unit] audit achievements", () => {
  let origHome: string | undefined;
  let tmpHome: string;

  beforeEach(() => {
    origHome = process.env.HOME;
    tmpHome = mkdtempSync(join(tmpdir(), "ach-"));
    process.env.HOME = tmpHome;
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-15T10:00:00Z"));
  });
  afterEach(() => {
    process.env.HOME = origHome;
    rmSync(tmpHome, { recursive: true, force: true });
    vi.useRealTimers();
  });

  it("ACHIEVEMENTS has 10 defined", async () => {
    const { ACHIEVEMENTS } = await import("./achievements.js");
    expect(ACHIEVEMENTS.length).toBe(10);
  });

  it("recordStat promptsSent=1 → first-prompt unlocked", async () => {
    const { AchievementTracker } = await import("./achievements.js");
    const t = new AchievementTracker();
    const unlocked = t.recordStat("promptsSent");
    expect(unlocked).not.toBeNull();
    expect(unlocked!.id).toBe("first-prompt");
  });

  it("recordStat subagentsSpawned=1 → first-subagent", async () => {
    const { AchievementTracker } = await import("./achievements.js");
    const t = new AchievementTracker();
    const unlocked = t.recordStat("subagentsSpawned");
    expect(unlocked!.id).toBe("first-subagent");
  });

  it("recordStat fastTurns=1 → speed-demon", async () => {
    const { AchievementTracker } = await import("./achievements.js");
    const t = new AchievementTracker();
    const unlocked = t.recordStat("fastTurns");
    expect(unlocked!.id).toBe("speed-demon");
  });

  it("cron-master needs 5 cron jobs", async () => {
    const { AchievementTracker } = await import("./achievements.js");
    const t = new AchievementTracker();
    for (let i = 0; i < 4; i++) expect(t.recordStat("cronJobsCreated")).toBeNull();
    const unlocked = t.recordStat("cronJobsCreated"); // 5th
    expect(unlocked!.id).toBe("cron-master");
  });

  it("listUnlocked returns unlocked achievements sorted by time", async () => {
    const { AchievementTracker } = await import("./achievements.js");
    const t = new AchievementTracker();
    t.recordStat("promptsSent");
    const list = t.listUnlocked();
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe("first-prompt");
  });

  it("listLocked returns not-yet-unlocked", async () => {
    const { AchievementTracker } = await import("./achievements.js");
    const t = new AchievementTracker();
    t.recordStat("promptsSent");
    const locked = t.listLocked();
    expect(locked.length).toBe(9); // 10 total - 1 unlocked
  });

  it("duplicate unlock not re-awarded", async () => {
    const { AchievementTracker } = await import("./achievements.js");
    const t = new AchievementTracker();
    t.recordStat("promptsSent");
    expect(t.recordStat("promptsSent")).toBeNull(); // already unlocked
  });
});

/**
 * @my-agent/audit — Achievements system.
 * J2: gamification — unlocks based on audit events.
 * Source: §13 Observability, PLAN-FEATURES J2.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { nowWallclock } from "@my-agent/core";

const ACHIEVEMENTS_PATH = join(homedir(), ".mya", "achievements.json");

export interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string;
}

export interface UnlockedAchievement extends Achievement {
  unlockedAt: number;
}

/** All defined achievements. */
export const ACHIEVEMENTS: Achievement[] = [
  { id: "first-prompt", name: "Hello World", description: "Sent your first prompt", icon: "👋" },
  { id: "ten-tools", name: "Tool Collector", description: "Used 10 different tools", icon: "🔧" },
  { id: "first-subagent", name: "Delegator", description: "Spawned your first subagent", icon: "🤝" },
  { id: "cron-master", name: "Time Lord", description: "Created 5 cron jobs", icon: "⏰" },
  { id: "memory-keeper", name: "Elephant", description: "Stored 100 memory facts", icon: "🐘" },
  { id: "night-owl", name: "Night Owl", description: "Used mya after midnight", icon: "🦉" },
  { id: "polyglot", name: "Polyglot", description: "Used code execution in 3 languages", icon: "🌐" },
  { id: "speed-demon", name: "Speed Demon", description: "Completed a turn in under 1s", icon: "⚡" },
  { id: "deep-thinker", name: "Deep Thinker", description: "Used thinking mode for 10 turns", icon: "🧠" },
  { id: "explorer", name: "Explorer", description: "Visited all dashboard pages", icon: "🗺️" },
];

export class AchievementTracker {
  private unlocked: Map<string, number> = new Map();
  private stats: Record<string, number> = {};

  constructor() { this.load(); }

  /** Record a stat increment (e.g., toolsUsed++, promptsSent++). */
  recordStat(key: string, increment = 1): UnlockedAchievement | null {
    this.stats[key] = (this.stats[key] ?? 0) + increment;
    return this.checkUnlocks();
  }

  /** Check if any new achievements should unlock. */
  private checkUnlocks(): UnlockedAchievement | null {
    const checks: Record<string, boolean> = {
      "first-prompt": (this.stats.promptsSent ?? 0) >= 1,
      "ten-tools": Object.keys(this.stats).filter((k) => k.startsWith("tool:")).length >= 10,
      "first-subagent": (this.stats.subagentsSpawned ?? 0) >= 1,
      "cron-master": (this.stats.cronJobsCreated ?? 0) >= 5,
      "memory-keeper": (this.stats.memoryFacts ?? 0) >= 100,
      "night-owl": new Date(nowWallclock()).getHours() >= 0 && new Date(nowWallclock()).getHours() < 6,
      "polyglot": new Set(Object.keys(this.stats).filter((k) => k.startsWith("code:"))).size >= 3,
      "speed-demon": (this.stats.fastTurns ?? 0) >= 1,
      "deep-thinker": (this.stats.thinkingTurns ?? 0) >= 10,
      "explorer": (this.stats.pagesVisited ?? 0) >= 18,
    };
    for (const ach of ACHIEVEMENTS) {
      if (checks[ach.id] && !this.unlocked.has(ach.id)) {
        const unlocked: UnlockedAchievement = { ...ach, unlockedAt: nowWallclock() };
        this.unlocked.set(ach.id, unlocked.unlockedAt);
        this.save();
        return unlocked;
      }
    }
    return null;
  }

  /** Get all unlocked achievements. */
  listUnlocked(): UnlockedAchievement[] {
    return ACHIEVEMENTS
      .filter((a) => this.unlocked.has(a.id))
      .map((a) => ({ ...a, unlockedAt: this.unlocked.get(a.id)! }))
      .sort((a, b) => a.unlockedAt - b.unlockedAt);
  }

  /** Get locked achievements (not yet unlocked). */
  listLocked(): Achievement[] {
    return ACHIEVEMENTS.filter((a) => !this.unlocked.has(a.id));
  }

  private load(): void {
    if (!existsSync(ACHIEVEMENTS_PATH)) return;
    try {
      const data = JSON.parse(readFileSync(ACHIEVEMENTS_PATH, "utf8"));
      this.unlocked = new Map(Object.entries(data.unlocked ?? {}));
      this.stats = data.stats ?? {};
    } catch { /* corrupt — start fresh */ }
  }

  private save(): void {
    try {
      mkdirSync(join(homedir(), ".mya"), { recursive: true });
      writeFileSync(ACHIEVEMENTS_PATH, JSON.stringify({
        unlocked: Object.fromEntries(this.unlocked),
        stats: this.stats,
      }, null, 2), { mode: 0o600 });
    } catch { /* best-effort */ }
  }
}

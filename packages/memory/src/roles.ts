/**
 * MemoryRole lifecycle (§8 R27-4). A role RECEIVES the canonical store handle and
 * calls role-specific ops THROUGH it — it is NOT a backend. Roles run on the
 * auxiliary provider chain (never the main prompt cache — invariant #8).
 *
 *   archivist — conversation→tree-leaf bridge: strips tool-call noise from chat
 *     turns, appends the cleaned markdown as a single leaf (syncTurn).
 *   goals     — user goal-list manager (CRUD); systemPromptBlock renders goals.
 *
 * Source: §8 Memory; openhuman roles; R27-4 backend/role split.
 */
import type { MemoryBackend } from "./backends.js";
import { nowWallclock, type TurnContext, type MemoryEntry, type MemoryHit, type MemoryQuery } from "@my-agent/core";

/** §8 lifecycle role interface. */
export interface MemoryRole {
  readonly id: string;
  /** Prefetch relevant entries for the upcoming turn (auxiliary provider). */
  prefetch(store: MemoryBackend, query: MemoryQuery): Promise<void>;
  /** Sync the just-finished turn into the store (e.g. archivist → tree leaf). */
  syncTurn(store: MemoryBackend, ctx: TurnContext): Promise<void>;
  /** A markdown block for the volatile prompt tier (empty if none). Sync OR async
   * (the goals role reads its list asynchronously). */
  systemPromptBlock(store: MemoryBackend): string | Promise<string>;
}

/** Strip tool-call noise (role:"tool", JSON args, large outputs) from a turn's
 * history, returning readable markdown. This is the archivist's core transform. */
export function cleanTurnToMarkdown(historyEntries: unknown[]): string {
  const lines: string[] = [];
  for (const entry of historyEntries) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const role = e.role as string | undefined;
    if (role === "tool") continue; // strip tool-result noise
    if (role === "system") continue;
    const content = e.content;
    if (typeof content === "string" && content.trim()) {
      lines.push(role === "user" ? `**user**: ${content.trim()}` : content.trim());
    }
  }
  return lines.join("\n\n");
}

/** Archivist: conversation→tree-leaf bridge (§8). syncTurn appends the cleaned
 * turn as a single markdown leaf to the tree backend. */
export class ArchivistRole implements MemoryRole {
  readonly id = "archivist";
  async prefetch(): Promise<void> {
    // The archivist writes; it does not prefetch (the tree backend is read via query()).
  }
  async syncTurn(store: MemoryBackend, ctx: TurnContext): Promise<void> {
    if (!store.appendTreeLeaf) return;
    // The turn's history lives on ctx.history; we read the last turn's entries.
    // ctx.history is opaque (History interface has only append); the manager
    // passes the recent entries via ctx.session. For Tier-1, we accept a
    // `recentTurn` array on the session if present.
    const recent = (ctx.session as { recentTurn?: unknown[] } | undefined)?.recentTurn;
    if (!recent || recent.length === 0) return;
    const md = cleanTurnToMarkdown(recent);
    if (md.trim()) {
      await store.appendTreeLeaf(`turns/${nowWallclock()}.md`, md);
    }
  }
  systemPromptBlock(): string {
    return ""; // the archivist doesn't inject into the prompt
  }
}

/** Goals: user goal-list manager (§8). Maintains a goals list; systemPromptBlock
 * renders the active goals so the agent tracks them across turns. */
export class GoalsRole implements MemoryRole {
  readonly id = "goals";
  async prefetch(): Promise<void> { /* goals are read in systemPromptBlock */ }
  async syncTurn(): Promise<void> { /* goals CRUD is via the `goal` tool, not syncTurn */ }

  /** Add/update/clear goals. A goal = { text, status }. */
  async setGoals(store: MemoryBackend, goals: { text: string; status: "active" | "done" }[]): Promise<void> {
    const entry: MemoryEntry = {
      role: "goals",
      content: JSON.stringify(goals),
      metadata: { kind: "goals" },
    };
    await store.write(entry);
  }
  async getGoals(store: MemoryBackend): Promise<{ text: string; status: "active" | "done" }[]> {
    const hits: MemoryHit[] = await store.read({ text: "", role: "goals", topK: 1 });
    if (hits.length === 0) return [];
    try {
      const parsed = JSON.parse(hits[0]!.content) as { text: string; status: "active" | "done" }[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  async systemPromptBlock(store: MemoryBackend): Promise<string> {
    const goals = await this.getGoals(store);
    if (goals.length === 0) return "";
    const active = goals.filter((g) => g.status === "active");
    if (active.length === 0) return "";
    const list = active.map((g, i) => `${i + 1}. ${g.text}`).join("\n");
    return `## Goals\n${list}`;
  }
}


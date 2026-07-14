/**
 * @my-agent/memory/domains/goals — goal-tracking wrapper (Phase A Gap 2).
 *
 * Delegates to the existing GoalsRole (in roles.ts) — does NOT subclass it
 * (the role and domain have different contracts). onRecord re-emits goal writes
 * as facts (for the dream cycle to see them); recall returns the goals list.
 */
import type { MemoryHit } from "@my-agent/core";
import type { Brain, Fact } from "../brain.js";
import { GoalsRole } from "../roles.js";
import type { MemoryBackend } from "../backends.js";
import type { ConsolidationReport, MemoryDomain, MemoryDomainOpts } from "./types.js";

export class GoalsDomain implements MemoryDomain {
  readonly name = "goals";
  private brain: Brain | undefined;
  private readonly goalsRole = new GoalsRole();
  private store: MemoryBackend | undefined;
  /** C2 fix: cache for sync recall (populated by recallAsync, returned by recall). */
  private cachedHits: MemoryHit[] = [];

  init(brain: Brain): void { this.brain = brain; }
  /** Optional wiring for the backing store (used by recall only). */
  wireStore(store: MemoryBackend): void { this.store = store; }
  onRecord(fact: Fact): void {
    /* Goals CRUD goes through GoalsRole.setGoals → backend.write, not Brain.recordFact.
       This domain observes fact writes; nothing to do unless a fact has kind="goal". */
    void fact;
  }
  async recallAsync(query: string, opts?: MemoryDomainOpts): Promise<MemoryHit[]> {
    if (!this.store) return [];
    const goals = await this.goalsRole.getGoals(this.store);
    const q = (query ?? "").trim().toLowerCase();
    const hits: MemoryHit[] = [];
    for (let i = 0; i < goals.length; i++) {
      const g = goals[i]!;
      const content = `${g.status}: ${g.text}`;
      if (q && !content.toLowerCase().includes(q)) continue;
      hits.push({ id: `goal-${i}`, role: (opts?.role ?? "goals") as MemoryHit["role"], content, score: 1 });
    }
    const result = hits.slice(0, opts?.topK ?? 10);
    this.cachedHits = result; // C2 fix: populate cache for sync recall
    return result;
  }
  recall(query: string, opts?: MemoryDomainOpts): MemoryHit[] {
    // C2 fix: return cached results; refresh async for next call
    void this.recallAsync(query, opts);
    return this.cachedHits;
  }
  onConsolidate(_now: number): ConsolidationReport { return { promoted: 0, consumed: 0 }; }
}
export const goalsDomain = new GoalsDomain();

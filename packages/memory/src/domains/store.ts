/**
 * @my-agent/memory/domains/store — backend persistence wrapper (Phase A Gap 2).
 *
 * Thin wrapper around the MemoryManager's backends. The store domain observes
 * fact writes and proxies recall to the manager's query pipeline.
 */
import type { MemoryHit, MemoryQuery } from "@my-agent/core";
import type { Brain, Fact } from "../brain.js";
import type { MemoryBackend } from "../backends.js";
import type { MemoryManagerImpl } from "../manager.js";
import type { ConsolidationReport, MemoryDomain, MemoryDomainOpts } from "./types.js";

export class StoreDomain implements MemoryDomain {
  readonly name = "store";
  private brain: Brain | undefined;
  private manager: MemoryManagerImpl | undefined;
  /** C2 fix: cache for sync recall. */
  private cachedHits: MemoryHit[] = [];
  init(brain: Brain): void { this.brain = brain; }
  /** Optional wiring for the MemoryManager (used by recall only). */
  wireManager(mgr: MemoryManagerImpl): void { this.manager = mgr; }
  onRecord(_fact: Fact): void { /* store is fanned out by MemoryManager.write */ }
  async recallAsync(query: string, opts?: MemoryDomainOpts): Promise<MemoryHit[]> {
    if (!this.manager) return [];
    const q: MemoryQuery = { text: query, role: opts?.role, topK: opts?.topK ?? 10 };
    const result = await this.manager.query(q);
    this.cachedHits = result; // C2 fix
    return result;
  }
  recall(query: string, opts?: MemoryDomainOpts): MemoryHit[] {
    // C2 fix: return cached results; refresh async for next call
    void this.recallAsync(query, opts);
    return this.cachedHits;
  }
  onConsolidate(_now: number): ConsolidationReport { return { promoted: 0, consumed: 0 }; }

  /** Test/inspection helper for direct backend reads. */
  async readBackend(backend: MemoryBackend, q: MemoryQuery): Promise<MemoryHit[]> {
    return backend.read(q);
  }
}
export const storeDomain = new StoreDomain();

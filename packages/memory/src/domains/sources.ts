/**
 * @my-agent/memory/domains/sources — context-source wrapper (Phase A Gap 2).
 *
 * Wraps the existing `ContextSource` (ragfs) + `KnowledgeSource` surface. The
 * sources domain dispatches recall to a registered ContextSource for the role.
 */
import type { MemoryHit } from "@my-agent/core";
import type { Brain, Fact } from "../brain.js";
import { KnowledgeSource, type ContextSource } from "../ragfs.js";
import type { ConsolidationReport, MemoryDomain, MemoryDomainOpts } from "./types.js";

export class SourcesDomain implements MemoryDomain {
  readonly name = "sources";
  private brain: Brain | undefined;
  private source: ContextSource | KnowledgeSource | undefined;
  /** C2 fix: cache for sync recall. */
  private cachedHits: MemoryHit[] = [];
  init(brain: Brain): void { this.brain = brain; }
  /** Optional wiring for the backing context source (used by recall only). */
  wireSource(source: ContextSource | KnowledgeSource): void { this.source = source; }
  onRecord(_fact: Fact): void { /* sources are pull-driven */ }
  async recallAsync(query: string, opts?: MemoryDomainOpts): Promise<MemoryHit[]> {
    if (!this.source) return [];
    const list = await this.source.list({ text: query, role: opts?.role, topK: opts?.topK ?? 10 });
    this.cachedHits = list; // C2 fix
    return list;
  }
  recall(query: string, opts?: MemoryDomainOpts): MemoryHit[] {
    // C2 fix: return cached results; refresh async for next call
    void this.recallAsync(query, opts);
    return this.cachedHits;
  }
  onConsolidate(_now: number): ConsolidationReport { return { promoted: 0, consumed: 0 }; }
}
export const sourcesDomain = new SourcesDomain();

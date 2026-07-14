/**
 * @my-agent/memory/domains/archivist — TTL + purge (Phase A Gap 2).
 *
 * Wraps Brain's `purge` (24h TTL) + L0 `assignTier` from MemoryTree. The
 * archivist domain owns the lifecycle of expirable L0 facts.
 */
import { nowWallclock, type MemoryHit } from "@my-agent/core";
import type { Brain, Fact } from "../brain.js";
import type { ConsolidationReport, MemoryDomain, MemoryDomainOpts } from "./types.js";

export class ArchivistDomain implements MemoryDomain {
  readonly name = "archivist";
  private brain: Brain | undefined;

  init(brain: Brain): void { this.brain = brain; }
  onRecord(_fact: Fact): void { /* Brain.recordFact already set TTL via MemoryTree.assignTier */ }
  recall(query: string, opts?: MemoryDomainOpts): MemoryHit[] {
    if (!this.brain) return [];
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const hits: MemoryHit[] = [];
    for (const f of this.brain.unconsolidatedFacts()) {
      if (f.content.toLowerCase().includes(q)) hits.push({ id: f.id, role: (opts?.role ?? "archivist") as MemoryHit["role"], content: f.content, score: 1 });
    }
    return hits.slice(0, opts?.topK ?? 10);
  }
  onConsolidate(now: number = nowWallclock()): ConsolidationReport {
    if (!this.brain) return { promoted: 0, consumed: 0 };
    const consumed = this.brain.purge(now);
    return { promoted: 0, consumed };
  }
}
export const archivistDomain = new ArchivistDomain();

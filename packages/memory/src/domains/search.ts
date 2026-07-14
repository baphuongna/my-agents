/**
 * @my-agent/memory/domains/search — BM25 + RRF wrapper (Phase A Gap 2).
 *
 * Wraps the 4-arm `rrfRetrieve` over Brain takes + pages + facts. Returns fused
 * MemoryHits.
 */
import type { MemoryHit, MemoryQuery } from "@my-agent/core";
import type { Brain, Fact } from "../brain.js";
import { rrfRetrieve } from "../rrf.js";
import type { ConsolidationReport, MemoryDomain, MemoryDomainOpts } from "./types.js";

export class SearchDomain implements MemoryDomain {
  readonly name = "search";
  private brain: Brain | undefined;
  init(brain: Brain): void { this.brain = brain; }
  onRecord(_fact: Fact): void { /* search is read-only */ }
  recall(query: string, opts?: MemoryDomainOpts): MemoryHit[] {
    if (!this.brain) return [];
    const q = (query ?? "").trim();
    if (!q) return [];
    const edges = this.brain.backlinks();
    const docs: { id: string; content: string; role: MemoryQuery["role"] }[] = [];
    for (const f of this.brain.unconsolidatedFacts()) docs.push({ id: f.id, role: "working", content: f.content });
    for (const t of this.brain.takes) docs.push({ id: t.id, role: "tree", content: t.text });
    for (const p of this.brain.allPages) docs.push({ id: p.id, role: "tree", content: p.compiledTruth });
    const q2: MemoryQuery = { text: q, topK: opts?.topK ?? 10, role: opts?.role ?? "working" };
    return rrfRetrieve(docs, q2, edges);
  }
  onConsolidate(_now: number): ConsolidationReport { return { promoted: 0, consumed: 0 }; }
}
export const searchDomain = new SearchDomain();

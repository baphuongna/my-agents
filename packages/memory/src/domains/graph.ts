/**
 * @my-agent/memory/domains/graph — backlinks + entity-graph wrapper (Phase A Gap 2).
 *
 * Wraps Brain's `backlinks` (zero-LLM edge extractor) + `TypedGraph` (the typed
 * KG). onRecord seeds new facts into the typed graph; recall surfaces entity
 * neighbors as MemoryHits.
 */
import type { MemoryHit } from "@my-agent/core";
import type { Brain, Fact } from "../brain.js";
import { TypedGraph } from "../graph.js";
import type { ConsolidationReport, MemoryDomain, MemoryDomainOpts } from "./types.js";

export class GraphDomain implements MemoryDomain {
  readonly name = "graph";
  private brain: Brain | undefined;
  private readonly graph = new TypedGraph();
  init(brain: Brain): void { this.brain = brain; }
  onRecord(_fact: Fact): void { /* edges are re-extracted lazily by backlinks() */ }
  recall(query: string, opts?: MemoryDomainOpts): MemoryHit[] {
    if (!this.brain) return [];
    // Lazily seed the graph from Brain's backlinks (idempotent on every recall).
    this.graph.ingestBacklinks(this.brain.backlinks());
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const seeds = q.split(/\s+/).filter(Boolean);
    // Case-insensitive seed lookup: build a lc → id map once per recall.
    const lcMap = new Map<string, string>();
    for (const e of this.graph.allEntities()) lcMap.set(e.id.toLowerCase(), e.id);
    const hits: MemoryHit[] = [];
    for (const lc of seeds) {
      const seed = lcMap.get(lc);
      if (!seed) continue;
      const neighbors = this.graph.query(seed, 2);
      for (const n of neighbors) {
        if (n.dist === 0) continue;
        hits.push({ id: `${this.name}:${lc}:${n.id}`, role: (opts?.role ?? "tree") as MemoryHit["role"], content: `${lc} → ${n.id}`, score: 1 / (1 + n.dist) });
      }
    }
    return hits.slice(0, opts?.topK ?? 10);
  }
  onConsolidate(_now: number): ConsolidationReport { return { promoted: 0, consumed: 0 }; }

  /** Test/inspection helper. */
  innerGraph(): TypedGraph { return this.graph; }
}
export const graphDomain = new GraphDomain();

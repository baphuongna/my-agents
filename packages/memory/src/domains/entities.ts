/**
 * @my-agent/memory/domains/entities — entity-extraction wrapper (Phase A Gap 2).
 *
 * Wraps Brain's `extractFacts` (zero-LLM structured extraction: dates/URLs/
 * emails/commits/versions). onRecord triggers extraction lazily on recall.
 */
import type { MemoryHit } from "@my-agent/core";
import type { Brain, Fact } from "../brain.js";
import type { ConsolidationReport, MemoryDomain, MemoryDomainOpts } from "./types.js";

export class EntitiesDomain implements MemoryDomain {
  readonly name = "entities";
  private brain: Brain | undefined;
  init(brain: Brain): void { this.brain = brain; }
  onRecord(_fact: Fact): void { /* extraction is run on demand */ }
  recall(query: string, opts?: MemoryDomainOpts): MemoryHit[] {
    if (!this.brain) return [];
    const atoms = this.brain.extractFacts();
    const q = query.trim().toLowerCase();
    const hits: MemoryHit[] = [];
    for (const a of atoms) {
      const content = `${a.kind}:${a.value}`;
      if (q && !content.toLowerCase().includes(q)) continue;
      hits.push({ id: `atom:${a.factId}:${a.kind}:${a.value}`, role: (opts?.role ?? "working") as MemoryHit["role"], content, score: 1 });
    }
    return hits.slice(0, opts?.topK ?? 10);
  }
  onConsolidate(_now: number): ConsolidationReport { return { promoted: 0, consumed: 0 }; }
}
export const entitiesDomain = new EntitiesDomain();

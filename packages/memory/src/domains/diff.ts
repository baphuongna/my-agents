/**
 * @my-agent/memory/domains/diff — conflict detection (Phase A Gap 2).
 *
 * Wraps Brain's `schemaSuggest` (case-insensitive entity collisions) and the
 * `lint` duplicate detector. The diff domain surfaces entity merge proposals.
 */
import type { MemoryHit } from "@my-agent/core";
import type { Brain, Fact } from "../brain.js";
import type { ConsolidationReport, MemoryDomain, MemoryDomainOpts } from "./types.js";

export class DiffDomain implements MemoryDomain {
  readonly name = "diff";
  private brain: Brain | undefined;
  init(brain: Brain): void { this.brain = brain; }
  onRecord(_fact: Fact): void { /* diff is batch-driven (schemaSuggest + lint) */ }
  recall(query: string, opts?: MemoryDomainOpts): MemoryHit[] {
    if (!this.brain) return [];
    const q = query.trim().toLowerCase();
    const reports = this.brain.schemaSuggest();
    const duplicates = this.brain.lint().duplicates;
    const hits: MemoryHit[] = [];
    for (const r of reports) {
      const content = `entities=${r.entities.join(",")} reason=${r.reason}`;
      if (q && !content.toLowerCase().includes(q)) continue;
      hits.push({ id: `schema:${r.entities.join("|")}`, role: (opts?.role ?? "diff") as MemoryHit["role"], content, score: 1 });
    }
    for (const d of duplicates) {
      const content = `duplicate ${d.ids.length}x: ${d.content}`;
      if (q && !content.toLowerCase().includes(q)) continue;
      hits.push({ id: `dup:${d.ids.join("|")}`, role: (opts?.role ?? "diff") as MemoryHit["role"], content, score: 1 });
    }
    return hits.slice(0, opts?.topK ?? 10);
  }
  onConsolidate(_now: number): ConsolidationReport { return { promoted: 0, consumed: 0 }; }
}
export const diffDomain = new DiffDomain();

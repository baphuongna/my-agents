/**
 * @my-agent/memory/domains/tree — L0/L1/L2 coordinator wrapper (Phase A Gaps 2+3).
 *
 * Thin wrapper around MemoryTree: onRecord delegates to tree.assignTier;
 * onConsolidate delegates to tree.promote; recall aggregates facts/takes/pages
 * by tier label.
 */
import type { MemoryHit } from "@my-agent/core";
import type { Brain, Fact } from "../brain.js";
import { MemoryTree } from "../tree.js";
import type { ConsolidationReport, MemoryDomain, MemoryDomainOpts } from "./types.js";

export class TreeDomain implements MemoryDomain {
  readonly name = "tree";
  private brain: Brain | undefined;
  private tree: MemoryTree | undefined;

  init(brain: Brain): void {
    this.brain = brain;
    this.tree = new MemoryTree(brain);
  }
  onRecord(fact: Fact): void {
    // Label the fact with L0 tier (no re-recording — fact already persisted by Brain).
    // This ensures getTier(fact.id) returns "L0" for manager-recorded facts.
    this.tree?.labelFact(fact.id, "L0");
  }
  recall(query: string, opts?: MemoryDomainOpts): MemoryHit[] {
    if (!this.brain) return [];
    const tier = opts?.tier;
    const q = query.trim().toLowerCase();
    const hits: MemoryHit[] = [];
    for (const f of this.brain.unconsolidatedFacts()) {
      if (tier && tier !== "L0") continue;
      if (q && !f.content.toLowerCase().includes(q)) continue;
      hits.push({ id: f.id, role: (opts?.role ?? "tree") as MemoryHit["role"], content: f.content, score: 1 });
    }
    if (!tier || tier === "L1") {
      for (const t of this.brain.takes) {
        if (q && !t.text.toLowerCase().includes(q)) continue;
        hits.push({ id: t.id, role: (opts?.role ?? "tree") as MemoryHit["role"], content: t.text, score: 1 });
      }
    }
    if (!tier || tier === "L2") {
      for (const p of this.brain.allPages) {
        if (q && !p.compiledTruth.toLowerCase().includes(q)) continue;
        hits.push({ id: p.id, role: (opts?.role ?? "tree") as MemoryHit["role"], content: p.compiledTruth, score: 1 });
      }
    }
    return hits.slice(0, opts?.topK ?? 10);
  }
  onConsolidate(_now: number): ConsolidationReport {
    if (!this.tree) return { promoted: 0, consumed: 0 };
    const r = this.tree.promote();
    return { promoted: r.takesPromoted, consumed: r.factsConsumed };
  }

  /** Test/inspection helper — exposes the inner MemoryTree. */
  innerTree(): MemoryTree | undefined { return this.tree; }
}
export const treeDomain = new TreeDomain();

/**
 * @my-agent/memory/domains/conversations — conversation-history wrapper (Phase A Gap 2).
 *
 * Wraps Brain's `conversationFactsBackfill` (zero-LLM entity backfill). The
 * conversations domain observes fact writes that came from the backfill source.
 */
import type { MemoryHit } from "@my-agent/core";
import type { Brain, Fact } from "../brain.js";
import type { ConsolidationReport, MemoryDomain, MemoryDomainOpts } from "./types.js";

export class ConversationsDomain implements MemoryDomain {
  readonly name = "conversations";
  private brain: Brain | undefined;
  private backfilledConversations = 0;
  init(brain: Brain): void { this.brain = brain; }
  onRecord(fact: Fact): void {
    if (fact.source === "backfill") this.backfilledConversations++;
  }
  recall(query: string, opts?: MemoryDomainOpts): MemoryHit[] {
    if (!this.brain) return [];
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const hits: MemoryHit[] = [];
    for (const f of this.brain.unconsolidatedFacts()) {
      if (f.source !== "backfill") continue;
      if (!f.content.toLowerCase().includes(q)) continue;
      hits.push({ id: f.id, role: (opts?.role ?? "working") as MemoryHit["role"], content: f.content, score: 1 });
    }
    return hits.slice(0, opts?.topK ?? 10);
  }
  onConsolidate(_now: number): ConsolidationReport { return { promoted: 0, consumed: this.backfilledConversations }; }
}
export const conversationsDomain = new ConversationsDomain();

/**
 * @my-agent/memory/domains/tools — tool-result cache stub (Phase A Gap 2).
 *
 * Stub: an in-memory `Map<toolCallId, result>` populated by `onRecord` when a
 * fact has `source: "tool"`. Real TTL-based eviction is a follow-up.
 *
 * TODO(tools): add TTL eviction + bounded cache size + spill-to-disk strategy.
 */
import type { MemoryHit } from "@my-agent/core";
import type { Brain, Fact } from "../brain.js";
import type { ConsolidationReport, MemoryDomain, MemoryDomainOpts } from "./types.js";

interface CachedToolResult {
  toolCallId: string;
  recordedAt: number;
  payload: string;
}

export class ToolsDomain implements MemoryDomain {
  readonly name = "tools";
  private brain: Brain | undefined;
  private readonly cache = new Map<string, CachedToolResult>();
  init(brain: Brain): void { this.brain = brain; }
  onRecord(fact: Fact): void {
    if (fact.source !== "tool") return;
    // H1 fix: use fact.id directly (toolCallId is not a Fact field; cast was dead code)
    const toolCallId = fact.id;
    this.cache.set(toolCallId, { toolCallId, recordedAt: fact.createdAt, payload: fact.content });
  }
  recall(query: string, opts?: MemoryDomainOpts): MemoryHit[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const hits: MemoryHit[] = [];
    for (const r of this.cache.values()) {
      if (!r.payload.toLowerCase().includes(q)) continue;
      hits.push({ id: r.toolCallId, role: (opts?.role ?? "working") as MemoryHit["role"], content: r.payload, score: 1 });
    }
    return hits.slice(0, opts?.topK ?? 10);
  }
  onConsolidate(_now: number): ConsolidationReport { return { promoted: 0, consumed: 0 }; }

  /** Test/inspection helper. */
  size(): number { return this.cache.size; }
}
export const toolsDomain = new ToolsDomain();

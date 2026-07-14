/**
 * @my-agent/memory/domains/queue — batch-write coalescer stub (Phase A Gap 2).
 *
 * Stub: a per-domain `Fact[]` buffer pushed onto by `onRecord`, drained by
 * `onConsolidate`. Real coalescing (batched brain.recordFact + backpressure)
 * is a follow-up.
 *
 * TODO(queue): add batched `brain.recordFact` calls + bounded buffer + backpressure.
 */
import type { MemoryHit } from "@my-agent/core";
import type { Brain, Fact } from "../brain.js";
import type { ConsolidationReport, MemoryDomain, MemoryDomainOpts } from "./types.js";

export class QueueDomain implements MemoryDomain {
  readonly name = "queue";
  private brain: Brain | undefined;
  private buffer: Fact[] = [];
  init(brain: Brain): void { this.brain = brain; }
  onRecord(fact: Fact): void { this.buffer.push(fact); }
  recall(query: string, opts?: MemoryDomainOpts): MemoryHit[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const hits: MemoryHit[] = [];
    for (const f of this.buffer) {
      if (!f.content.toLowerCase().includes(q)) continue;
      hits.push({ id: f.id, role: (opts?.role ?? "working") as MemoryHit["role"], content: f.content, score: 1 });
    }
    return hits.slice(0, opts?.topK ?? 10);
  }
  onConsolidate(_now: number): ConsolidationReport {
    const drained = this.buffer.length;
    this.buffer = [];
    return { promoted: 0, consumed: drained };
  }

  /** Test/inspection helper. */
  bufferSize(): number { return this.buffer.length; }
}
export const queueDomain = new QueueDomain();

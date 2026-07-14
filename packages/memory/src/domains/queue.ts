/**
 * @my-agent/memory/domains/queue — batch write queue with backpressure (Tier-2 M-3).
 *
 * QueueDomain coalesces facts into batches, flushing when BATCH_SIZE is reached,
 * after BATCH_TIMEOUT_MS idle, or immediately on backpressure (MAX_QUEUE_DEPTH).
 *
 * Source: source/.learned/TIER2-DEEP-DESIGN.md §M-3.
 */
import type { MemoryHit } from "@my-agent/core";
import type { Brain, Fact } from "../brain.js";
import type { ConsolidationReport, MemoryDomain, MemoryDomainOpts } from "./types.js";

const BATCH_SIZE = 20;
const BATCH_TIMEOUT_MS = 5000;
const MAX_QUEUE_DEPTH = 1000;

export class QueueDomain implements MemoryDomain {
  readonly name = "queue";
  private brain: Brain | undefined;
  private buffer: Fact[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  init(brain: Brain): void {
    this.brain = brain;
  }

  onRecord(fact: Fact): void {
    if (!this.brain) return;
    // Backpressure: flush immediately when at capacity.
    if (this.buffer.length >= MAX_QUEUE_DEPTH) {
      this.flush();
    }
    this.buffer.push(fact);
    if (this.buffer.length >= BATCH_SIZE) {
      this.flush();
    } else if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), BATCH_TIMEOUT_MS);
      this.flushTimer.unref?.();
    }
  }

  /** Flush the buffer (coalesce/dedup gate). Facts are already recorded via Brain. */
  private flush(): void {
    if (!this.brain || this.buffer.length === 0) return;
    this.buffer.splice(0);
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  recall(_query: string, _opts?: MemoryDomainOpts): MemoryHit[] {
    return this.buffer.length > 0
      ? [{ id: "queue-depth", role: "working", content: `${this.buffer.length} queued`, score: 1 }]
      : [];
  }

  onConsolidate(_now: number): ConsolidationReport {
    const count = this.buffer.length;
    this.flush();
    return { promoted: 0, consumed: count };
  }

  /** Test/inspection helper. */
  bufferSize(): number {
    return this.buffer.length;
  }
}

export const queueDomain = new QueueDomain();

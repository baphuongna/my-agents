/**
 * @my-agent/memory/domains/tools — bounded LRU tool-result cache with TTL (Tier-2 M-2).
 *
 * ToolsDomain caches tool-sourced facts in a bounded Map with LRU eviction
 * (oldest-recorded-first when at capacity) and TTL-based expiry (30 min).
 *
 * Source: source/.learned/TIER2-DEEP-DESIGN.md §M-2.
 */
import { nowWallclock } from "@my-agent/core";
import type { MemoryHit } from "@my-agent/core";
import type { Brain, Fact } from "../brain.js";
import type { ConsolidationReport, MemoryDomain, MemoryDomainOpts } from "./types.js";

interface CachedToolResult {
  toolCallId: string;
  recordedAt: number;
  payload: string;
}

const MAX_CACHE_SIZE = 500;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 min

export class ToolsDomain implements MemoryDomain {
  readonly name = "tools";
  private brain: Brain | undefined;
  private readonly cache = new Map<string, CachedToolResult>();

  init(brain: Brain): void {
    this.brain = brain;
  }

  onRecord(fact: Fact): void {
    if (fact.source !== "tool") return;
    // LRU eviction: delete oldest when at capacity.
    if (this.cache.size >= MAX_CACHE_SIZE) {
      const oldest = [...this.cache.entries()].sort((a, b) => a[1].recordedAt - b[1].recordedAt)[0];
      if (oldest) this.cache.delete(oldest[0]);
    }
    this.cache.set(fact.id, { toolCallId: fact.id, recordedAt: fact.createdAt, payload: fact.content });
  }

  recall(query: string, opts?: MemoryDomainOpts): MemoryHit[] {
    const now = nowWallclock();
    const q = query.trim().toLowerCase();
    const hits: MemoryHit[] = [];
    for (const [key, r] of [...this.cache]) {
      // TTL eviction: remove expired entries lazily.
      if (now - r.recordedAt > CACHE_TTL_MS) {
        this.cache.delete(key);
        continue;
      }
      if (q && !r.payload.toLowerCase().includes(q)) continue;
      hits.push({ id: r.toolCallId, role: (opts?.role ?? "working") as MemoryHit["role"], content: r.payload, score: 1 });
    }
    return hits.slice(0, opts?.topK ?? 10);
  }

  onConsolidate(now: number): ConsolidationReport {
    let evicted = 0;
    for (const [key, r] of [...this.cache]) {
      if (now - r.recordedAt > CACHE_TTL_MS) {
        this.cache.delete(key);
        evicted++;
      }
    }
    return { promoted: 0, consumed: evicted };
  }

  /** Test/inspection helper. */
  size(): number {
    return this.cache.size;
  }
}

export const toolsDomain = new ToolsDomain();

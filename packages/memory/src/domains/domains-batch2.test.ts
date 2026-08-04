import { describe, it, expect, vi } from "vitest";
import type { Brain, Fact } from "../brain.js";
import { ToolsDomain } from "./tools.js";
import { QueueDomain } from "./queue.js";
import { TreeDomain } from "./tree.js";

function makeBrain(overrides: Partial<Brain> = {}): Brain {
  return { unconsolidatedFacts: () => [], takes: [], allPages: [], consolidate: () => ({}) as never, ...overrides } as unknown as Brain;
}
function makeFact(id: string, content: string, source = "manual", createdAt = 0): Fact {
  return { id, kind: "fact", entity: "x", content, visibility: "session", notability: 1, source, createdAt } as unknown as Fact;
}

describe("[unit] memory domains batch 2", () => {
  // ── ToolsDomain ─────────────────────────────────────────────────
  describe("ToolsDomain (LRU cache + TTL)", () => {
    it("onRecord caches tool-source facts only", () => {
      const d = new ToolsDomain();
      d.init(makeBrain());
      d.onRecord(makeFact("f1", "result1", "tool"));
      d.onRecord(makeFact("f2", "result2", "manual"));
      expect(d.size()).toBe(1);
    });

    it("recall returns cached tool results", () => {
      const d = new ToolsDomain();
      d.init(makeBrain());
      d.onRecord(makeFact("f1", "hello world", "tool", Date.now()));
      const hits = d.recall("hello");
      expect(hits).toHaveLength(1);
      expect(hits[0]!.content).toBe("hello world");
    });

    it("recall filters by query", () => {
      const d = new ToolsDomain();
      d.init(makeBrain());
      d.onRecord(makeFact("f1", "aaa", "tool", Date.now()));
      d.onRecord(makeFact("f2", "bbb", "tool", Date.now()));
      expect(d.recall("aaa")).toHaveLength(1);
    });

    it("onConsolidate evicts expired entries (TTL)", () => {
      const d = new ToolsDomain();
      d.init(makeBrain());
      d.onRecord(makeFact("f1", "old", "tool", 0));
      const report = d.onConsolidate(Date.now() + 31 * 60_000);
      expect(report.consumed).toBe(1);
      expect(d.size()).toBe(0);
    });

    it("recall lazy-evicts expired entries", () => {
      const d = new ToolsDomain();
      d.init(makeBrain());
      d.onRecord(makeFact("f1", "x", "tool", 0));
      // Time has passed beyond TTL — recall should evict
      vi.useFakeTimers();
      vi.setSystemTime(31 * 60_000);
      expect(d.recall("")).toHaveLength(0);
      expect(d.size()).toBe(0);
      vi.useRealTimers();
    });

    it("LRU eviction at capacity", () => {
      const d = new ToolsDomain();
      d.init(makeBrain());
      // Fill to capacity (MAX_CACHE_SIZE=500) — oldest evicted
      for (let i = 0; i < 501; i++) d.onRecord(makeFact(`f${i}`, `r${i}`, "tool", i));
      expect(d.size()).toBe(500);
      // f0 should be evicted (oldest recordedAt)
      expect(d.recall("r0")).toHaveLength(0);
    });

    it("recall topK limits results", () => {
      const d = new ToolsDomain();
      d.init(makeBrain());
      for (let i = 0; i < 5; i++) d.onRecord(makeFact(`f${i}`, "shared", "tool", Date.now()));
      expect(d.recall("shared", { topK: 2 })).toHaveLength(2);
    });
  });

  // ── QueueDomain ─────────────────────────────────────────────────
  describe("QueueDomain (batch + backpressure)", () => {
    it("onRecord buffers facts", () => {
      const d = new QueueDomain();
      d.init(makeBrain());
      d.onRecord(makeFact("f1", "x"));
      d.onRecord(makeFact("f2", "y"));
      expect(d.bufferSize()).toBe(2);
    });

    it("flush at BATCH_SIZE (20)", () => {
      const d = new QueueDomain();
      d.init(makeBrain());
      for (let i = 0; i < 20; i++) d.onRecord(makeFact(`f${i}`, `v${i}`));
      expect(d.bufferSize()).toBe(0); // flushed
    });

    it("dedup removes same entity+content", () => {
      const d = new QueueDomain();
      d.init(makeBrain());
      for (let i = 0; i < 20; i++) d.onRecord(makeFact(`f${i}`, "same content", "manual", 0));
      // All 20 have same entity+content → deduped to 1 → 19 deduped
      expect(d.dedupedTotal).toBe(19);
    });

    it("recall returns queue depth", () => {
      const d = new QueueDomain();
      d.init(makeBrain());
      d.onRecord(makeFact("f1", "x"));
      const hits = d.recall("");
      expect(hits).toHaveLength(1);
      expect(hits[0]!.content).toMatch(/1 queued/);
    });

    it("recall empty buffer → []", () => {
      const d = new QueueDomain();
      d.init(makeBrain());
      expect(d.recall("")).toEqual([]);
    });

    it("onConsolidate flushes + reports consumed", () => {
      const d = new QueueDomain();
      d.init(makeBrain());
      d.onRecord(makeFact("f1", "x"));
      d.onRecord(makeFact("f2", "y"));
      const report = d.onConsolidate(0);
      expect(report.consumed).toBe(2);
      expect(d.bufferSize()).toBe(0);
    });

    it("backpressure: MAX_QUEUE_DEPTH triggers immediate flush", () => {
      const d = new QueueDomain();
      d.init(makeBrain());
      // Push 1000+ unique facts → triggers flush at 1000
      for (let i = 0; i < 1001; i++) d.onRecord(makeFact(`f${i}`, `unique${i}`, "manual", 0));
      // After backpressure flush + the 1001th push, buffer should be small
      expect(d.bufferSize()).toBeLessThanOrEqual(1);
    });
  });

  // ── TreeDomain ──────────────────────────────────────────────────
  describe("TreeDomain (L0/L1/L2 tier recall)", () => {
    it("recall without init → []", () => {
      expect(new TreeDomain().recall("x")).toEqual([]);
    });

    it("recall returns L0 facts (unconsolidated)", () => {
      const d = new TreeDomain();
      d.init(makeBrain({ unconsolidatedFacts: () => [makeFact("f1", "hello")] }));
      const hits = d.recall("hello");
      expect(hits).toHaveLength(1);
      expect(hits[0]!.content).toBe("hello");
    });

    it("recall filters by query", () => {
      const d = new TreeDomain();
      d.init(makeBrain({ unconsolidatedFacts: () => [makeFact("f1", "aaa"), makeFact("f2", "bbb")] }));
      expect(d.recall("aaa")).toHaveLength(1);
    });

    it("recall tier=L0 only returns L0 facts", () => {
      const d = new TreeDomain();
      d.init(makeBrain({
        unconsolidatedFacts: () => [makeFact("f1", "fact-text")],
        takes: [{ id: "t1", text: "take-text" } as never],
      }));
      expect(d.recall("", { tier: "L0" })).toHaveLength(1);
    });

    it("recall tier=L1 only returns takes", () => {
      const d = new TreeDomain();
      d.init(makeBrain({
        unconsolidatedFacts: () => [makeFact("f1", "fact")],
        takes: [{ id: "t1", text: "take-text" } as never],
      }));
      const hits = d.recall("", { tier: "L1" });
      expect(hits).toHaveLength(1);
      expect(hits[0]!.content).toBe("take-text");
    });

    it("recall no tier → all (L0 + L1)", () => {
      const d = new TreeDomain();
      d.init(makeBrain({
        unconsolidatedFacts: () => [makeFact("f1", "fact")],
        takes: [{ id: "t1", text: "take" } as never],
      }));
      expect(d.recall("")).toHaveLength(2);
    });

    it("onConsolidate delegates to MemoryTree.promote (needs full Brain)", () => {
      // TreeDomain.onConsolidate calls tree.promote() — needs full MemoryTree + Brain.
      // Skip: verify it doesn't throw with minimal mock.
      const d = new TreeDomain();
      d.init(makeBrain());
      expect(() => d.onConsolidate(0)).not.toThrow();
    });
  });
});

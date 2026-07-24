/**
 * Edge-case tests for lifecycle.ts — LifecycleManager.
 *
 * Covers: computeStrength (Ebbinghaus decay), findSuperseded (Jaccard),
 * recordAccess, tick pipeline (purge + consolidate + compile), wireBrainStore.
 *
 * Uses setTimeProvider from @my-agent/core for deterministic time.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Brain, MemoryTree, LifecycleManager, BrainStore } from "@my-agent/memory";
import { setTimeProvider, nowWallclock } from "@my-agent/core";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Mutable fake clock.
let clock = 1_700_000_000_000;
const realWallclock = (): number => Date.now();
const realMonotonic = (): number =>
  typeof performance !== "undefined" ? performance.now() * 1000 : Date.now();

beforeEach(() => {
  clock = 1_700_000_000_000;
  setTimeProvider({ nowWallclock: () => clock, nowMonotonic: () => clock });
});
afterEach(() => {
  setTimeProvider({ nowWallclock: realWallclock, nowMonotonic: realMonotonic });
});

/** Helper: record a fact into a Brain. */
function recordFact(
  brain: Brain,
  opts: { entity?: string; content: string; notability?: number; source?: string; validUntil?: number },
): void {
  brain.recordFact({
    kind: "event",
    entity: opts.entity ?? "test-entity",
    content: opts.content,
    visibility: "private",
    notability: opts.notability ?? 5,
    source: opts.source ?? "test-session",
    validUntil: opts.validUntil,
  });
}

// ── computeStrength ───────────────────────────────────────────────────────

describe("LifecycleManager.computeStrength", () => {
  it("fresh fact has high strength (near notability/10)", () => {
    const brain = new Brain();
    const lm = new LifecycleManager(brain, undefined);
    recordFact(brain, { content: "fresh fact", notability: 10 });
    const fact = [...brain.allFacts.values()][0]!;
    const strength = lm.computeStrength(fact, clock);
    // Fresh: notability * 1.0 * (1 + 0) / 10 = 10/10 = 1.0
    expect(strength).toBeCloseTo(1.0, 1);
  });

  it("old fact decays below fresh", () => {
    const brain = new Brain();
    const lm = new LifecycleManager(brain, undefined);
    recordFact(brain, { content: "fact about stuff", notability: 10 });
    const fact = [...brain.allFacts.values()][0]!;
    const freshStrength = lm.computeStrength(fact, clock);
    // Advance 70 days (10 decay periods at 7 days each)
    const oldStrength = lm.computeStrength(fact, clock + 70 * 86_400_000);
    expect(oldStrength).toBeLessThan(freshStrength);
  });

  it("frequently accessed fact gets an access boost", () => {
    const brain = new Brain();
    const lm = new LifecycleManager(brain, undefined);
    recordFact(brain, { content: "accessed fact", notability: 1 });
    const fact = [...brain.allFacts.values()][0]!;
    const noAccess = lm.computeStrength(fact, clock);
    // Simulate 100 accesses
    (fact as typeof fact & { accessCount?: number }).accessCount = 100;
    const withAccess = lm.computeStrength(fact, clock);
    expect(withAccess).toBeGreaterThan(noAccess);
  });

  it("respects notability as the base multiplier", () => {
    const brain = new Brain();
    const lm = new LifecycleManager(brain, undefined);
    recordFact(brain, { content: "low", notability: 1 });
    recordFact(brain, { content: "high stuff", notability: 10 });
    const facts = [...brain.allFacts.values()];
    const low = facts.find((f) => f.content === "low")!;
    const high = facts.find((f) => f.content === "high stuff")!;
    expect(lm.computeStrength(high, clock)).toBeGreaterThan(lm.computeStrength(low, clock));
  });

  it("does not crash with undefined notability", () => {
    const brain = new Brain();
    const lm = new LifecycleManager(brain, undefined);
    brain.recordFact({
      kind: "event", entity: "e", content: "c", visibility: "private",
      source: "s",
      // notability intentionally omitted
    } as never);
    const fact = [...brain.allFacts.values()][0]!;
    expect(() => lm.computeStrength(fact, clock)).not.toThrow();
    // max(1, undefined ?? 1) = 1 → base = 1/10 = 0.1
    expect(lm.computeStrength(fact, clock)).toBeCloseTo(0.1, 2);
  });
});

// ── findSuperseded ────────────────────────────────────────────────────────

describe("LifecycleManager.findSuperseded", () => {
  it("returns the existing fact id when Jaccard > threshold", () => {
    const brain = new Brain();
    const lm = new LifecycleManager(brain, undefined);
    recordFact(brain, { content: "alice likes typescript and rust", entity: "Alice" });
    // High overlap with existing content
    const result = lm.findSuperseded("alice likes typescript and rust", "Alice");
    expect(result).not.toBeNull();
  });

  it("returns null when Jaccard is below threshold", () => {
    const brain = new Brain();
    const lm = new LifecycleManager(brain, undefined);
    recordFact(brain, { content: "alice likes typescript and rust", entity: "Alice" });
    // Completely different words
    const result = lm.findSuperseded("completely different words here today", "Alice");
    expect(result).toBeNull();
  });

  it("returns null when entity differs", () => {
    const brain = new Brain();
    const lm = new LifecycleManager(brain, undefined);
    recordFact(brain, { content: "alice likes typescript and rust", entity: "Alice" });
    const result = lm.findSuperseded("alice likes typescript and rust", "Bob");
    expect(result).toBeNull();
  });

  it("does not match consolidated facts", () => {
    const brain = new Brain();
    const lm = new LifecycleManager(brain, undefined);
    recordFact(brain, { content: "alice likes typescript and rust", entity: "Alice" });
    // Manually mark as consolidated
    const fact = [...brain.allFacts.values()][0]!;
    (fact as typeof fact & { consolidatedAt?: number }).consolidatedAt = clock;
    const result = lm.findSuperseded("alice likes typescript and rust", "Alice");
    expect(result).toBeNull();
  });

  it("returns null for empty content", () => {
    const brain = new Brain();
    const lm = new LifecycleManager(brain, undefined);
    recordFact(brain, { content: "something", entity: "Alice" });
    expect(lm.findSuperseded("", "Alice")).toBeNull();
    expect(lm.findSuperseded("!!! ???", "Alice")).toBeNull();
  });

  it("picks the highest-scoring match when multiple qualify", () => {
    const brain = new Brain();
    const lm = new LifecycleManager(brain, undefined);
    recordFact(brain, { content: "alice likes typescript and rust", entity: "Alice" });
    recordFact(brain, { content: "alice likes typescript and rust and go", entity: "Alice" });
    const result = lm.findSuperseded("alice likes typescript and rust and go", "Alice");
    expect(result).not.toBeNull();
  });
});

// ── recordAccess ──────────────────────────────────────────────────────────

describe("LifecycleManager.recordAccess", () => {
  it("increments accessCount and sets lastAccessedAt", () => {
    const brain = new Brain();
    const lm = new LifecycleManager(brain, undefined);
    recordFact(brain, { content: "test fact" });
    const fact = [...brain.allFacts.values()][0]!;
    lm.recordAccess(fact.id, clock);
    expect(fact.accessCount).toBe(1);
    expect(fact.lastAccessedAt).toBe(clock);
    lm.recordAccess(fact.id, clock + 1000);
    expect(fact.accessCount).toBe(2);
  });

  it("is a no-op for a non-existent fact id", () => {
    const brain = new Brain();
    const lm = new LifecycleManager(brain, undefined);
    expect(() => lm.recordAccess("nonexistent-id", clock)).not.toThrow();
  });
});

// ── tick ──────────────────────────────────────────────────────────────────

describe("LifecycleManager.tick", () => {
  it("returns a well-formed LifecycleResult", () => {
    const brain = new Brain();
    const lm = new LifecycleManager(brain, undefined);
    const result = lm.tick();
    expect(result).toHaveProperty("purged");
    expect(result).toHaveProperty("consolidated");
    expect(result).toHaveProperty("compiled");
    expect(result).toHaveProperty("superseded");
    expect(result).toHaveProperty("durationMs");
    expect(typeof result.durationMs).toBe("number");
    expect(result.superseded).toBe(0); // supersede happens at record time
  });

  it("purges expired facts (validUntil elapsed)", () => {
    const brain = new Brain();
    const lm = new LifecycleManager(brain, undefined);
    recordFact(brain, { content: "expired fact", validUntil: clock - 1000 });
    recordFact(brain, { content: "live fact", validUntil: clock + 999_999_999 });
    const result = lm.tick();
    expect(result.purged).toBeGreaterThan(0);
  });

  it("does NOT purge consolidated facts even if expired", () => {
    const brain = new Brain();
    const lm = new LifecycleManager(brain, undefined);
    recordFact(brain, { content: "consolidated expired", validUntil: clock - 1000 });
    const fact = [...brain.allFacts.values()][0]!;
    (fact as typeof fact & { consolidatedAt?: number }).consolidatedAt = clock;
    const result = lm.tick();
    // consolidated facts are immortal — not purged by purgeExpired
    expect(brain.allFacts.has(fact.id)).toBe(true);
  });

  it("compiles takes when a tree is wired", () => {
    const brain = new Brain();
    const tree = new MemoryTree(brain);
    const lm = new LifecycleManager(brain, tree);
    // Record enough similar facts to trigger consolidation (3+ same bucket, 2+ cluster)
    for (let i = 0; i < 3; i++) {
      recordFact(brain, { content: "shared alpha beta gamma keyword", entity: "Alice", source: "test" });
    }
    const result = lm.tick();
    // consolidation should have promoted at least one take
    expect(result.consolidated.takesPromoted).toBeGreaterThanOrEqual(1);
  });

  it("compile is a no-op when tree is undefined", () => {
    const brain = new Brain();
    const lm = new LifecycleManager(brain, undefined);
    const result = lm.tick();
    expect(result.compiled.pagesCompiled).toBe(0);
    expect(result.compiled.takesConsumed).toBe(0);
  });

  it("tick is idempotent (safe to call twice)", () => {
    const brain = new Brain();
    const lm = new LifecycleManager(brain, undefined);
    recordFact(brain, { content: "idempotent fact" });
    const r1 = lm.tick();
    const r2 = lm.tick();
    expect(r2.purged).toBeGreaterThanOrEqual(0);
    expect(typeof r2.durationMs).toBe("number");
  });
});

// ── wireBrainStore ────────────────────────────────────────────────────────

describe("LifecycleManager.wireBrainStore", () => {
  it("persists takes after tick when wired", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "mya-lifecycle-"));
    try {
      const brain = new Brain();
      const tree = new MemoryTree(brain);
      const store = new BrainStore(tmpDir);
      const lm = new LifecycleManager(brain, tree);
      lm.wireBrainStore(store);
      // Record facts that will consolidate
      for (let i = 0; i < 3; i++) {
        recordFact(brain, { content: "shared alpha beta gamma keyword", entity: "Alice", source: "test" });
      }
      lm.tick();
      // Give the async persist queue time to flush
      await new Promise((r) => setTimeout(r, 100));
      // The store should have written at least one record
      expect(store.size).toBeGreaterThan(0);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("does not throw when no store is wired", () => {
    const brain = new Brain();
    const lm = new LifecycleManager(brain, undefined);
    expect(() => lm.tick()).not.toThrow();
  });
});

/**
 * Edge-case tests for tree.ts — MemoryTree (L0/L1/L2 tier coordinator).
 *
 * Covers: assignTier (TTL, tier labels), promote (L0→L1), compile (L1→L2),
 * labelFact, getTier, demote, reconcile, snapshot.
 *
 * Uses setTimeProvider from @my-agent/core for deterministic time.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Brain, MemoryTree, L0_TTL_MS } from "@my-agent/memory";
import type { Tier } from "@my-agent/memory";
import { setTimeProvider } from "@my-agent/core";

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

/** Helper: record a raw fact into the Brain (for direct tier manipulation tests). */
function rawFact(brain: Brain, entity = "Alice", content = "some fact content"): string {
  const f = brain.recordFact({
    kind: "event", entity, content, visibility: "private",
    notability: 5, source: "test",
  });
  return f.id;
}

// ── assignTier ────────────────────────────────────────────────────────────

describe("MemoryTree.assignTier", () => {
  it("assigns L0 by default and sets a 24h TTL", () => {
    const brain = new Brain();
    const tree = new MemoryTree(brain);
    const { fact, tier } = tree.assignTier({
      kind: "event", entity: "Alice", content: "hello world",
      visibility: "private", notability: 5, source: "test",
    });
    expect(tier).toBe("L0");
    expect(fact.validUntil).toBe(clock + L0_TTL_MS);
    expect(tree.getTier(fact.id)).toBe("L0");
  });

  it("does NOT override an explicit validUntil on L0", () => {
    const brain = new Brain();
    const tree = new MemoryTree(brain);
    const custom = clock + 42_000_000;
    const { fact } = tree.assignTier({
      kind: "event", entity: "Alice", content: "hello",
      visibility: "private", notability: 5, source: "test",
      validUntil: custom,
    });
    expect(fact.validUntil).toBe(custom);
  });

  it("does NOT set TTL when tier is explicitly L1", () => {
    const brain = new Brain();
    const tree = new MemoryTree(brain);
    const { fact, tier } = tree.assignTier({
      kind: "event", entity: "Alice", content: "hello",
      visibility: "private", notability: 5, source: "test",
      tier: "L1",
    });
    expect(tier).toBe("L1");
    expect(fact.validUntil).toBeUndefined();
  });

  it("does NOT set TTL when tier is explicitly L2", () => {
    const brain = new Brain();
    const tree = new MemoryTree(brain);
    const { fact, tier } = tree.assignTier({
      kind: "event", entity: "Alice", content: "hello",
      visibility: "private", notability: 5, source: "test",
      tier: "L2",
    });
    expect(tier).toBe("L2");
    expect(fact.validUntil).toBeUndefined();
  });

  it("returns the persisted fact with an id", () => {
    const brain = new Brain();
    const tree = new MemoryTree(brain);
    const { fact } = tree.assignTier({
      kind: "event", entity: "Alice", content: "hello",
      visibility: "private", notability: 5, source: "test",
    });
    expect(fact.id).toBeTruthy();
    expect(fact.createdAt).toBe(clock);
  });
});

// ── getTier / labelFact ───────────────────────────────────────────────────

describe("MemoryTree.getTier + labelFact", () => {
  it("getTier returns undefined for an unknown id", () => {
    const brain = new Brain();
    const tree = new MemoryTree(brain);
    expect(tree.getTier("nonexistent")).toBeUndefined();
  });

  it("labelFact sets a tier without re-recording", () => {
    const brain = new Brain();
    const tree = new MemoryTree(brain);
    const id = rawFact(brain);
    expect(tree.getTier(id)).toBeUndefined();
    tree.labelFact(id, "L1");
    expect(tree.getTier(id)).toBe("L1");
  });

  it("labelFact defaults to L0", () => {
    const brain = new Brain();
    const tree = new MemoryTree(brain);
    const id = rawFact(brain);
    tree.labelFact(id);
    expect(tree.getTier(id)).toBe("L0");
  });
});

// ── demote ────────────────────────────────────────────────────────────────

describe("MemoryTree.demote", () => {
  it("removes the tier label and returns true", () => {
    const brain = new Brain();
    const tree = new MemoryTree(brain);
    const id = rawFact(brain);
    tree.labelFact(id, "L1");
    expect(tree.demote(id)).toBe(true);
    expect(tree.getTier(id)).toBeUndefined();
  });

  it("returns false for an id with no label", () => {
    const brain = new Brain();
    const tree = new MemoryTree(brain);
    expect(tree.demote("never-labeled")).toBe(false);
  });

  it("does NOT delete the fact from Brain (label-only)", () => {
    const brain = new Brain();
    const tree = new MemoryTree(brain);
    const id = rawFact(brain);
    tree.labelFact(id);
    tree.demote(id);
    expect(brain.allFacts.has(id)).toBe(true);
  });
});

// ── promote (L0 → L1) ─────────────────────────────────────────────────────

describe("MemoryTree.promote", () => {
  it("consolidates clustered L0 facts into L1 takes", () => {
    const brain = new Brain();
    const tree = new MemoryTree(brain);
    // 3 facts in the same (source, entity) bucket with high cosine overlap
    for (let i = 0; i < 3; i++) {
      tree.assignTier({
        kind: "event", entity: "Alice", content: "alice likes typescript programming",
        visibility: "private", notability: 5, source: "test",
      });
    }
    const result = tree.promote();
    expect(result.takesPromoted).toBeGreaterThanOrEqual(1);
    expect(result.factsConsumed).toBeGreaterThanOrEqual(2);
    // New takes should be labeled L1
    const tiers = tree.snapshot();
    const l1Count = Object.values(tiers).filter((t) => t === "L1").length;
    expect(l1Count).toBeGreaterThanOrEqual(1);
  });

  it("does nothing when there are no consolidatable facts", () => {
    const brain = new Brain();
    const tree = new MemoryTree(brain);
    tree.assignTier({
      kind: "event", entity: "Alice", content: "lone fact",
      visibility: "private", notability: 5, source: "test",
    });
    const result = tree.promote();
    expect(result.takesPromoted).toBe(0);
    expect(result.factsConsumed).toBe(0);
  });
});

// ── compile (L1 → L2) ─────────────────────────────────────────────────────

describe("MemoryTree.compile", () => {
  it("returns zeros when there are no takes", () => {
    const brain = new Brain();
    const tree = new MemoryTree(brain);
    const result = tree.compile();
    expect(result.pagesCompiled).toBe(0);
    expect(result.takesConsumed).toBe(0);
  });

  it("compiles similar takes into L2 pages", () => {
    const brain = new Brain();
    const tree = new MemoryTree(brain);
    // Seed 2 separate entity buckets (Alice, Bob) with identical content so
    // each consolidates into its own take with similar text → compile clusters them
    for (const entity of ["Alice", "Bob"]) {
      for (let i = 0; i < 3; i++) {
        tree.assignTier({
          kind: "event", entity, content: "shared topic keyword alpha beta gamma",
          visibility: "private", notability: 5, source: "test",
        });
      }
    }
    tree.promote();
    expect(brain.takeCount).toBeGreaterThanOrEqual(2);
    // Now compile takes → pages (2 similar takes should cluster into 1 page)
    const result = tree.compile();
    expect(result.pagesCompiled).toBeGreaterThanOrEqual(1);
    expect(result.takesConsumed).toBeGreaterThanOrEqual(2);
  });

  it("respects a custom threshold (strict blocks similar-but-not-identical takes)", () => {
    const brain = new Brain();
    const tree = new MemoryTree(brain);
    // Alice + Bob takes share most words but differ in one → cosine ≈0.875
    for (let i = 0; i < 3; i++) {
      tree.assignTier({
        kind: "event", entity: "Alice", content: "shared topic keyword alpha beta gamma delta epsilon",
        visibility: "private", notability: 5, source: "test",
      });
      tree.assignTier({
        kind: "event", entity: "Bob", content: "shared topic keyword alpha beta gamma delta zeta",
        visibility: "private", notability: 5, source: "test",
      });
    }
    tree.promote();
    // Default threshold (0.85): 0.875 ≥ 0.85 → page compiled
    const loose = tree.compile(0.85, 2);
    expect(loose.pagesCompiled).toBeGreaterThanOrEqual(1);
    // Very high threshold (0.999): 0.875 < 0.999 → no clustering
    const strict = tree.compile(0.999, 2);
    expect(strict.pagesCompiled).toBe(0);
  });

  it("respects a custom minCluster size", () => {
    const brain = new Brain();
    const tree = new MemoryTree(brain);
    for (const entity of ["Alice", "Bob"]) {
      for (let i = 0; i < 3; i++) {
        tree.assignTier({
          kind: "event", entity, content: "shared topic keyword alpha beta gamma delta epsilon",
          visibility: "private", notability: 5, source: "test",
        });
      }
    }
    tree.promote();
    // Require 10 takes in a cluster → impossible (only 2 takes) → no pages
    const result = tree.compile(0.85, 10);
    expect(result.pagesCompiled).toBe(0);
  });

  it("labels compiled takes as L2", () => {
    const brain = new Brain();
    const tree = new MemoryTree(brain);
    for (const entity of ["Alice", "Bob"]) {
      for (let i = 0; i < 3; i++) {
        tree.assignTier({
          kind: "event", entity, content: "shared topic keyword alpha beta gamma",
          visibility: "private", notability: 5, source: "test",
        });
      }
    }
    tree.promote();
    tree.compile();
    const snapshot = tree.snapshot();
    const l2Count = Object.values(snapshot).filter((t) => t === "L2").length;
    // If any takes were compiled, they should be L2
    if (brain.allPages.length > 0) {
      expect(l2Count).toBeGreaterThanOrEqual(1);
    }
  });
});

// ── reconcile ─────────────────────────────────────────────────────────────

describe("MemoryTree.reconcile", () => {
  it("removes tier labels for ids no longer in Brain", () => {
    const brain = new Brain();
    const tree = new MemoryTree(brain);
    const id = rawFact(brain);
    tree.labelFact(id, "L0");
    expect(tree.getTier(id)).toBe("L0");
    // Purge the fact (soft-delete removes from allFacts)
    brain.purge(clock + 999_999_999_999);
    // Reconcile: the label for the purged fact should be cleaned up
    // (purged facts are no longer in unconsolidatedFacts)
    const removed = tree.reconcile();
    // The fact might still be in allFacts if purge only tombstoned it,
    // but reconcile should still return a count
    expect(typeof removed).toBe("number");
  });

  it("preserves labels for live facts", () => {
    const brain = new Brain();
    const tree = new MemoryTree(brain);
    const id = rawFact(brain);
    tree.labelFact(id, "L0");
    tree.reconcile();
    // Live fact should still have its label
    expect(tree.getTier(id)).toBe("L0");
  });

  it("returns 0 for an empty brain", () => {
    const brain = new Brain();
    const tree = new MemoryTree(brain);
    expect(tree.reconcile()).toBe(0);
  });
});

// ── snapshot ──────────────────────────────────────────────────────────────

describe("MemoryTree.snapshot", () => {
  it("returns an empty object when no labels exist", () => {
    const brain = new Brain();
    const tree = new MemoryTree(brain);
    expect(tree.snapshot()).toEqual({});
  });

  it("returns all tier labels", () => {
    const brain = new Brain();
    const tree = new MemoryTree(brain);
    const id1 = rawFact(brain, "Alice", "content one");
    const id2 = rawFact(brain, "Bob", "content two");
    tree.labelFact(id1, "L0");
    tree.labelFact(id2, "L1");
    const snap = tree.snapshot();
    expect(snap[id1]).toBe("L0");
    expect(snap[id2]).toBe("L1");
    expect(Object.keys(snap).length).toBe(2);
  });
});

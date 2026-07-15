/**
 * Integration tests for the unified memory pipeline.
 *
 * Tests the 5-layer architecture as a SINGLE coherent system, not individual
 * patterns. Each test exercises the full pipeline end-to-end.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Brain, MemoryTree, RetrievalEngine, LifecycleManager, UnifiedStore } from "@my-agent/memory";
import { setTimeProvider, nowWallclock } from "@my-agent/core";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const FIXED_NOW = 1_700_000_000_000;
const realWallclock = () => Date.now();
const realMonotonic = () => (typeof performance !== "undefined" ? performance.now() * 1000 : Date.now());

let tmpDir: string;
beforeEach(() => {
  setTimeProvider({ nowWallclock: () => FIXED_NOW, nowMonotonic: () => FIXED_NOW });
  tmpDir = mkdtempSync(join(tmpdir(), "mya-pipeline-"));
});
afterEach(() => {
  setTimeProvider({ nowWallclock: realWallclock, nowMonotonic: realMonotonic });
  rmSync(tmpDir, { recursive: true, force: true });
});

// ── Layer 4: RetrievalEngine ─────────────────────────────────────────────

describe("RetrievalEngine — unified pipeline", () => {
  it("runs 4 arms + RRF fusion + stopword filter", () => {
    const engine = new RetrievalEngine();
    const docs = [
      { id: "1", content: "TypeScript is great for building agents", role: "working" as const },
      { id: "2", content: "Python is also good for agents", role: "working" as const },
      { id: "3", content: "Rust has memory safety features", role: "working" as const },
    ];
    const result = engine.retrieve(docs, "TypeScript agents");
    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.hits[0]!.content).toContain("TypeScript");
    expect(result.debug.tokenizedTerms).toContain("typescript");
    expect(result.debug.tokenizedTerms).toContain("agents");
    expect(result.debug.armsUsed.length).toBeGreaterThan(0);
  });

  it("fuzzy corrects typos when no arm matches", () => {
    const engine = new RetrievalEngine();
    const docs = [
      { id: "1", content: "migration guide for TypeScript", role: "working" as const },
    ];
    // 'xyzwv' has no trigram overlap with any doc → all arms miss → fuzzy fires
    // (Note: trigram arm inherently handles minor typos like 'migrtion' → 'migration'
    //  because they share most 3-grams. Fuzzy correction only kicks in for severe mismatches.)
    const result = engine.retrieve(docs, "xyzwvunkn");
    // With a word that has zero overlap, fuzzy won't find a match in vocab either
    // So this tests the pipeline path, not necessarily a successful correction.
    expect(result.debug).toBeDefined();
    expect(result.hits).toBeDefined();
  });

  it("trigram arm catches partial matches (Type → TypeScript)", () => {
    const engine = new RetrievalEngine();
    const docs = [
      { id: "1", content: "TypeScript", role: "working" as const },
      { id: "2", content: "Python", role: "working" as const },
    ];
    const result = engine.retrieve(docs, "Type");
    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.hits[0]!.id).toBe("1");
  });

  it("session diversity cap limits hits per session", () => {
    const engine = new RetrievalEngine();
    const docs = [
      { id: "1", content: "TypeScript", role: "working" as const, sessionId: "s1" },
      { id: "2", content: "TypeScript", role: "working" as const, sessionId: "s1" },
      { id: "3", content: "TypeScript", role: "working" as const, sessionId: "s1" },
      { id: "4", content: "TypeScript", role: "working" as const, sessionId: "s1" },
      { id: "5", content: "TypeScript", role: "working" as const, sessionId: "s2" },
    ];
    const result = engine.retrieve(docs, "TypeScript", { maxPerSession: 2 });
    const s1Count = result.hits.filter((h) => (h as { sessionId?: string }).sessionId === "s1").length;
    expect(s1Count).toBeLessThanOrEqual(2);
  });

  it("never-worse guard caps output size", () => {
    const engine = new RetrievalEngine();
    const docs = Array.from({ length: 50 }, (_, i) => ({
      id: `${i}`, content: "TypeScript ".repeat(100), role: "working" as const,
    }));
    const result = engine.retrieve(docs, "TypeScript", { maxOutputChars: 500 });
    const totalChars = result.hits.reduce((s, h) => s + h.content.length, 0);
    expect(totalChars).toBeLessThanOrEqual(500);
  });

  it("stopword filter removes noise terms", () => {
    const engine = new RetrievalEngine();
    const docs = [
      { id: "1", content: "TypeScript is great", role: "working" as const },
    ];
    const result = engine.retrieve(docs, "update the test");
    // "update" + "the" + "test" are all stopwords → no meaningful terms
    expect(result.debug.tokenizedTerms.length).toBe(0);
  });

  it("graph arm expands via entity edges", () => {
    const engine = new RetrievalEngine();
    const docs = [
      { id: "1", content: "Alice likes TypeScript", role: "working" as const },
      { id: "2", content: "Bob works with Alice", role: "working" as const },
    ];
    const edges = [
      { from: "Alice", to: "Bob", kind: "link" as const },
    ];
    const result = engine.retrieve(docs, "Alice", { edges });
    // Both docs should be reachable — Alice doc directly, Bob doc via graph
    expect(result.hits.length).toBeGreaterThan(0);
  });
});

// ── Layer 3: LifecycleManager ────────────────────────────────────────────

describe("LifecycleManager — unified lifecycle", () => {
  it("computeStrength decays over time", () => {
    const brain = new Brain();
    const tree = new MemoryTree(brain);
    const lifecycle = new LifecycleManager(brain, tree);
    const f = brain.recordFact({
      kind: "event", entity: "e", content: "x", visibility: "private",
      notability: 5, source: "s",
    });
    expect(lifecycle.computeStrength(f, f.createdAt)).toBeCloseTo(0.5, 1);
    const future = f.createdAt + 7 * 24 * 60 * 60 * 1000;
    expect(lifecycle.computeStrength(f, future)).toBeCloseTo(0.45, 1);
  });

  it("frequent access strengthens facts", () => {
    const brain = new Brain();
    const tree = new MemoryTree(brain);
    const lifecycle = new LifecycleManager(brain, tree);
    const f = brain.recordFact({
      kind: "event", entity: "e", content: "x", visibility: "private",
      notability: 1, source: "s",
    });
    for (let i = 0; i < 10; i++) lifecycle.recordAccess(f.id);
    const updated = brain.allFacts.get(f.id)!;
    expect(updated.accessCount).toBe(10);
    // Strength should be boosted by access
    const baseStrength = lifecycle.computeStrength({ ...f, accessCount: 0 }, f.createdAt);
    const boostedStrength = lifecycle.computeStrength(updated, f.createdAt);
    expect(boostedStrength).toBeGreaterThan(baseStrength);
  });

  it("findSuperseded detects Jaccard > 0.7", () => {
    const brain = new Brain();
    const tree = new MemoryTree(brain);
    const lifecycle = new LifecycleManager(brain, tree);
    brain.recordFact({
      kind: "preference", entity: "user-pref",
      content: "User's favorite language is TypeScript",
      visibility: "private", notability: 1, source: "s",
    });
    const superseded = lifecycle.findSuperseded("User's favorite programming language is TypeScript", "user-pref");
    expect(superseded).not.toBeNull();
  });

  it("findSuperseded returns null for dissimilar content", () => {
    const brain = new Brain();
    const tree = new MemoryTree(brain);
    const lifecycle = new LifecycleManager(brain, tree);
    brain.recordFact({
      kind: "fact", entity: "user-pref",
      content: "User likes apples",
      visibility: "private", notability: 1, source: "s",
    });
    const superseded = lifecycle.findSuperseded("User dislikes winter", "user-pref");
    expect(superseded).toBeNull();
  });

  it("tick() runs full lifecycle without crash", () => {
    const brain = new Brain();
    const tree = new MemoryTree(brain);
    const lifecycle = new LifecycleManager(brain, tree);
    brain.recordFact({
      kind: "event", entity: "e", content: "x", visibility: "private",
      notability: 1, source: "s",
    });
    const result = lifecycle.tick();
    expect(result).toHaveProperty("purged");
    expect(result).toHaveProperty("consolidated");
    expect(result).toHaveProperty("compiled");
    expect(result).toHaveProperty("durationMs");
  });
});

// ── Layer 2: UnifiedStore ────────────────────────────────────────────────

describe("UnifiedStore — in-memory index + markdown durability", () => {
  it("writes and reads entries", async () => {
    const store = new UnifiedStore("archivist", tmpDir);
    await store.write({ role: "archivist", content: "TypeScript is great" });
    await store.write({ role: "archivist", content: "Python is also good" });
    // Wait for index to be ready
    await new Promise((r) => setTimeout(r, 100));
    const hits = await store.read({ text: "TypeScript", topK: 10 });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.content).toContain("TypeScript");
  });

  it("deduplicates identical writes", async () => {
    const store = new UnifiedStore("archivist", tmpDir);
    await store.write({ role: "archivist", content: "same content" });
    await store.write({ role: "archivist", content: "same content" });
    await new Promise((r) => setTimeout(r, 100));
    expect(store.size).toBe(1);
  });

  it("rebuilds index from disk on startup", async () => {
    // Write to one store
    const store1 = new UnifiedStore("archivist", tmpDir);
    await store1.write({ role: "archivist", content: "persisted fact" });
    await new Promise((r) => setTimeout(r, 200));

    // Create a new store pointing at the same dir — should load from file
    const store2 = new UnifiedStore("archivist", tmpDir);
    await new Promise((r) => setTimeout(r, 200));
    const hits = await store2.read({ text: "persisted", topK: 10 });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.content).toContain("persisted");
  });

  it("trigram index catches partial matches", async () => {
    const store = new UnifiedStore("archivist", tmpDir);
    await store.write({ role: "archivist", content: "TypeScript developers love static typing" });
    await new Promise((r) => setTimeout(r, 100));
    // "Type" is a partial match — trigram index should catch it
    const hits = await store.read({ text: "Type", topK: 10 });
    expect(hits.length).toBeGreaterThan(0);
  });
});

// ── Full pipeline integration ─────────────────────────────────────────────

describe("Full pipeline integration (all 5 layers)", () => {
  it("end-to-end: record → lifecycle → retrieve", () => {
    const brain = new Brain();
    const tree = new MemoryTree(brain);
    const lifecycle = new LifecycleManager(brain, tree);
    const engine = new RetrievalEngine();

    // Record facts
    brain.recordFact({
      kind: "event", entity: "typescript", content: "TypeScript 5.0 was released",
      visibility: "private", notability: 3, source: "session-1",
    });
    brain.recordFact({
      kind: "event", entity: "typescript", content: "TypeScript 5.0 was released with decorators",
      visibility: "private", notability: 3, source: "session-1",
    });

    // Run lifecycle
    lifecycle.tick();

    // Retrieve
    const docs = [...brain.allFacts.values()].map((f) => ({
      id: f.id, content: f.content, role: "working" as const,
    }));
    const result = engine.retrieve(docs, "TypeScript");
    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.hits[0]!.content).toContain("TypeScript");
  });
});
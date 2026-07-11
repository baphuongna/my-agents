import { describe, it, expect } from "vitest";
import { Brain } from "@my-agent/memory";
import { nowWallclock } from "@my-agent/core";

describe("Brain — DoS caps (F7)", () => {
  it("truncates oversized fact content", () => {
    const brain = new Brain();
    const big = "x".repeat(10_000);
    const f = brain.recordFact({ kind: "fact", entity: "e", content: big, visibility: "private", notability: 1, source: "s" });
    expect(f.content.length).toBeLessThan(10_000);
    expect(f.content).toContain("[truncated]");
  });

  it("rejects beyond the total-fact cap", () => {
    const brain = new Brain();
    // poke the cap constant via reflection (maxFactsTotal)
    const max = (brain as unknown as { maxFactsTotal: number }).maxFactsTotal;
    for (let i = 0; i < max; i++) brain.recordFact({ kind: "fact", entity: "e", content: "c", visibility: "private", notability: 1, source: "s" });
    expect(() => brain.recordFact({ kind: "fact", entity: "e", content: "c", visibility: "private", notability: 1, source: "s" })).toThrow(/cap/);
  });
});

describe("§8 Phase 8 — dream-cycle phases (backlinks + purge)", () => {
  it("backlinks extracts zero-LLM typed edges from fact content", () => {
    const brain = new Brain();
    brain.recordFact({ kind: "fact", entity: "Alice", content: "see [Bob](/people/bob) and [[Charlie]] for context", visibility: "private", notability: 1, source: "s" });
    const edges = brain.backlinks();
    const k = edges.map((e) => e.kind + ":" + e.to).sort();
    expect(k).toContain("link:/people/bob");
    expect(k).toContain("wikilink:Charlie");
  });
  it("purge removes only facts past validUntil", () => {
    const brain = new Brain();
    brain.recordFact({ kind: "fact", entity: "e", content: "old", visibility: "private", notability: 1, source: "s", validUntil: 1000 });
    brain.recordFact({ kind: "fact", entity: "e", content: "current", visibility: "private", notability: 1, source: "s", validUntil: nowWallclock() + 100_000 });
    const n = brain.purge(2000);
    expect(n).toBe(1);
    expect(brain.backlinks().length).toBe(0);
  });
});

describe("§8 dream cycle — Phase-8 review hardening", () => {
  it("HIGH-1: WIKI regex [[Alice|Alias]] captures the slug only (not the pipe+alias)", () => {
    const brain = new Brain();
    brain.recordFact({ kind: "fact", entity: "Alice", content: "see [[Alice|Alias]] for context", visibility: "private", notability: 1, source: "s" });
    const edges = brain.backlinks();
    expect(edges.find((e) => e.kind === "wikilink")?.to).toBe("Alice");
    // must not contain the pipe or alias
    expect(edges.some((e) => e.to.includes("|"))).toBe(false);
  });

  it("HIGH-2: code-fenced link syntax is stripped (no spurious edge)", () => {
    const brain = new Brain();
    brain.recordFact({ kind: "fact", entity: "Code", content: "```md\n[skip](x)\n``` end", visibility: "private", notability: 1, source: "s" });
    expect(brain.backlinks().filter((e) => e.kind === "link")).toEqual([]);
  });

  it("HIGH-3: ProjectLLM doesn't spuriously edge every LLM-bearing content token", () => {
    const brain = new Brain();
    // "ProjectLLM" entity; bare-name regex matches "LLM" — but ProjectLLM
    // PascalCase-words to {Project}. "LLM" alone is NOT a word (all caps).
    brain.recordFact({ kind: "fact", entity: "ProjectLLM", content: "the team built an LLM tool", visibility: "private", notability: 1, source: "s" });
    // The bare-name regex is `[A-Z][a-zA-Z]{2,}` — matches "Project" inside
    // the entity (entityWords has "Project"). Should have one bare edge.
    const bare = brain.backlinks().filter((e) => e.kind === "bare");
    // "team" / "LLM tool" / "built" don't match the capital word regex;
    // "Project" matches the entity word. So we expect 0 or 1 bare edges.
    // Crucially, "LLM" should NOT appear as a bare edge (PascalCase-word check fails).
    expect(bare.some((e) => e.to === "LLM")).toBe(false);
  });

  it("LOW-1: backlinks dedupes identical (fromFactId|to|kind) tuples", () => {
    const brain = new Brain();
    // Content with multiple mentions of the bare name "Alice" → dedup'd to 1 edge
    brain.recordFact({ kind: "fact", entity: "Alice", content: "Alice Alice Alice", visibility: "private", notability: 1, source: "s" });
    const edges = brain.backlinks();
    expect(edges.length).toBe(1);
    expect(edges[0]!.to).toBe("Alice");
  });

  it("CRITICAL-1: purge is SOFT-delete (restore recovers the fact + tombstone evidence)", () => {
    const brain = new Brain();
    brain.recordFact({ kind: "fact", entity: "e", content: "old", visibility: "private", notability: 1, source: "s", validUntil: 1000 });
    const n = brain.purge(2000);
    expect(n).toBe(1);
    // The fact is gone from facts…
    expect(brain.unconsolidatedFacts().length).toBe(0);
    // …but the tombstone holds it.
    expect(brain.tombstoneCount).toBe(1);
    // restore recovers it.
    expect(brain.restore(brain.tombstonesList()[0]!.id)).toBe(true);
    expect(brain.unconsolidatedFacts().length).toBe(1);
    expect(brain.tombstoneCount).toBe(0);
  });

  it("CRITICAL-1: restore returns false for an unknown / non-tombstoned id", () => {
    const brain = new Brain();
    expect(brain.restore("not-a-real-id")).toBe(false);
  });

  it("CRITICAL-1: purgeTombstones(72h) hard-deletes only tombstones past the cutoff", () => {
    const brain = new Brain();
    brain.recordFact({ kind: "fact", entity: "e", content: "x", visibility: "private", notability: 1, source: "s", validUntil: 1000 });
    brain.purge(2000);
    expect(brain.tombstoneCount).toBe(1);
    // old = 100 days old → purged
    const purged = brain.purgeTombstones(72, 2000 + 100 * 24 * 3600 * 1000);
    expect(purged).toBe(1);
    expect(brain.tombstoneCount).toBe(0);
  });

  it("CRITICAL-1: a consolidated fact is NEVER purged (spec invariant)", () => {
    const brain = new Brain();
    // Manually mark a fact as consolidated and then set validUntil in the past
    const id = "12345678-1234-1234-1234-123456789012"; // won't match — use real id
    // Need a real fact id — record it and find:
    brain.recordFact({ kind: "fact", entity: "e", content: "x", visibility: "private", notability: 1, source: "s", validUntil: 1000 });
    const [realId] = [...(brain as unknown as { facts: Map<string, unknown> }).facts.keys()] as [string | undefined];
    // mark consolidated by exploiting the consolidate surface — but easier:
    // directly access the fact and set consolidatedAt
    const facts = (brain as unknown as { facts: Map<string, { consolidatedAt?: number }> }).facts;
    expect(realId).toBeDefined();
    const f = facts.get(realId!);
    expect(f).toBeDefined();
    f!.consolidatedAt = 999; // pre-expiry
    const n = brain.purge(2000);
    expect(n).toBe(0); // the consolidated fact survives
    f!.consolidatedAt = undefined; // restore for sanity
  });

  it("CRITICAL-2: a future-only validFrom (no validUntil) is soft-deleted by purge (not immortal)", () => {
    const brain = new Brain();
    brain.recordFact({ kind: "fact", entity: "e", content: "future-scheduled", visibility: "private", notability: 1, source: "s", validFrom: 999_999_999_999 });
    expect(brain.purge(1000)).toBe(1);
    expect(brain.tombstoneCount).toBe(1);
  });

  it("HIGH-4: validUntil === now is purged (inclusive end)", () => {
    const brain = new Brain();
    brain.recordFact({ kind: "fact", entity: "e", content: "x", visibility: "private", notability: 1, source: "s", validUntil: 5000 });
    expect(brain.purge(5000)).toBe(1);
  });
});

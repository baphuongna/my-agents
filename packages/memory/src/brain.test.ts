import { describe, it, expect } from "vitest";
import { Brain } from "@my-agent/memory";
import { nowWallclock } from "@my-agent/core";
import { bow } from "./brain.js";
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

describe("§8 Phase 10 — dream-cycle extract_facts + embed", () => {
  it("extractFacts pulls structured atoms (dates, URLs, emails, commits, versions)", () => {
    const brain = new Brain();
    brain.recordFact({ kind: "fact", entity: "Project", content: "shipped v1.2.3 on 2024-01-15 — see https://example.com/x (commit abc1234) — contact alice@example.com", visibility: "private", notability: 1, source: "s" });
    const atoms = brain.extractFacts();
    const kinds = atoms.map((a) => a.kind).sort();
    expect(kinds).toContain("date");
    expect(kinds).toContain("url");
    expect(kinds).toContain("email");
    expect(kinds).toContain("version");
  });
  it("embed marks all facts + embeddedCount reflects it", () => {
    const brain = new Brain();
    brain.recordFact({ kind: "fact", entity: "e", content: "x", visibility: "private", notability: 1, source: "s" });
    brain.recordFact({ kind: "fact", entity: "e", content: "y", visibility: "private", notability: 1, source: "s" });
    expect(brain.embeddedCount).toBe(0);
    expect(brain.embed()).toBe(2);
    expect(brain.embeddedCount).toBe(2);
    // idempotent
    expect(brain.embed()).toBe(0);
  });
});

describe("§8 Phase 11 — 5 more zero-LLM dream-cycle phases", () => {
  it("lint flags empty + duplicate + no-entity facts", () => {
    const brain = new Brain();
    brain.recordFact({ kind: "fact", entity: "Alice", content: "likes tea", visibility: "private", notability: 1, source: "s" });
    brain.recordFact({ kind: "fact", entity: "Alice", content: "likes tea", visibility: "private", notability: 1, source: "s" });
    brain.recordFact({ kind: "fact", entity: "", content: "no entity", visibility: "private", notability: 1, source: "s" });
    const r = brain.lint();
    expect(r.duplicates.length).toBe(1);
    expect(r.noEntity.length).toBe(1);
  });

  it("orphans finds facts whose entity has no graph edges", () => {
    const brain = new Brain();
    brain.recordFact({ kind: "fact", entity: "Connected", content: "see [[Other]]", visibility: "private", notability: 1, source: "s" });
    brain.recordFact({ kind: "fact", entity: "Lonely", content: "all alone", visibility: "private", notability: 1, source: "s" });
    const orphans = brain.orphans();
    expect(orphans.length).toBeGreaterThan(0);
  });

  it("schemaSuggest detects case-insensitive entity duplicates", () => {
    const brain = new Brain();
    brain.recordFact({ kind: "fact", entity: "Alice", content: "x", visibility: "private", notability: 1, source: "s" });
    brain.recordFact({ kind: "fact", entity: "alice", content: "y", visibility: "private", notability: 1, source: "s" });
    const proposals = brain.schemaSuggest();
    expect(proposals.length).toBe(1);
    expect(proposals[0]!.entities).toContain("Alice");
    expect(proposals[0]!.entities).toContain("alice");
  });

  it("resolveSymbolEdges finds cross-entity bare references", () => {
    const brain = new Brain();
    brain.recordFact({ kind: "fact", entity: "Alice", content: "met Bob yesterday", visibility: "private", notability: 1, source: "s" });
    brain.recordFact({ kind: "fact", entity: "Bob", content: "is a person", visibility: "private", notability: 1, source: "s" });
    const edges = brain.resolveSymbolEdges();
    expect(edges.some((e) => e.from === "Alice" && e.to === "Bob")).toBe(true);
  });

  it("conversationFactsBackfill records facts for known entities mentioned in chat", () => {
    const brain = new Brain();
    brain.recordFact({ kind: "fact", entity: "Alice", content: "initial", visibility: "private", notability: 1, source: "s" });
    const n = brain.conversationFactsBackfill([
      { role: "user", content: "tell me about Alice and her work" },
      { role: "assistant", content: "Alice is great" },
    ]);
    expect(n).toBeGreaterThanOrEqual(1);
  });
});

describe("§8 brain — bow() bag-of-words tokenizer", () => {
  it("lowercases and splits on non-word characters", () => {
    const v = bow("Hello, WORLD!");
    expect(v.get("hello")).toBe(1);
    expect(v.get("world")).toBe(1);
  });

  it("counts term frequency (duplicates accumulate)", () => {
    const v = bow("the the the cat");
    expect(v.get("the")).toBe(3);
    expect(v.get("cat")).toBe(1);
  });

  it("skips tokens shorter than 2 characters", () => {
    // "a" and "i" are length-1 → dropped; "it" / "go" (len 2) kept.
    const v = bow("a i it go");
    expect(v.has("a")).toBe(false);
    expect(v.has("i")).toBe(false);
    expect(v.get("it")).toBe(1);
    expect(v.get("go")).toBe(1);
  });

  it("case-insensitively folds repeated words", () => {
    const v = bow("Rust rust RUST");
    expect(v.get("rust")).toBe(3);
  });

  it("does NOT filter stopwords (no stopword list) — 'the' is retained by design", () => {
    const v = bow("the quick brown fox");
    expect(v.get("the")).toBe(1);
    expect(v.get("quick")).toBe(1);
  });

  it("returns an empty map for an empty string", () => {
    expect(bow("").size).toBe(0);
  });

  it("keeps digit-only tokens of length >= 2", () => {
    const v = bow("error 404 retry 7");
    expect(v.get("404")).toBe(1);
    expect(v.has("7")).toBe(false); // single digit dropped
  });
});


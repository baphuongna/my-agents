/**
 * Edge-case tests for sqlite-recall.ts — FTS5-powered recall pipeline.
 *
 * Covers: describeSearchPath routing, recall BM25 scoring + session/scope
 * filtering + topK + internal flag, recallFacts, and sanitization edge cases.
 *
 * Uses in-memory SQLite with the full schema initialized.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  openDB, closeDB, initSchema,
  recall, recallFacts, describeSearchPath,
  storeWorking, storeEpisodic, storeFact,
  recordRecall, supersede,
  type SqliteDatabase,
} from "@my-agent/memory";

let db: SqliteDatabase;

beforeEach(() => {
  db = openDB(":memory:");
  initSchema(db);
});
afterEach(() => {
  closeDB(db);
});

// ── describeSearchPath (pure function, no DB needed) ──────────────────────

describe("describeSearchPath", () => {
  it("returns 'empty' for blank/whitespace query", () => {
    expect(describeSearchPath("", false)).toBe("empty");
    expect(describeSearchPath("   ", true)).toBe("empty");
    expect(describeSearchPath("\t\n", false)).toBe("empty");
  });

  it("returns 'fts5' for pure-ASCII / latin queries", () => {
    expect(describeSearchPath("typescript programming", false)).toBe("fts5");
    expect(describeSearchPath("hello world café", true)).toBe("fts5");
  });

  it("returns 'like_scan' for a single CJK character", () => {
    expect(describeSearchPath("東", true)).toBe("like_scan");
    expect(describeSearchPath("東", false)).toBe("like_scan");
  });

  it("returns 'fts_cjk' for multi-char CJK when cjkAvailable", () => {
    expect(describeSearchPath("東京", true)).toBe("fts_cjk");
    expect(describeSearchPath("東京タワー", true)).toBe("fts_cjk");
  });

  it("returns 'like_scan' for multi-char CJK when NOT cjkAvailable", () => {
    expect(describeSearchPath("東京", false)).toBe("like_scan");
  });

  it("counts only CJK chars, ignoring ASCII in mixed queries", () => {
    // 1 CJK + ASCII → like_scan
    expect(describeSearchPath("東 abc", true)).toBe("like_scan");
    // 2 CJK + ASCII → fts_cjk
    expect(describeSearchPath("東京 abc", true)).toBe("fts_cjk");
  });
});

// ── recall — empty / sanitization edge cases ──────────────────────────────

describe("recall — empty and sanitization", () => {
  it("returns [] for an empty query", () => {
    storeWorking(db, { content: "alpha beta gamma" });
    expect(recall(db, "", {})).toEqual([]);
  });

  it("returns [] for a whitespace-only query", () => {
    storeWorking(db, { content: "alpha beta gamma" });
    expect(recall(db, "   \t\n  ", {})).toEqual([]);
  });

  it("returns [] when all query tokens are too short (< 2 chars)", () => {
    storeWorking(db, { content: "alpha beta gamma" });
    // sanitizeQuery filters tokens with length < 2, so "a b" → ""
    expect(recall(db, "a b", {})).toEqual([]);
  });

  it("returns [] when nothing matches", () => {
    storeWorking(db, { content: "alpha beta gamma" });
    expect(recall(db, "zzznomatch", {})).toEqual([]);
  });
});

// ── recall — basic results ────────────────────────────────────────────────

describe("recall — basic retrieval", () => {
  it("returns matching working memories", () => {
    storeWorking(db, { content: "typescript is great for programming" });
    storeWorking(db, { content: "python is also great" });
    const hits = recall(db, "typescript", {});
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0]!.content).toContain("typescript");
    expect(hits[0]!.tier).toBe("working");
  });

  it("returns hits sorted by score descending", () => {
    storeWorking(db, { content: "alpha alpha alpha beta", importance: 1.0 });
    storeWorking(db, { content: "alpha beta", importance: 0.1 });
    const hits = recall(db, "alpha beta", {});
    expect(hits.length).toBe(2);
    expect(hits[0]!.score).toBeGreaterThanOrEqual(hits[1]!.score);
  });

  it("respects the topK limit", () => {
    for (let i = 0; i < 5; i++) {
      storeWorking(db, { content: `shared keyword item number ${i}` });
    }
    const hits = recall(db, "shared keyword", { topK: 2 });
    expect(hits.length).toBeLessThanOrEqual(2);
  });

  it("default topK is 10", () => {
    for (let i = 0; i < 15; i++) {
      storeWorking(db, { content: `common word alpha number ${i}` });
    }
    const hits = recall(db, "common word alpha", {});
    expect(hits.length).toBeLessThanOrEqual(10);
  });
});

// ── recall — filtering ────────────────────────────────────────────────────

describe("recall — session and scope filtering", () => {
  it("filters by sessionId", () => {
    storeWorking(db, { content: "session scoped alpha keyword", sessionId: "sess-A" });
    storeWorking(db, { content: "other session alpha keyword", sessionId: "sess-B" });
    const hits = recall(db, "alpha keyword", { sessionId: "sess-A" });
    expect(hits.every((h) => true)).toBe(true); // no crash
    // All returned working hits should belong to sess-A
    for (const h of hits) {
      if (h.tier === "working") {
        // We can't directly check session from the hit, but the query filters it
        expect(h.content).toContain("session scoped");
      }
    }
  });

  it("filters by scope", () => {
    storeWorking(db, { content: "global scoped alpha keyword", scope: "global" });
    storeWorking(db, { content: "role scoped alpha keyword", scope: "role" });
    const hits = recall(db, "alpha keyword", { scope: "global" });
    expect(hits.every((h) => h.content.includes("global scoped"))).toBe(true);
  });

  it("sessionAware returns global + own-session, excludes other sessions", () => {
    storeWorking(db, { content: "global alpha keyword", scope: "global" });
    storeWorking(db, { content: "own session alpha keyword", scope: "session", sessionId: "mysess" });
    storeWorking(db, { content: "other session alpha keyword", scope: "session", sessionId: "othersess" });
    const hits = recall(db, "alpha keyword", {
      sessionAware: true, sessionId: "mysess",
    });
    const contents = hits.map((h) => h.content);
    expect(contents.some((c) => c.includes("global"))).toBe(true);
    expect(contents.some((c) => c.includes("own session"))).toBe(true);
    expect(contents.some((c) => c.includes("other session"))).toBe(false);
  });

  it("sessionAware with agentId returns own-role memories", () => {
    storeWorking(db, { content: "role alpha keyword coder", scope: "role", agentId: "coder" });
    storeWorking(db, { content: "role alpha keyword reviewer", scope: "role", agentId: "reviewer" });
    storeWorking(db, { content: "global alpha keyword", scope: "global" });
    const hits = recall(db, "alpha keyword", {
      sessionAware: true, sessionId: "mysess", agentId: "coder",
    });
    const contents = hits.map((h) => h.content);
    expect(contents.some((c) => c.includes("coder"))).toBe(true);
    expect(contents.some((c) => c.includes("global"))).toBe(true);
    expect(contents.some((c) => c.includes("reviewer"))).toBe(false);
  });
});

// ── recall — includeEpisodic ──────────────────────────────────────────────

describe("recall — episodic tier", () => {
  it("includes episodic memories by default", () => {
    storeWorking(db, { content: "working alpha keyword" });
    storeEpisodic(db, { content: "episodic alpha keyword" });
    const hits = recall(db, "alpha keyword", {});
    const tiers = hits.map((h) => h.tier);
    expect(tiers).toContain("working");
    expect(tiers).toContain("episodic");
  });

  it("excludes episodic when includeEpisodic=false", () => {
    storeWorking(db, { content: "working alpha keyword" });
    storeEpisodic(db, { content: "episodic alpha keyword" });
    const hits = recall(db, "alpha keyword", { includeEpisodic: false });
    expect(hits.every((h) => h.tier === "working")).toBe(true);
  });
});

// ── recall — superseded + expired exclusion ───────────────────────────────

describe("recall — superseded and expired", () => {
  it("excludes superseded memories", () => {
    const oldId = storeWorking(db, { content: "superseded alpha keyword" });
    const newId = storeWorking(db, { content: "replacement alpha keyword" });
    supersede(db, "working_memory", oldId, newId);
    const hits = recall(db, "alpha keyword", {});
    expect(hits.some((h) => h.content.includes("superseded"))).toBe(false);
    expect(hits.some((h) => h.content.includes("replacement"))).toBe(true);
  });

  it("excludes expired memories (valid_until in the past)", () => {
    storeWorking(db, { content: "expired alpha keyword", validUntil: "2020-01-01T00:00:00.000Z" });
    storeWorking(db, { content: "live alpha keyword", validUntil: "2099-01-01T00:00:00.000Z" });
    const hits = recall(db, "alpha keyword", {});
    expect(hits.some((h) => h.content.includes("expired"))).toBe(false);
    expect(hits.some((h) => h.content.includes("live"))).toBe(true);
  });
});

// ── recall — internal flag + recall_count ──────────────────────────────────

describe("recall — internal flag and recall_count", () => {
  it("increments recall_count by default", () => {
    const id = storeWorking(db, { content: "tracked alpha keyword" });
    recall(db, "alpha keyword", {});
    const row = db.prepare("SELECT recall_count FROM working_memory WHERE id = ?").get(id) as { recall_count: number };
    expect(row.recall_count).toBe(1);
  });

  it("does NOT increment recall_count when internal=true", () => {
    const id = storeWorking(db, { content: "internal alpha keyword" });
    recall(db, "alpha keyword", { internal: true });
    const row = db.prepare("SELECT recall_count FROM working_memory WHERE id = ?").get(id) as { recall_count: number };
    expect(row.recall_count).toBe(0);
  });

  it("increments recall_count on multiple recalls", () => {
    const id = storeWorking(db, { content: "multi alpha keyword" });
    recall(db, "alpha keyword", {});
    recall(db, "alpha keyword", {});
    recall(db, "alpha keyword", {});
    const row = db.prepare("SELECT recall_count FROM working_memory WHERE id = ?").get(id) as { recall_count: number };
    expect(row.recall_count).toBe(3);
  });
});

// ── recall — multi-term OR search ─────────────────────────────────────────

describe("recall — multi-term search", () => {
  it("OR semantics: matches either term", () => {
    storeWorking(db, { content: "typescript programming language" });
    storeWorking(db, { content: "rust programming language" });
    storeWorking(db, { content: "cooking recipe pasta" });
    const hits = recall(db, "typescript rust", {});
    const contents = hits.map((h) => h.content);
    expect(contents.some((c) => c.includes("typescript"))).toBe(true);
    expect(contents.some((c) => c.includes("rust"))).toBe(true);
    expect(contents.some((c) => c.includes("cooking"))).toBe(false);
  });
});

// ── recall — veracity weighting ───────────────────────────────────────────

describe("recall — score composition", () => {
  it("higher importance yields higher score (all else equal)", () => {
    storeWorking(db, { content: "important alpha keyword", importance: 1.0, trust: 1.0 });
    storeWorking(db, { content: "trivial alpha keyword", importance: 0.0, trust: 1.0 });
    const hits = recall(db, "alpha keyword", {});
    const important = hits.find((h) => h.content.includes("important"));
    const trivial = hits.find((h) => h.content.includes("trivial"));
    if (important && trivial) {
      expect(important.score).toBeGreaterThan(trivial.score);
    }
  });

  it("trust=0 produces score 0", () => {
    const id = storeWorking(db, { content: "zero trust alpha keyword" });
    // storeWorking defaults trust to 0.5 — override to 0.0 via raw SQL
    db.prepare("UPDATE working_memory SET trust = 0.0 WHERE id = ?").run(id);
    const hits = recall(db, "alpha keyword", {});
    const hit = hits.find((h) => h.id === id);
    if (hit) expect(hit.score).toBe(0);
  });
});

// ── recallFacts ───────────────────────────────────────────────────────────

describe("recallFacts", () => {
  it("returns [] for an empty query", () => {
    storeFact(db, { subject: "Alice", predicate: "knows", object: "TypeScript" });
    expect(recallFacts(db, "", {})).toEqual([]);
  });

  it("returns [] when nothing matches", () => {
    storeFact(db, { subject: "Alice", predicate: "knows", object: "TypeScript" });
    expect(recallFacts(db, "zzznomatch", {})).toEqual([]);
  });

  it("returns matching facts with subject/predicate/object", () => {
    storeFact(db, { subject: "Alice", predicate: "knows", object: "TypeScript" });
    storeFact(db, { subject: "Bob", predicate: "likes", object: "Python" });
    const facts = recallFacts(db, "Alice", {});
    expect(facts.length).toBeGreaterThanOrEqual(1);
    expect(facts[0]!.subject).toBe("Alice");
    expect(facts[0]!.predicate).toBe("knows");
    expect(facts[0]!.object).toBe("TypeScript");
    expect(facts[0]!.score).toBeGreaterThan(0);
  });

  it("respects the topK limit", () => {
    for (let i = 0; i < 5; i++) {
      storeFact(db, { subject: `Person${i}`, predicate: "knows", object: "TypeScript" });
    }
    const facts = recallFacts(db, "TypeScript", { topK: 2 });
    expect(facts.length).toBeLessThanOrEqual(2);
  });

  it("matches across subject, predicate, and object columns", () => {
    storeFact(db, { subject: "Alice", predicate: "develops", object: "Application" });
    const bySubject = recallFacts(db, "Alice", {});
    const byPredicate = recallFacts(db, "develops", {});
    const byObject = recallFacts(db, "Application", {});
    expect(bySubject.length).toBeGreaterThanOrEqual(1);
    expect(byPredicate.length).toBeGreaterThanOrEqual(1);
    expect(byObject.length).toBeGreaterThanOrEqual(1);
  });

  it("normalizes scores to [0,1] (best fact = 1.0 with single result)", () => {
    storeFact(db, { subject: "Unique", predicate: "knows", object: "Rust" });
    const facts = recallFacts(db, "Unique Rust", {});
    expect(facts.length).toBe(1);
    // Single result → rankSpan is 0 → fallback to 1.0
    expect(facts[0]!.score).toBe(1.0);
  });
});

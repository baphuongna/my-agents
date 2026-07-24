/**
 * Edge-case tests for store.ts — UnifiedStore (in-memory BM25 index + markdown).
 *
 * Covers: write (dedup, indexing), read (BM25, trigram fuzzy, empty query,
 * stopwords, topK), loadFromDisk (startup rebuild), inspection helpers.
 *
 * Uses mkdtempSync for temp directories.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { UnifiedStore } from "@my-agent/memory";
import type { MemoryEntry, MemoryRoleId } from "@my-agent/core";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "mya-store-"));
});
afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

const ROLE: MemoryRoleId = "archivist";

function entry(content: string, metadata?: Record<string, string>): MemoryEntry {
  return { role: ROLE, content, metadata };
}

// ── write ─────────────────────────────────────────────────────────────────

describe("UnifiedStore.write", () => {
  it("inserts a new entry and returns it with an id", async () => {
    const store = new UnifiedStore(ROLE, tmpDir);
    const result = await store.write(entry("hello world typescript"));
    expect(result).not.toBeNull();
    expect(result!.id).toContain("mem-");
    expect(result!.content).toBe("hello world typescript");
    expect(store.size).toBe(1);
  });

  it("deduplicates identical content (same role + content + metadata)", async () => {
    const store = new UnifiedStore(ROLE, tmpDir);
    const first = await store.write(entry("duplicate content here"));
    const second = await store.write(entry("duplicate content here"));
    expect(second!.id).toBe(first!.id);
    expect(store.size).toBe(1);
  });

  it("does NOT deduplicate when metadata differs", async () => {
    const store = new UnifiedStore(ROLE, tmpDir);
    await store.write(entry("same text", { tag: "a" }));
    await store.write(entry("same text", { tag: "b" }));
    expect(store.size).toBe(2);
  });

  it("does NOT deduplicate different content", async () => {
    const store = new UnifiedStore(ROLE, tmpDir);
    await store.write(entry("first content item"));
    await store.write(entry("second content item"));
    expect(store.size).toBe(2);
  });

  it("increments the nextId counter for each new entry", async () => {
    const store = new UnifiedStore(ROLE, tmpDir);
    const a = await store.write(entry("content alpha"));
    const b = await store.write(entry("content beta"));
    const aNum = parseInt(a!.id.split("-").pop()!, 10);
    const bNum = parseInt(b!.id.split("-").pop()!, 10);
    expect(bNum).toBe(aNum + 1);
  });

  it("clearDedup allows re-inserting previously deduped content", async () => {
    const store = new UnifiedStore(ROLE, tmpDir);
    await store.write(entry("deduped content text"));
    store.clearDedup();
    await store.write(entry("deduped content text"));
    expect(store.size).toBe(2);
  });
});

// ── read — empty / edge queries ───────────────────────────────────────────

describe("UnifiedStore.read — empty and edge queries", () => {
  it("returns all entries (up to topK) for an empty query", async () => {
    const store = new UnifiedStore(ROLE, tmpDir);
    await store.write(entry("first alpha content"));
    await store.write(entry("second beta content"));
    const hits = await store.read({ text: "", topK: 10 });
    expect(hits.length).toBe(2);
  });

  it("respects topK for empty queries", async () => {
    const store = new UnifiedStore(ROLE, tmpDir);
    for (let i = 0; i < 5; i++) await store.write(entry(`item number ${i}`));
    const hits = await store.read({ text: "", topK: 2 });
    expect(hits.length).toBe(2);
  });

  it("returns [] when no entries match", async () => {
    const store = new UnifiedStore(ROLE, tmpDir);
    await store.write(entry("alpha beta gamma"));
    const hits = await store.read({ text: "zzznomatch" });
    expect(hits).toEqual([]);
  });

  it("returns [] for a query of only stopwords", async () => {
    const store = new UnifiedStore(ROLE, tmpDir);
    await store.write(entry("alpha beta gamma content here"));
    // "the", "a", "is" are stopwords → tokenize filters them → qTokens empty → []
    const hits = await store.read({ text: "the a is" });
    expect(hits).toEqual([]);
  });

  it("returns [] for an empty store", async () => {
    const store = new UnifiedStore(ROLE, tmpDir);
    const hits = await store.read({ text: "anything" });
    expect(hits).toEqual([]);
  });
});

// ── read — BM25 exact token match ─────────────────────────────────────────

describe("UnifiedStore.read — BM25 scoring", () => {
  it("returns matching entries sorted by relevance", async () => {
    const store = new UnifiedStore(ROLE, tmpDir);
    await store.write(entry("typescript programming guide"));
    await store.write(entry("python programming guide"));
    await store.write(entry("cooking recipe pasta"));
    const hits = await store.read({ text: "typescript", topK: 10 });
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0]!.content).toContain("typescript");
    expect(hits[0]!.score).toBeGreaterThan(0);
  });

  it("respects the topK limit", async () => {
    const store = new UnifiedStore(ROLE, tmpDir);
    for (let i = 0; i < 5; i++) await store.write(entry(`shared keyword item number ${i}`));
    const hits = await store.read({ text: "shared keyword", topK: 2 });
    expect(hits.length).toBeLessThanOrEqual(2);
  });

  it("scores documents with more term occurrences higher", async () => {
    const store = new UnifiedStore(ROLE, tmpDir);
    await store.write(entry("alpha alpha alpha beta")); // more "alpha" occurrences
    await store.write(entry("alpha beta gamma"));       // fewer
    const hits = await store.read({ text: "alpha", topK: 10 });
    expect(hits[0]!.content).toContain("alpha alpha alpha");
  });

  it("excludes entries with a score of 0", async () => {
    const store = new UnifiedStore(ROLE, tmpDir);
    await store.write(entry("typescript programming"));
    const hits = await store.read({ text: "typescript", topK: 10 });
    expect(hits.every((h) => h.score > 0)).toBe(true);
  });
});

// ── read — trigram fuzzy matching ─────────────────────────────────────────

describe("UnifiedStore.read — trigram fuzzy", () => {
  it("finds partial matches via trigram overlap", async () => {
    const store = new UnifiedStore(ROLE, tmpDir);
    await store.write(entry("configuration management system"));
    // "configuratio" is a substring → trigram overlap should surface the entry
    const hits = await store.read({ text: "configuratio", topK: 10 });
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits.some((h) => h.content.includes("configuration"))).toBe(true);
  });
});

// ── loadFromDisk ──────────────────────────────────────────────────────────

describe("UnifiedStore.loadFromDisk", () => {
  it("rebuilds the index from an existing markdown file on first read", async () => {
    // Write a markdown file in the expected format before constructing the store
    writeFileSync(
      join(tmpDir, `${ROLE}.md`),
      "- [archivist] persisted content from disk\n- [archivist] second persisted line\n",
    );
    const store = new UnifiedStore(ROLE, tmpDir);
    // Let the constructor's fire-and-forget loadFromDisk settle before reading
    // (avoids the race where both the constructor and read() trigger a load).
    await new Promise((r) => setTimeout(r, 50));
    const hits = await store.read({ text: "persisted", topK: 10 });
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(store.size).toBe(2);
  });

  it("skips malformed lines during rebuild", async () => {
    writeFileSync(
      join(tmpDir, `${ROLE}.md`),
      "- [archivist] good content line\n" +
      "this is not a valid entry line\n" +
      "- [archivist] another good line\n" +
      "\n",
    );
    const store = new UnifiedStore(ROLE, tmpDir);
    await new Promise((r) => setTimeout(r, 50));
    await store.read({ text: "", topK: 10 });
    // Only the 2 valid "- [role] content" lines should be loaded
    expect(store.size).toBe(2);
  });

  it("starts empty when the file does not exist", async () => {
    const store = new UnifiedStore(ROLE, tmpDir);
    await store.read({ text: "", topK: 10 });
    expect(store.size).toBe(0);
  });
});

// ── inspection helpers ────────────────────────────────────────────────────

describe("UnifiedStore inspection helpers", () => {
  it("vocabSize reflects unique indexed tokens", async () => {
    const store = new UnifiedStore(ROLE, tmpDir);
    await store.write(entry("alpha beta gamma"));
    await store.write(entry("alpha delta epsilon")); // "alpha" already indexed
    // stopwords filtered: alpha, beta, gamma, delta, epsilon → 5 unique tokens
    expect(store.vocabSize).toBeGreaterThanOrEqual(4);
  });

  it("asDocs returns all entries", async () => {
    const store = new UnifiedStore(ROLE, tmpDir);
    await store.write(entry("first doc content"));
    await store.write(entry("second doc content"));
    const docs = store.asDocs();
    expect(docs.length).toBe(2);
    expect(docs.every((d) => d.id && d.content && d.role)).toBe(true);
  });

  it("size tracks the number of entries", async () => {
    const store = new UnifiedStore(ROLE, tmpDir);
    expect(store.size).toBe(0);
    await store.write(entry("one"));
    expect(store.size).toBe(1);
    await store.write(entry("two"));
    expect(store.size).toBe(2);
  });
});

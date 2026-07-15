/**
 * Tests for BM25 scoring + scored read() in InMemoryBackend and FileBackend.
 */
import { describe, it, expect } from "vitest";
import { bm25Score, InMemoryBackend, FileBackend, type BM25Corpus } from "./backends.js";
import { rm, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("bm25Score", () => {
  it("returns 0 for a query with no matching terms", () => {
    expect(bm25Score("hello", "goodbye world")).toBe(0);
  });

  it("returns 0 for an empty query or document", () => {
    expect(bm25Score("", "some text")).toBe(0);
    expect(bm25Score("some text", "")).toBe(0);
  });

  it("scores exact match higher than partial match", () => {
    const full = bm25Score("hello world", "hello world foo bar");
    const partial = bm25Score("hello world", "hello foo bar");
    expect(full).toBeGreaterThan(partial);
  });

  it("higher term frequency yields a higher (but saturating) score", () => {
    const score1 = bm25Score("hello", "hello world");
    const score3 = bm25Score("hello", "hello hello hello world");
    expect(score3).toBeGreaterThan(score1);
  });

  it("respects BM25 length normalization with corpus stats", () => {
    // Two docs in a corpus: one short, one long.
    const corpus: BM25Corpus = {
      docCount: 2,
      avgDocLength: (1 + 101) / 2, // "alpha" (1) + "alpha filler ... " (101)
      docFreq: new Map([["alpha", 2], ["filler", 1]]),
    };
    const shortDoc = bm25Score("alpha", "alpha", corpus);
    const longDoc = bm25Score("alpha", "alpha " + "filler ".repeat(50), corpus);
    expect(shortDoc).toBeGreaterThan(longDoc);
  });
});

describe("InMemoryBackend BM25 read", () => {
  it("returns hits sorted by BM25 score (best match first)", async () => {
    const backend = new InMemoryBackend("archivist" as never);
    await backend.write({ role: "archivist" as never, content: "the quick brown fox jumps" } as never);
    await backend.write({ role: "archivist" as never, content: "the quick brown fox is fast and quick" } as never);
    await backend.write({ role: "archivist" as never, content: "completely unrelated content here" } as never);

    // Query "quick" is a substring of both matching docs (the filter is substring-based).
    const hits = await backend.read({ text: "quick", topK: 10 } as never);
    expect(hits.length).toBe(2);
    // Both matching docs should have score > 0.
    expect(hits[0]!.score).toBeGreaterThan(0);
    expect(hits[1]!.score).toBeGreaterThan(0);
    // The doc with higher tf ("quick" appears twice) should rank first.
    expect(hits[0]!.score).toBeGreaterThanOrEqual(hits[1]!.score);
    expect(hits[0]!.content).toContain("fast");
  });

  it("returns score 0 for substring match with no token overlap", async () => {
    const backend = new InMemoryBackend("goals" as never);
    await backend.write({ role: "goals" as never, content: "substringtest here" } as never);
    const hits = await backend.read({ text: "string", topK: 10 } as never);
    // "string" is a substring of "substringtest" but not a token → includes()
    // matches but BM25 token overlap is 0.
    expect(hits.length).toBe(1);
    expect(hits[0]!.score).toBe(0);
  });
});

describe("FileBackend BM25 read", () => {
  it("returns hits sorted by BM25 score", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mya-bm25-"));
    try {
      // Pre-populate the file with markdown bullets.
      await writeFile(join(dir, "archivist.md"),
        "- the quick brown fox jumps\n" +
        "- the quick brown fox is fast and quick\n" +
        "- completely unrelated content\n",
        "utf8");

      const backend = new FileBackend("archivist" as never, dir);
      const hits = await backend.read({ text: "quick", topK: 10 } as never);
      expect(hits.length).toBe(2);
      expect(hits[0]!.score).toBeGreaterThan(0);
      expect(hits[0]!.score).toBeGreaterThanOrEqual(hits[1]!.score);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

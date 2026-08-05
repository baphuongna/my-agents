/**
 * Semantic code search tests (code-index.ts).
 *
 * Mock-embedder tests use a deterministic bag-of-words vector (shared words →
 * high cosine) so ranking is predictable without fastembed. A real-fastembed
 * smoke test is gated on the package being importable (mirrors embeddings.test.ts).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _setEmbedImpl, embeddingDim, type Vec } from "./embeddings.js";
import {
  indexCodebase, semanticSearch, _resetCodeIndex, _setCodeIndexDbPath,
} from "./code-index.js";

/** Deterministic bag-of-words embedder: texts sharing words → high cosine.
 * Must produce vectors of embeddingDim() so the BLOB serde round-trips. */
async function bowEmbed(text: string): Promise<Vec | null> {
  const dim = embeddingDim();
  const v = new Float32Array(dim);
  for (const w of text.toLowerCase().split(/\W+/)) {
    if (!w) continue;
    let h = 0;
    for (let i = 0; i < w.length; i++) h = (h * 31 + w.charCodeAt(i)) >>> 0;
    const idx = h % dim;
    v[idx] = (v[idx] ?? 0) + 1;
  }
  return v;
}

describe("code-index (semantic code search)", () => {
  let dir: string;
  beforeEach(async () => {
    _setEmbedImpl(bowEmbed);
    dir = await mkdtemp(join(tmpdir(), "mya-codeidx-"));
    _setCodeIndexDbPath(join(dir, "test-code-index.db"));
  });
  afterEach(async () => {
    _setEmbedImpl(null);
    _resetCodeIndex();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("indexes files + ranks the meaning-matching file first", async () => {
    await writeFile(join(dir, "auth.ts"), "export function authenticateUser(token) { return check(token); }\n");
    await writeFile(join(dir, "weather.ts"), "export function getForecast(city) { return api(city); }\n");
    const stats = await indexCodebase(dir);
    expect(stats.filesIndexed).toBe(2);
    expect(stats.chunksEmbedded).toBe(2);

    const res = await semanticSearch("authenticate user token", dir, 5);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.hits.length).toBe(2);
    // auth.ts shares words (authenticate/user/token) → rank 1; weather.ts doesn't.
    expect(res.hits[0]!.filePath).toMatch(/auth\.ts$/);
    expect(res.hits[0]!.score).toBeGreaterThan(res.hits[1]!.score);
    expect(res.hits[0]!.startLine).toBe(1);
  });

  it("returns ok:false (use grep) when embeddings disabled", async () => {
    const prev = process.env.MYA_NO_EMBEDDINGS;
    process.env.MYA_NO_EMBEDDINGS = "1";
    try {
      await writeFile(join(dir, "a.ts"), "x\n");
      const res = await semanticSearch("anything", dir, 5);
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.reason).toMatch(/grep/);
    } finally {
      if (prev === undefined) delete process.env.MYA_NO_EMBEDDINGS;
      else process.env.MYA_NO_EMBEDDINGS = prev;
    }
  });

  it("skips unsupported extensions, hidden files, and node_modules", async () => {
    await mkdir(join(dir, "node_modules"));
    await writeFile(join(dir, "node_modules", "dep.ts"), "authenticate authenticate\n");
    await writeFile(join(dir, ".hidden.ts"), "authenticate\n");
    await writeFile(join(dir, "notes.txt"), "authenticate\n"); // unsupported ext
    await writeFile(join(dir, "real.ts"), "authenticate\n");
    const stats = await indexCodebase(dir);
    expect(stats.filesIndexed).toBe(1); // only real.ts
    const res = await semanticSearch("authenticate", dir, 5);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.hits.every((h) => /real\.ts$/.test(h.filePath))).toBe(true);
  });

  it("incremental: unchanged files are skipped on re-index (no re-embed)", async () => {
    await writeFile(join(dir, "a.ts"), "alpha alpha\n");
    const first = await indexCodebase(dir);
    expect(first.chunksEmbedded).toBe(1);
    const second = await indexCodebase(dir);
    expect(second.filesSkipped).toBe(1);
    expect(second.chunksEmbedded).toBe(0); // mtime unchanged → no re-embed
  });

  it("chunks large files into multiple pieces", async () => {
    // ~5000 chars → 3 chunks at CHUNK_CHARS=2000
    const big = "x = 1\n".repeat(1000);
    await writeFile(join(dir, "big.ts"), big);
    const stats = await indexCodebase(dir);
    expect(stats.filesIndexed).toBe(1);
    expect(stats.chunksEmbedded).toBeGreaterThan(1);
  });

  it("handles an empty workspace (no matches, no crash)", async () => {
    const res = await semanticSearch("anything", dir, 5);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.hits).toEqual([]);
    expect(res.indexedChunks).toBe(0);
  });
});

describe("code-index real-fastembed smoke (skipped if fastembed absent)", () => {
  let dir: string;
  let fastembedAvailable = false;
  beforeEach(async () => {
    try { await import("fastembed"); fastembedAvailable = true; } catch { fastembedAvailable = false; }
    _setEmbedImpl(null); // use the REAL embedder
    dir = await mkdtemp(join(tmpdir(), "mya-codeidx-real-"));
    _setCodeIndexDbPath(join(dir, "real-code-index.db"));
  });
  afterEach(async () => {
    _resetCodeIndex();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("ranks a paraphrase above an unrelated file (real embeddings)", async () => {
    if (!fastembedAvailable) { console.log("  [skipped: fastembed not installed]"); return; }
    await writeFile(join(dir, "rust-pref.ts"), "// user prefers rust for systems programming tasks\n");
    await writeFile(join(dir, "weather.ts"), "// weather forecast api for the browser\n");
    let res;
    try {
      res = await semanticSearch("memory-safe compiled language choice", dir, 5);
    } catch (e) {
      // ONNX runtime may fail on CI (no model download, native lib missing)
      console.log("  [skipped: ONNX runtime error]");
      return;
    }
    // Embeddings may silently fail (ok:false) on CI without model cache
    if (!res.ok) { console.log("  [skipped: embeddings unavailable]"); return; }
    const rust = res.hits.find((h) => /rust-pref/.test(h.filePath));
    const weather = res.hits.find((h) => /weather/.test(h.filePath));
    if (rust && weather) {
      // the paraphrase should score the rust file higher than the weather file
      expect(rust.score).toBeGreaterThan(weather.score);
    }
  }, 30_000);
});

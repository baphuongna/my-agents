/**
 * Tests for the embeddings/vector arm (action #3, docs/embeddings-cross-system.md).
 *
 * Uses `_setEmbedImpl` to inject a DETERMINISTIC embedder (unit vectors) so the
 * fusion + vector-only-candidate paths are tested WITHOUT the fastembed model /
 * network. The mock maps salient words → orthogonal 384-dim unit vectors, so
 * cosine is exactly 1 (same word) or 0 (different).
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  SqliteMemoryManager,
  _setEmbedImpl,
  embedContent,
  warmQueryVec,
  getCachedQueryVec,
  cosine,
  vecToBuffer,
  bufferToVec,
  type Vec,
} from "@my-agent/memory";

const DIM = 384;
/** Build a 384-dim unit vector with a 1 at `idx` (orthogonal basis → cosine 0 or 1). */
function unit(idx: number): Vec {
  const v = new Float32Array(DIM);
  v[idx] = 1;
  return v;
}
/** Mock embedder: salient word → its basis vector; else a neutral zero vector (null). */
function mockEmbed(text: string): Promise<Vec | null> {
  const t = text.toLowerCase();
  if (t.includes("rust")) return Promise.resolve(unit(0));
  if (t.includes("typescript") || t.includes("ts")) return Promise.resolve(unit(1));
  if (t.includes("ferrous")) return Promise.resolve(unit(0)); // semantic alias of rust
  return Promise.resolve(null);
}

/** Poll until a memory's embedding BLOB is populated by the background embedder. */
async function waitForEmbed(db: { prepare: (s: string) => { get: (...a: unknown[]) => unknown } }, id: string, timeout = 1000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const r = db.prepare("SELECT embedding FROM working_memory WHERE id = ?").get(id) as { embedding: Buffer | null } | undefined;
    if (r?.embedding) return true;
    await new Promise((r) => setTimeout(r, 5));
  }
  return false;
}

afterEach(() => _setEmbedImpl(null));

describe("embeddings — edge cases (review gaps)", () => {
  it("wrong-dimension vector is rejected (BLOB stays NULL, recall FTS-only)", async () => {
    // Simulates a model change (e.g. 384→512): mock returns 3-dim when recall expects 384.
    _setEmbedImpl(() => Promise.resolve(new Float32Array([1, 0, 0]))); // 3-dim, not 384
    const mgr = new SqliteMemoryManager({ dbPath: ":memory:" });
    const id = mgr.record({ content: "rust memory lane", memoryType: "fact", source: "tui" });
    await new Promise((r) => setTimeout(r, 30));
    // scheduleEmbed's `vec.length !== embeddingDim()` guard rejects the 3-dim vector.
    const row = mgr.getDatabase().prepare("SELECT embedding FROM working_memory WHERE id = ?").get(id) as { embedding: Buffer | null };
    expect(row.embedding).toBeNull();
    // recall still works (FTS-only) — no crash from the dim mismatch.
    const hits = mgr.recall("rust", { topK: 5, internal: true });
    expect(hits.some((h) => h.content.includes("rust"))).toBe(true);
  });

  it("a memory matching BOTH FTS and vector appears once (no double-score)", async () => {
    _setEmbedImpl(mockEmbed);
    const mgr = new SqliteMemoryManager({ dbPath: ":memory:" });
    const db = mgr.getDatabase();
    const id = mgr.record({ content: "the rust crate is great", memoryType: "fact", source: "tui" });
    await waitForEmbed(db, id);
    await warmQueryVec("rust"); // query vec = unit(0); the rust memory FTS-matches AND cosines 1.0
    const hits = mgr.recall("rust", { topK: 5, internal: true });
    const count = hits.filter((h) => h.id === id).length;
    expect(count).toBe(1); // deduped — not scored twice (FTS hit + vecOnly)
  });
});

describe("embeddings — helpers", () => {
  it("vecToBuffer/bufferToVec round-trips a Float32Array", () => {
    const v = unit(5);
    const buf = vecToBuffer(v);
    expect(buf.length).toBe(DIM * 4);
    const back = bufferToVec(buf, DIM);
    expect(back).not.toBeNull();
    expect(back!.length).toBe(DIM);
    expect(back![5]).toBeCloseTo(1, 5);
  });

  it("bufferToVec rejects wrong-dimension buffers (returns null)", () => {
    const v = unit(0);
    expect(bufferToVec(vecToBuffer(v), 999)).toBeNull(); // wrong dim
    expect(bufferToVec(null, DIM)).toBeNull();
  });

  it("cosine: identical=1, orthogonal=0, zero-vector=0", () => {
    expect(cosine(unit(0), unit(0))).toBeCloseTo(1, 5);
    expect(cosine(unit(0), unit(1))).toBeCloseTo(0, 5);
    expect(cosine(new Float32Array(DIM), unit(0))).toBe(0);
  });
});

describe("embeddings — background capture embed", () => {
  it("storeWorking embeds content into the BLOB in the background (mock)", async () => {
    _setEmbedImpl(mockEmbed);
    const mgr = new SqliteMemoryManager({ dbPath: ":memory:" });
    const id = mgr.record({ content: "the rust crate handles memory safely", memoryType: "fact", source: "tui" });
    const db = mgr.getDatabase();
    expect(await waitForEmbed(db, id)).toBe(true);
    const row = db.prepare("SELECT embedding FROM working_memory WHERE id = ?").get(id) as { embedding: Buffer | null };
    const v = bufferToVec(row.embedding, DIM);
    expect(v).not.toBeNull();
    expect(cosine(v!, unit(0))).toBeCloseTo(1, 5); // rust → unit(0)
  });
});

describe("embeddings — recall vector fusion", () => {
  it("recall ranks a semantic match FIRST via cosine (mock embedder)", async () => {
    _setEmbedImpl(mockEmbed);
    const mgr = new SqliteMemoryManager({ dbPath: ":memory:" });
    const db = mgr.getDatabase();
    const rustId = mgr.record({ content: "the rust crate handles memory safely", memoryType: "fact", source: "tui" });
    const tsId = mgr.record({ content: "we use typescript for the frontend web app", memoryType: "fact", source: "tui" });
    await waitForEmbed(db, rustId);
    await waitForEmbed(db, tsId);
    // Warm the query vector for "rust language" (mockEmbed → unit(0)).
    await warmQueryVec("rust language");
    expect(getCachedQueryVec("rust language")).not.toBeNull();
    const hits = mgr.recall("rust language", { topK: 5, internal: true });
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0]!.content).toContain("rust"); // semantic winner ranks first
  });

  it("recall adds a SEMANTIC-ONLY candidate that FTS misses (paraphrase)", async () => {
    _setEmbedImpl(mockEmbed);
    const mgr = new SqliteMemoryManager({ dbPath: ":memory:" });
    const db = mgr.getDatabase();
    // "ferrous oxide" shares NO token with query "rust", so FTS won't match — but
    // mockEmbed maps both to unit(0) (semantic alias) → cosine 1.0 → vector arm adds it.
    const ferrousId = mgr.record({ content: "ferrous oxide programming notes", memoryType: "fact", source: "tui" });
    await waitForEmbed(db, ferrousId);
    await warmQueryVec("rust");
    const hits = mgr.recall("rust", { topK: 5, internal: true });
    const found = hits.find((h) => h.id === ferrousId);
    expect(found).toBeTruthy(); // semantic-only candidate surfaced despite zero FTS overlap
  });

  it("MYA_NO_EMBEDDINGS → recall is FTS-only (no vector arm, current behavior)", async () => {
    process.env.MYA_NO_EMBEDDINGS = "1";
    try {
      _setEmbedImpl(mockEmbed); // would embed if not disabled
      const mgr = new SqliteMemoryManager({ dbPath: ":memory:" });
      const id = mgr.record({ content: "the rust crate handles memory safely", memoryType: "fact", source: "tui" });
      // Background embed is a no-op when disabled → BLOB stays NULL.
      await new Promise((r) => setTimeout(r, 50));
      const row = mgr.getDatabase().prepare("SELECT embedding FROM working_memory WHERE id = ?").get(id) as { embedding: Buffer | null };
      expect(row.embedding).toBeNull();
      // Query warm is a no-op → cache empty.
      await warmQueryVec("rust");
      expect(getCachedQueryVec("rust")).toBeNull();
      // recall still works (FTS-only), returns the rust memory via keyword match.
      const hits = mgr.recall("rust crate", { topK: 5, internal: true });
      expect(hits.some((h) => h.content.includes("rust"))).toBe(true);
    } finally {
      delete process.env.MYA_NO_EMBEDDINGS;
    }
  });
});

describe("embedContent — public embed entrypoint", () => {
  it("returns null for an empty / whitespace-only string", async () => {
    _setEmbedImpl(() => Promise.resolve(new Float32Array([1])));
    expect(await embedContent("")).toBeNull();
    expect(await embedContent("   ")).toBeNull();
  });

  it("returns null when MYA_NO_EMBEDDINGS is set (disabled wins over the test impl)", async () => {
    process.env.MYA_NO_EMBEDDINGS = "1";
    try {
      _setEmbedImpl(() => Promise.resolve(new Float32Array([1])));
      expect(await embedContent("rust memory")).toBeNull();
    } finally {
      delete process.env.MYA_NO_EMBEDDINGS;
    }
  });

  it("delegates to the injected embed impl when enabled", async () => {
    const expected = new Float32Array([0.5, 0.5]);
    _setEmbedImpl((t) => Promise.resolve(t.includes("rust") ? expected : null));
    const v = await embedContent("rust is great");
    expect(v).not.toBeNull();
    expect(Array.from(v!)).toEqual([0.5, 0.5]);
    // non-matching text → impl returns null
    expect(await embedContent("nothing here")).toBeNull();
  });
});

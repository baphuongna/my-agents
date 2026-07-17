/**
 * @my-agent/memory/embeddings — opt-in dense-vector embeddings for semantic recall.
 *
 * Pattern: mnemopi (`source/oh-my-pi/packages/mnemopi/src/core/embeddings.ts`) +
 * openclaw (sqlite-vec brute-force cosine). Ported + simplified for mya's
 * personal scale (brute-force cosine over a BLOB column is sufficient — openhuman
 * notes "fast enough for on-device workloads up to ~100K vectors").
 *
 * Design constraints:
 *   - fastembed (ONNX Runtime) is ASYNC-only → recall (sync, called from the sync
 *     `before_agent_start` hook) cannot await. So stored vectors are embedded in
 *     the BACKGROUND on capture (sync-readable as BLOB thereafter), and the QUERY
 *     vector is served from a sync LRU cache (cold query → FTS-only + async warm).
 *   - Opt-in: disabled by `MYA_NO_EMBEDDINGS` or if `fastembed` isn't installed.
 *     Core mya remains zero-new-mandatory-dep; recall degrades to FTS-only (the
 *     current behavior) — never breaks.
 *   - Dynamic `import("fastembed")` (not top-level) — the package eagerly loads
 *     `onnxruntime-node`, which segfaults if imported in some runtimes.
 *
 * See docs/embeddings-cross-system.md for the cross-system rationale.
 */
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** A dense embedding vector (Float32). */
export type Vec = Float32Array;

/** Model → dimension. Used for BLOB (de)serialization + sanity checks. */
const MODEL_DIMS: Record<string, number> = {
  "BAAI/bge-small-en-v1.5": 384,
  "BAAI/bge-small-zh-v1.5": 512,
  "sentence-transformers/all-MiniLM-L6-v2": 384,
};

/** mya model name → fastembed `StandardEmbeddingModel` enum string. Inlined so
 *  resolving a model never imports fastembed (avoids the onnxruntime eager-load). */
const FASTEMBED_ENUM: Record<string, string> = {
  "BAAI/bge-small-en-v1.5": "fast-bge-small-en-v1.5",
  "BAAI/bge-small-zh-v1.5": "fast-bge-small-zh-v1.5",
  "sentence-transformers/all-MiniLM-L6-v2": "fast-all-MiniLM-L6-v2",
};

// ── Config ────────────────────────────────────────────────────────────────
export function embeddingsDisabled(): boolean {
  return process.env.MYA_NO_EMBEDDINGS === "1" || process.env.MYA_NO_EMBEDDINGS === "true";
}
export function embeddingModel(): string {
  return process.env.MYA_EMBEDDING_MODEL || "BAAI/bge-small-en-v1.5";
}
export function embeddingDim(): number {
  return MODEL_DIMS[embeddingModel()] ?? 384;
}

// ── Model lifecycle (process-wide singleton, lazily loaded) ───────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let modelPromise: Promise<any> | null = null;

async function getModel(): Promise<unknown> {
  if (embeddingsDisabled()) return null;
  if (modelPromise) return modelPromise;
  const enumName = FASTEMBED_ENUM[embeddingModel()];
  if (!enumName) return null;
  const cacheDir = join(homedir(), ".mya", "memory", "fastembed-cache");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  modelPromise = (async (): Promise<any> => {
    try {
      mkdirSync(cacheDir, { recursive: true });
      // Dynamic import — fastembed eagerly loads onnxruntime-node.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { FlagEmbedding } = await import("fastembed" as any) as any;
      return await FlagEmbedding.init({
        model: enumName, cacheDir, showDownloadProgress: false,
      });
    } catch {
      // fastembed not installed, model download failed, or native addon missing.
      // Reset so a later install/retry can succeed; return null → FTS-only.
      modelPromise = null;
      return null;
    }
  })();
  return modelPromise;
}

/** Drain the first row from a fastembed async stream. */
async function drainFirst(model: unknown, text: string): Promise<Vec | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for await (const batch of (model as any).embed([text])) {
      for (const row of batch) return new Float32Array(row as ArrayLike<number>);
    }
  } catch { /* embedding inference failed → graceful null */ }
  return null;
}

// ── Test seam: injectable embed function ──────────────────────────────────
// Tests override this to inject deterministic vectors WITHOUT the fastembed model.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let embedImpl: ((text: string) => Promise<Vec | null>) | null = null;
/** @internal Test seam — inject a deterministic embedder (bypasses fastembed). */
export function _setEmbedImpl(fn: ((text: string) => Promise<Vec | null>) | null): void {
  embedImpl = fn;
  queryCache.clear();
}

async function embedRaw(text: string): Promise<Vec | null> {
  if (!text || !text.trim()) return null;
  if (embeddingsDisabled()) return null; // disabled wins (even with a test impl set)
  if (embedImpl) return embedImpl(text);
  const model = await getModel();
  if (!model) return null;
  return drainFirst(model, text);
}

// ── Query LRU cache (sync-read by recall; async-populated) ────────────────
// recall() is sync and cannot await embed. So the query vector is served from
// this cache; a cold query returns null (recall runs FTS-only) and fires an
// async warm so the NEXT identical/similar recall is hybrid.
const QUERY_CACHE_MAX = 512;
const queryCache = new Map<string, Vec>();

/** Sync lookup — returns the cached query vector, or null if cold. */
export function getCachedQueryVec(text: string): Vec | null {
  const v = queryCache.get(text);
  if (v) { // LRU touch
    queryCache.delete(text);
    queryCache.set(text, v);
  }
  return v ?? null;
}

/** Async embed + cache a query vector (fire-and-forget from recall on cold miss). */
export async function warmQueryVec(text: string): Promise<Vec | null> {
  if (queryCache.has(text)) return queryCache.get(text)!;
  const v = await embedRaw(text);
  if (v) {
    queryCache.set(text, v);
    if (queryCache.size > QUERY_CACHE_MAX) queryCache.delete(queryCache.keys().next().value!);
  }
  return v;
}

/** Embed a memory's content on capture (background). Returns the vector or null. */
export async function embedContent(text: string): Promise<Vec | null> {
  return embedRaw(text);
}

// ── Serialization (BLOB storage in SQLite) ────────────────────────────────
export function vecToBuffer(v: Vec): Buffer {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
}
export function bufferToVec(b: Buffer | Uint8Array | null, dim: number): Vec | null {
  if (!b || b.length !== dim * 4) return null;
  return new Float32Array(b.buffer, b.byteOffset, dim);
}

// ── Cosine similarity ─────────────────────────────────────────────────────
export function cosine(a: Vec, b: Vec): number {
  const n = Math.min(a.length, b.length);
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < n; i++) {
    const av = a[i]!, bv = b[i]!;
    dot += av * bv; na += av * av; nb += bv * bv;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// ── Conflict-detection thresholds (gbrain two-tier, docs/embeddings-cross-system.md) ─
/** Cosine ≥ this → near-duplicate (skip; stronger than jaccard). */
export const CONFLICT_COSINE_DUP = 0.95;

/**
 * @my-agent/memory/embeddings — opt-in dense-vector embeddings for semantic recall.
 *
 * Pattern: mnemopi + openclaw (brute-force cosine). Personal-scale (brute-force
 * over a BLOB column is fine — openhuman: "fast enough up to ~100K vectors").
 *
 * WORKER-THREAD OFFLOAD (critical): fastembed/ONNX inference is CPU-bound AND
 * ~1.2s/embed on a typical CPU. Running it on the MAIN thread freezes the TUI/Ink
 * loop + agent turns (and, observed, can deadlock under Ink). So all embedding
 * happens in a dedicated worker_thread that owns the fastembed model — the main
 * thread's `embedContent` is just a postMessage round-trip (non-blocking). The
 * worker is a string spawned with `eval:true`, so it works with the single-file
 * bundle (no separate worker file); fastembed resolves from node_modules at runtime.
 *
 * Opt-in: disabled by MYA_NO_EMBEDDINGS or if fastembed isn't installed. Core
 * mya stays zero-new-mandatory-dep; recall/search degrade to FTS-only/grep —
 * never breaks.
 *
 * See docs/embeddings-cross-system.md for the cross-system rationale.
 */
import { Worker } from "node:worker_threads";

/** A dense embedding vector (Float32). */
export type Vec = Float32Array;

/** Model → dimension. Used for BLOB (de)serialization + sanity checks. */
const MODEL_DIMS: Record<string, number> = {
  "BAAI/bge-small-en-v1.5": 384,
  "BAAI/bge-small-zh-v1.5": 512,
  "sentence-transformers/all-MiniLM-L6-v2": 384,
};

/** mya model name → fastembed `StandardEmbeddingModel` enum string. Inlined so
 *  resolving a model never imports fastembed on the main thread. */
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

// ── Embedding worker (owns fastembed + ONNX, off the main thread) ──────────
// The worker loads the model once, then serves embed requests. Buffering
// pre-ready requests means the first embedContent (which spawns the worker)
// waits correctly for model init rather than dropping.
const WORKER_SRC = [
  "const { parentPort } = require('worker_threads');",
  "let model = null, ready = false;",
  "const queue = [];",
  "async function processEmbed(msg) {",
  "  try {",
  "    for await (const batch of model.embed([msg.text])) {",
  "      for (const row of batch) { parentPort.postMessage({ id: msg.id, vec: new Float32Array(row) }); return; }",
  "    }",
  "    parentPort.postMessage({ id: msg.id, vec: null });",
  "  } catch (e) { parentPort.postMessage({ id: msg.id, vec: null, error: String((e && e.message) || e) }); }",
  "}",
  "parentPort.on('message', (msg) => { if (msg && msg.type === 'embed') { if (ready) processEmbed(msg); else queue.push(msg); } });",
  "(async () => {",
  "  try {",
  "    const { FlagEmbedding } = await import('fastembed');",
  "    const os = require('os'), path = require('path'), fs = require('fs');",
  "    const cacheDir = path.join(os.homedir(), '.mya', 'memory', 'fastembed-cache');",
  "    fs.mkdirSync(cacheDir, { recursive: true });",
  "    const modelEnv = process.env.MYA_EMBEDDING_MODEL || 'BAAI/bge-small-en-v1.5';",
  "    const ENUM = { 'BAAI/bge-small-en-v1.5':'fast-bge-small-en-v1.5', 'BAAI/bge-small-zh-v1.5':'fast-bge-small-zh-v1.5', 'sentence-transformers/all-MiniLM-L6-v2':'fast-all-MiniLM-L6-v2' };",
  "    const enumName = ENUM[modelEnv];",
  "    if (!enumName) throw new Error('unknown embedding model: ' + modelEnv);",
  "    model = await FlagEmbedding.init({ model: enumName, cacheDir, showDownloadProgress: false });",
  "    ready = true;",
  "    parentPort.postMessage({ type: 'ready' });",
  "    while (queue.length) processEmbed(queue.shift());",
  "  } catch (e) { parentPort.postMessage({ type: 'init-failed', error: String((e && e.message) || e) }); }",
  "})();",
].join("\n");

const EMBED_TIMEOUT_MS = 60_000; // safety: a single embed must not hang forever
let _worker: Worker | null = null;
let _workerDead = false; // init failed / errored — stop retrying (degrade to null)
let _reqId = 0;
const _pending = new Map<number, { resolve: (v: Vec | null) => void; timer: ReturnType<typeof setTimeout> }>();

function failAllPending(): void {
  for (const [, p] of _pending) { clearTimeout(p.timer); p.resolve(null); }
  _pending.clear();
}

function getWorker(): Worker | null {
  if (_workerDead) return null;
  if (!_worker) {
    try {
      _worker = new Worker(WORKER_SRC, { eval: true });
      _worker.on("message", (msg: { type?: string; id?: number; vec?: Vec | null; error?: string }) => {
        if (msg.type === "init-failed") {
          _workerDead = true; failAllPending(); return; // fastembed absent/broken → degrade
        }
        if (msg.type === "ready") return; // model loaded
        if (msg.id !== undefined) {
          const p = _pending.get(msg.id);
          if (p) { clearTimeout(p.timer); _pending.delete(msg.id); p.resolve(msg.vec ?? null); }
        }
      });
      _worker.on("error", () => { _workerDead = true; failAllPending(); });
    } catch {
      _workerDead = true;
      return null;
    }
  }
  return _worker;
}

async function embedViaWorker(text: string): Promise<Vec | null> {
  const w = getWorker();
  if (!w) return null;
  const id = ++_reqId;
  return new Promise<Vec | null>((resolve) => {
    const timer = setTimeout(() => { _pending.delete(id); resolve(null); }, EMBED_TIMEOUT_MS);
    _pending.set(id, { resolve, timer });
    w.postMessage({ type: "embed", id, text });
  });
}

// ── Test seam: injectable embed function ──────────────────────────────────
// Tests override this to inject deterministic vectors WITHOUT fastembed/worker.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let embedImpl: ((text: string) => Promise<Vec | null>) | null = null;
/** @internal Test seam — inject a deterministic embedder (bypasses the worker). */
export function _setEmbedImpl(fn: ((text: string) => Promise<Vec | null>) | null): void {
  embedImpl = fn;
  queryCache.clear();
}

async function embedRaw(text: string): Promise<Vec | null> {
  if (!text || !text.trim()) return null;
  if (embeddingsDisabled()) return null; // disabled wins (even with a test impl set)
  if (embedImpl) return embedImpl(text); // test seam bypasses the worker
  return embedViaWorker(text);
}

// ── Query LRU cache (sync-read by recall; async-populated) ────────────────
// recall() is sync and cannot await. So the query vector is served from this
// cache; a cold query returns null (recall runs FTS-only) + fires an async warm.
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

/** Embed a memory's content (background) / a code chunk / a query. Worker-backed. */
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

/** @internal Test helper — terminate the worker (between test files). */
export function _shutdownEmbedWorker(): void {
  if (_worker) { try { void _worker.terminate(); } catch { /* ignore */ } }
  _worker = null;
  _workerDead = false;
  failAllPending();
}

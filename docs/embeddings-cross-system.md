# Embeddings for Memory Recall — Cross-System Study

> How hermes, openclaw, openhuman, gbrain, headroom, mnemopi, mya-v1, codebase-memory-mcp,
> and mem0 handle semantic/dense-vector retrieval — and what it means for mya's action #3.
> Sources: `source/*` (read-only code audit, file:line cited). Date: 2026-07-17.

## TL;DR

**mya-v2 is the outlier.** Of 9 studied memory systems, every one with a real recall
pipeline uses embeddings. mya-v2's FTS5-only design is **a deliberate regression from
mya-v1** (which had full hybrid FTS5+embeddings) — but the regression was justified
because mya-v1's embedder was **API-only (not offline)**. The local-embedder ecosystem
now makes offline embeddings trivial (~30MB), so the original tradeoff no longer holds.

Three findings make the upgrade path clear + low-risk:
1. **mya's own pattern source (mnemopi) already uses embeddings** (fastembed, local ONNX).
   mya copied only the FTS5+SQLite layer and left the embedding layer out.
2. **mya-v2 already has the seams**: the unused `embed_text` column + the char-3-gram
   "surrogate vector" arm in `rrf.ts` were built for a real embedder.
3. **gbrain uses embeddings for conflict detection** — directly fixing mya's jaccard
   weakness (action #2) as a bonus.

## The landscape

| System | Embeds for memory? | Embedder | Vector store | Offline? | Fusion |
|---|---|---|---|---|---|
| **mem0** | YES | OpenAI default / Ollama/HF/FastEmbed | Qdrant | configurable | fake-hybrid¹ |
| **headroom** | YES | sentence-transformers / **ONNX** (MiniLM, 384d) / OpenAI / Ollama | **sqlite-vec** / HNSW | ✅ ONNX ~86MB | separate search/text_search; adaptive-α relevance |
| **openclaw** | YES | **node-llama-cpp GGUF** (embeddinggemma-300m) / OpenAI/Ollama/Gemini | **sqlite-vec** + brute-force fallback | ✅ local GGUF | weighted 0.7/0.3 + MMR + temporal decay |
| **openhuman** | YES | Voyage cloud / **Ollama bge-m3** / OpenAI / Cohere | SQLite BLOB brute-force | ✅ Ollama | 4-signal (graph+vector+keyword+freshness) |
| **gbrain** | YES (+ conflict!) | ZeroEntropy zembed-1 / **Ollama/llama.cpp** / LiteLLM | **pgvector HNSW** | ✅ Ollama/PGLite | RRF (keyword+vector+relational) + cosine re-score |
| **mnemopi** ⭐ | YES | **fastembed (bge-small-en ONNX, 384d)** / OpenAI | **sqlite-vec** + in-mem exact | ✅ fastembed ~30MB | weighted 0.5/0.3/0.2 |
| **mya-v1** ⭐ | YES (**dropped in v2**) | OpenAI API only | SQLite BLOB brute-force | ❌ API-only | weighted 0.7/0.3 |
| **codebase-memory-mcp** | YES (algorithmic) | custom 11-signal (TF-IDF+RI+AST) in C | SQLite BLOB + custom cosine fn | ✅ zero-dep | BM25 + vector (separate modes) |
| **hermes-agent** | PARTIAL (HRR²) | none neural (HRR = SHA-256 hashes) | SQLite BLOB | ✅ zero-dep | weighted (FTS+Jaccard+HRR) |
| **claw-code** | NO | — | — | — | — (no memory system) |
| **mya-v2 (current)** | **NO** | — (char-3-gram surrogate only) | — | ✅ zero-dep | RRF (BM25+trigram+surrogate) |

¹ mem0's "hybrid" is fake — candidate pool is semantic-only; BM25/entity can't add candidates (see `mem0-comparison-deepdive.md`).
² HRR = Holographic Reduced Representations = deterministic phase vectors from SHA-256. **Not semantic** — "errors" won't match "failed" unless they share tokens. A vector-symbolic algebra, not learned embeddings.

⭐ = most relevant to mya (mnemopi = pattern source; mya-v1 = predecessor).

## Per-system detail

### headroom — full neural, the Node-stack reference
- Default `all-MiniLM-L6-v2` (384d) via sentence-transformers (~2GB torch) **or ONNX Runtime (~86MB, no torch)**.
- sqlite-vec (brute-force cosine, default) or HNSW (optional C++). Eager embed on every `add()`.
- Hybrid: separate `search()` (vector) + `text_search()` (FTS5). The relevance-scorer path uses **fastembed (bge-small-en, ~30MB int8 ONNX)** with adaptive-α fusion + BM25 fallback.
- **The ONNX/fastembed path is the lightweight-offline template.**

### openclaw — production hybrid, sqlite-vec gold standard
- Local: `node-llama-cpp` + GGUF (`embeddinggemma-300m-qat`, worker thread). Cloud: OpenAI/Ollama/Gemini.
- **sqlite-vec** (`vec0` virtual tables, `MATCH ? AND k = ?` KNN) **+ brute-force cosine fallback** (batches of 256).
- Embedding **cache table** by (provider, model, hash) — avoids re-embedding unchanged chunks.
- Fusion: `0.7*vector + 0.3*text` (BM25→sigmoid normalized), + optional MMR + temporal decay.
- Embeds memory markdown files + session transcripts + multimodal.

### openhuman — on-device-first, brute-force is enough
- Cloud default (Voyage 1024d) / **Ollama bge-m3 local** / OpenAI / Cohere / noop-fallback.
- **SQLite BLOB brute-force cosine** — comment: "fast enough for on-device workloads up to ~100K vectors."
- Hybrid: 4 weight profiles (BALANCED graph.35/vec.35/kw.15/fresh.15, SEMANTIC, LEXICAL, GRAPH_FIRST).

### gbrain — embeddings for BOTH recall AND conflict detection
- ZeroEntropy zembed-1 (1280d) / **Ollama/llama.cpp/LiteLLM** local / PGLite (embedded Postgres WASM).
- **pgvector HNSW** ANN (two-stage CTE: inner HNSW `<=>` + outer re-rank).
- Fusion: RRF (keyword+vector+relational) → boosts → `0.7*RRF + 0.3*cosine` re-score.
- **Conflict detection (directly fixes mya's jaccard weakness):**
  - cosine ≥ 0.95 → DUPLICATE (skip, no LLM)
  - cosine 0.85–0.95 → LLM judge (duplicate | supersede | independent)
  - cosine < 0.85 → independent
  - This two-tier (fast-path embeddings + LLM judge) is **far better than jaccard token-overlap**.

### mnemopi ⭐ — mya's pattern source, DOES use embeddings
- **fastembed (bge-small-en-v1.5, 384d, int8 ONNX, ~30MB)** local / OpenAI API.
- **sqlite-vec** (`vec_episodes`) + in-memory exact-cosine fallback. Supports int8 + binary quantization.
- Per-capture embed scheduled as **background task** (`pendingExtractions`); query embed **LRU-cached** (512).
- Fusion: `dense*0.5 + fts*0.3 + importance*0.2`. `MNEMOPI_NO_EMBEDDINGS=1` → graceful FTS-only.
- **mya-v2 copied mnemopi's FTS5+SQLite layer but OMITTED this embedding layer.**

### mya-v1 ⭐ — mya's predecessor, HAD embeddings, DROPPED them
- **OpenAI API only** (no local embedder — Cargo.toml has only `reqwest`, no candle/ort/smartcore).
- SQLite BLOB + brute-force cosine + embedding cache. `SearchMode::{Bm25, Embedding, Hybrid}`.
- Fusion: `0.7*vector + 0.3*keyword`.
- **Why dropped in v2**: API-only → not offline → removed for zero-dependency operation. The drop
  was about the **cloud dependency**, not about embeddings being wrong. mya-v2 kept the
  `embed_text` column + added a char-3-gram TF-IDF "surrogate vector" in `rrf.ts` (comment:
  *"a SURROGATE for a real embedding model — vector-like behaviour without external dependency"*).

### hermes-agent — zero-dep core, HRR not semantic
- Built-in memory = file snapshot (no search at all). Session search = SQLite FTS5.
- Holographic plugin = FTS5 + Jaccard + **HRR phase vectors** (SHA-256 → angles → circular convolution).
  - Deterministic, zero-dep, but **not semantic** (token-hash overlap, not meaning).
- Cloud embeddings only via optional hindsight plugin (vectorize.io). NumPy optional (falls back to FTS+Jaccard).

### codebase-memory-mcp — algorithmic embeddings (code domain)
- 11 hand-crafted signals (TF-IDF + Random Indexing + AST profile + API/type signatures + MinHash + graph diffusion) in C.
- Pretrained `nomic-embed-code` base + sparse random fallback. int8 BLOB + custom SQLite cosine fn.
- Domain-specific (code symbols) — **not portable to conversational memory**, but proves zero-dep algorithmic vectors are viable for structured domains.

## Critical insights for mya

### 1. mya-v2 is the outlier, and the original justification is stale
The v2 rewrite dropped embeddings because **mya-v1's were API-only** (not offline). That was
correct *then*. But every offline-capable peer now uses a ~30–90MB local model
(fastembed / ONNX / GGUF / Ollama). The "zero-dependency offline" goal no longer requires
giving up semantic recall — **a single optional ~30MB model achieves both.**

### 2. mnemopi (mya's own pattern source) has the exact pipeline to copy
mya-v2 was explicitly patterned on mnemopi but copied only the FTS5+SQLite layer. mnemopi's
embedding layer — **fastembed (bge-small-en, sqlite-vec, background embed, LRU query cache,
graceful degradation)** — is a proven, same-stack (TS + SQLite) implementation. mnemopi even
solved the native-addon crash issues (lazy init, subprocess isolation) — that work is reusable.

### 3. The seams already exist in mya-v2
- `embed_text TEXT DEFAULT NULL` column (unused — placeholder for an embedding).
- `rrf.ts` char-3-gram TF-IDF **"surrogate vector" arm** (explicitly marked as a placeholder for a real embedder).
- The RRF fusion pipeline is already wired — a real vector arm drops in where the surrogate is.

### 4. gbrain's two-tier conflict detection fixes mya's jaccard weakness as a bonus
mya's conflict detector uses jaccard token-overlap (action #2: can't separate "tabs vs spaces"
0.714 from "backend vs frontend" 0.75). gbrain's approach — **cosine ≥0.95 → dup, 0.85–0.95 →
LLM judge, else independent** — solves this with the same embeddings once they exist. One
embedder upgrade addresses **both** action #3 (recall) and action #2 (conflict).

## Recommended path for mya action #3 (grounded in what worked)

| Component | Choice | Precedent | Rationale |
|---|---|---|---|
| **Embedder** | **fastembed** `BAAI/bge-small-en-v1.5` (384d, int8 ONNX, ~30MB) | mnemopi, headroom | Same TS+SQLite stack; mnemopi proved it; smallest offline footprint; no torch |
| **Alt embedders** | Ollama (bge-m3), OpenAI (text-embedding-3-small) | openhuman, mem0 | For users who already run Ollama / want cloud |
| **Vector store** | **sqlite-vec** (loadable ext for better-sqlite3) + brute-force cosine fallback | openclaw, mnemopi, headroom | No new DB; KNN via `vec0`; fallback keeps it working if ext missing |
| **Wiring** | per-capture embed (background task) + LRU query-embed cache | mnemopi | Non-blocking writes; cache avoids re-embedding query |
| **Storage** | write into existing `embed_text` seam (or a parallel `vec_working`/`vec_episodes` vec0 table) | mnemopi | Column already there; zero schema friction |
| **Fusion** | replace `rrf.ts` surrogate arm with real vector arm; or weighted (0.5 vec / 0.3 fts / 0.2 importance) | mnemopi, openclaw | mya's RRF already exists — just upgrade the arm |
| **Degradation** | `MYA_NO_EMBEDDINGS=1` → FTS-only (never break if embedder unavailable) | mnemopi (`MNEMOPI_NO_EMBEDDINGS`) | Offline-first principle preserved |
| **Conflict bonus** | cosine two-tier (≥0.95 dup / 0.85–0.95 LLM / else independent) | gbrain | Fixes action #2 jaccard weakness with the same embeddings |

### Effort estimate (from the precedents)
- mnemopi's `embeddings.ts` (~340 lines) + `vector-index.ts` (~70 lines) + sqlite-vec wiring
  is the template. Porting to mya ≈ a few hundred lines + an optional dep + tests.
- The hard parts (native-addon crash-proofing, quantization) are **already solved in mnemopi** — reusable.

### Risk / guardrails
- **Optional dependency**: fastembed + onnxruntime-node are *optional* peer deps (like mnemopi).
  Core mya still runs zero-dep if the embedder isn't installed.
- **AGENTS.md Rust-gate**: the embedder lives in TS (packages/memory), not Rust core — no Rust-gate
  concern. (zeroclaw = mya's Rust runtime has NO memory system; memory is TS-only, confirmed.)
- **Offline-first preserved**: fastembed downloads the model once (~30MB), then runs fully offline.

## Verdict

The cross-system evidence is unambiguous: **mya should add embeddings via fastembed +
sqlite-vec**, porting mnemopi's proven pipeline into the existing `embed_text` / `rrf.ts` seams.
This (a) restores parity with every peer, (b) reverses an over-aggressive simplification from
mya-v1, (c) fixes the recall-inversion's root gap (semantic matching), and (d) as a bonus,
enables gbrain-style conflict detection to retire the brittle jaccard detector. The upgrade is
**opt-in, offline-capable, and low-risk** — the architecture was built to accept it.

## Reference links
- mnemopi: `source/oh-my-pi/packages/mnemopi/` (pattern source — `src/core/embeddings.ts`, `vector-index.ts`)
- mya-v1: `source/mya-v1/crates/mya-memory/` (predecessor — `embeddings.rs`, `vector.rs`, `sqlite.rs`)
- openclaw: `source/openclaw/extensions/memory-core/`, `packages/memory-host-sdk/`
- gbrain: `source/gbrain/src/core/` (`facts/classify.ts`, `search/hybrid.ts`)
- headroom: `source/headroom/memory/` (`adapters/embedders.py`, `adapters/sqlite_vector.py`)

## Implementation status (action #3 — shipped, opt-in)

This feature is now **implemented** in `packages/memory/src/embeddings.ts` +
`sqlite-recall.ts` (vector arm) + `sqlite-store.ts` (background capture embed).
Verified: 245/245 memory tests pass (+9 embeddings tests), real mya TUI launches
clean, real DB migrates (`embedding BLOB` columns added, integrity ok), and
**graceful degradation confirmed live** (fastembed absent → BLOB stays NULL,
recall runs FTS-only — zero regression).

### Trust & operational notes (security review)
- **Model download**: fastembed downloads `bge-small-en-v1.5` (~30MB) from
  HuggingFace to `~/.mya/memory/fastembed-cache/` on first use. This is an
  inherent fastembed property — **no integrity hash is verified** (mitm/cache-
  poison risk is the upstream package's, not mya's). Accept the trust assumption
  or set `MYA_NO_EMBEDDINGS=1` to disable entirely.
- **Data stays local**: embeddings are computed in-process (ONNX) — no
  conversation content leaves the machine in the MVP. (A future OpenAI/Ollama
  embedder option WOULD send content — opt-in, documented then.)
- **`_setEmbedImpl`**: test-only seam (same-process); not a remote vector.

### Deferred (deliberate)
- **Conflict cosine (gbrain two-tier)**: deferred. The conflict check runs at
  *capture* time (sync), but the new memory's vector isn't embedded until the
  *background* embed completes — so cosine-vs-new can't be computed synchronously.
  Requires either a sync embedder (none exists for ONNX) or a *deferred* cosine
  re-check after the background embed lands. Recall's vector arm (the main value)
  ships now; conflict stays jaccard (action #2 fix).
- **`embed_text` vs `embedding`**: mya already had an unused `embed_text TEXT`
  column (FTS-concat placeholder). The new **`embedding BLOB`** column is
  distinct (dense vector, not in FTS). `embed_text` remains a legacy placeholder.
- **sqlite-vec acceleration**: brute-force cosine (no native dep) is the MVP
  (openhuman: "~100K vectors fast enough"). A `LIMIT 5000` safety valve bounds
  pathological scale; switch to sqlite-vec/ANN if memory count exceeds ~50K.

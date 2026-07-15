# GBrain — Tài liệu kiến trúc chi tiết (Heavy Mode Reference)

> Tài liệu tham khảo cho việc triển khai "heavy mode" trong my-agent sau này.
> Nguồn: `/home/bom/source/my-agent/source/gbrain/`

## A. Tổng quan kiến trúc

### A.1 Dual-Engine

| Engine | Lớp | Khi nào dùng |
|---|---|---|
| **PGLite** | Postgres 17 WASM, in-process | Personal brains ≤50K pages, zero-config, single-writer, 2s init |
| **Postgres** | Hosted (Supabase/self-hosted) | Shared/large/multi-machine, connection pooling, RLS, pg_notify |

Cả hai implement cùng `BrainEngine` interface (~47 operations). Discriminator: `engine.kind: 'postgres' | 'pglite'`.

### A.2 Brain Repo

**Markdown là source of truth.** Git repo chứa `.md` files → sync vào Postgres để retrieval. Delete trong git → soft-delete trong DB.

### A.3 Source Tenancy

Mỗi brain là một `source` (multi-repo). Federation: `config.federated=true` → tham gia cross-source search. Mọi row (pages, chunks, links, facts, takes) đều có `source_id`.

---

## B. Schema — Tất cả 33+ tables

### B.1 `pages` — Core content

```sql
pages (
  id SERIAL PK,
  source_id TEXT FK→sources DEFAULT 'default',
  slug TEXT NOT NULL,                    -- URL-safe page ID
  type TEXT NOT NULL,                    -- person, company, meeting, ...
  page_kind TEXT CHECK IN ('markdown','code','image'),
  title TEXT NOT NULL,
  compiled_truth TEXT DEFAULT '',        -- synthesized canonical content
  timeline TEXT DEFAULT '',
  frontmatter JSONB DEFAULT '{}',
  content_hash TEXT,                     -- dedup
  emotional_weight REAL DEFAULT 0.0,     -- salience [0,1]
  effective_date TIMESTAMPTZ,            -- salience/recency anchor
  generation BIGINT DEFAULT 1,           -- per-page cache invalidation
  search_vector TSVECTOR,                -- weighted FTS (A=title, B=truth, C=timeline)
  deleted_at TIMESTAMPTZ,                -- soft-delete
  created_at, updated_at, ...
  UNIQUE(source_id, slug)
)
```

**Triggers:**
- `bump_page_generation_trg` — BEFORE INSERT/UPDATE: bumps `generation` khi content thay đổi
- `bump_page_generation_clock_trg` — AFTER statement: `nextval('page_generation_clock_seq')` cho cache invalidation
- `trg_pages_search_vector` — BEFORE INSERT/UPDATE: rebuilds `search_vector` với weights A/B/C

**Indexes:** GIN(search_vector), GIN(frontmatter), GIN(title gin_trgm_ops), B-tree(generation), partial(deleted_at WHERE NOT NULL)

### B.2 `content_chunks` — Embedded chunks

```sql
content_chunks (
  id SERIAL PK,
  page_id INTEGER FK→pages CASCADE,
  chunk_index INTEGER,
  chunk_text TEXT,
  chunk_source TEXT DEFAULT 'compiled_truth',
  embedding vector(1536),                -- OpenAI text-embedding-3-large
  embedding_image vector(1024),          -- Voyage multimodal
  embedding_multimodal vector(1024),     -- Phase 3 unified
  model TEXT, token_count INTEGER, language TEXT,
  symbol_name TEXT, symbol_type TEXT,    -- code symbols
  start_line, end_line INTEGER,
  parent_symbol_path TEXT[],             -- qualified hierarchy
  doc_comment TEXT,
  search_vector TSVECTOR,                -- chunk-grain FTS
  modality TEXT DEFAULT 'text'
)
```

**HNSW indexes:** `vector_cosine_ops` trên embedding + embedding_image (partial WHERE NOT NULL)

### B.3 `facts` — Hot Memory (L0)

```sql
facts (
  id BIGSERIAL PK,
  source_id TEXT FK→sources,
  entity_slug TEXT,
  fact TEXT,
  kind TEXT CHECK IN ('event','preference','commitment','belief','fact'),
  visibility TEXT CHECK IN ('private','world') DEFAULT 'private',
  notability TEXT CHECK IN ('high','medium','low'),
  valid_from TIMESTAMPTZ DEFAULT now(),
  valid_until TIMESTAMPTZ,
  expired_at TIMESTAMPTZ,                -- soft-expire
  superseded_by BIGINT FK→facts,         -- supersession chain
  consolidated_at TIMESTAMPTZ,
  consolidated_into BIGINT,              -- target take id
  confidence REAL CHECK [0,1] DEFAULT 1.0,
  embedding vector(N),                   -- HNSW-indexed
  source TEXT, source_session TEXT
)
```

### B.4 `takes` — Typed Claims (L1)

```sql
takes (
  id BIGSERIAL PK,
  page_id INTEGER FK→pages CASCADE,
  claim TEXT,                            -- the claim text
  kind TEXT,                             -- fact/take/bet/hunch
  holder TEXT,                           -- who holds the claim
  weight REAL CHECK [0,1] DEFAULT 0.5,   -- confidence
  since_date TEXT, until_date TEXT,
  active BOOLEAN DEFAULT TRUE,
  superseded_by INTEGER,
  -- Resolution tracking (v0.30):
  resolved_at TIMESTAMPTZ,
  resolved_outcome BOOLEAN,              -- binary
  resolved_quality TEXT CHECK IN ('correct','incorrect','partial','unresolvable'),
  resolved_value REAL, resolved_unit TEXT, resolved_source TEXT, resolved_by TEXT,
  embedding VECTOR(1536),                -- HNSW WHERE active AND embedding NOT NULL
  UNIQUE(page_id, row_num)
)
```

### B.5 `links` — Knowledge Graph

```sql
links (
  from_page_id INTEGER FK→pages CASCADE,
  to_page_id INTEGER FK→pages CASCADE,
  link_type TEXT DEFAULT '',             -- attended, works_at, invested_in, ...
  context TEXT DEFAULT '',
  link_source TEXT CHECK regex,          -- markdown/frontmatter/mentions/manual/wikilink-resolved
  link_kind TEXT CHECK IN ('plain','typed_ner'),
  origin_page_id INTEGER FK→pages SET NULL,
  UNIQUE NULLS NOT DISTINCT(from_page_id, to_page_id, link_type, link_source, origin_page_id)
)
```

### B.6 Code Edges

Hai bảng: `code_edges_chunk` (resolved, cả hai endpoints = chunk IDs) + `code_edges_symbol` (unresolved, target = qualified name).

### B.7 Infrastructure

- `minion_jobs` — BullMQ-shaped Postgres job queue (claim via FOR UPDATE SKIP LOCKED, stalled detection, parent/child, idempotency)
- `query_cache` — Semantic query cache với HNSW trên embedding + `max_generation_at_store` invalidation
- `page_generation_clock_seq` — contention-free sequence cho cache Layer 1
- `subagent_messages` + `subagent_tool_executions` — durable LLM loops
- `eval_candidates` — captured search calls cho replay

---

## C. Retrieval Pipeline — 15 steps

### Full pipeline: `hybridSearch()` → `hybridSearchCached()`

```
1. Mode resolution (conservative | balanced | tokenmax)
   → bundles: expansion, graph_signals, reranker, autocut, tokenBudget

2. Embedding column resolution (text | image | multimodal)

3. Intent classification (5 axes):
   - intent: entity | temporal | event | general
   - suggestedDetail: low | high
   - suggestedSalience: off | on | strong
   - suggestedRecency: off | on | strong
   - suggestedModality: text | image | both

4. Keyword search:
   - tsvector (weighted A/B/C) + GIN index
   - pg_trgm fuzzy fallback

5. Vector search:
   - HNSW (vector_cosine_ops) trên content_chunks.embedding
   - Multi-modal: embedding_image, embedding_multimodal

6. RRF Fusion (k=60):
   - score = 1 / (k + rank)
   - Intent-weighted k values: keywordK, vectorK khác nhau per intent
   - COMPILED_TRUTH_BOOST = 2.0x cho compiled_truth chunks
   - rrfKey = `${source_id}:${slug}:${chunk_id}` (source-scoped)

7. Post-fusion boosts (7 types):
   a. Backlink boost: 1.0 + 0.05 * log(1 + count)        [~1.035-1.23]
   b. Salience boost: 1.0 + k * log(1 + emotional_score)  [k=0.15|0.30, ~1.0-1.6]
   c. Recency boost: per-prefix halflife decay             [prefix-matched, evergreen=0]
   d. Title phrase boost: 1.25x                           [query trong title]
   e. Graph signals: adjacency 1.05, cross-source 1.10, session demote 0.95
   f. Alias resolved boost: 1.05x                         [slug_aliases match]
   g. Chronicle type boost: 1.15-1.25x                    [event/diary pages]

8. Dedup: page-grain, best chunk per page wins
   - cosineThreshold, maxTypeRatio, maxPerPage

9. Reranking (optional, tokenmax mode):
   - Cross-encoder rerank top-30
   - Fail-open: error → original order unchanged
   - Stamps rerank_score + reranker_delta

10. Alias Hop (T3):
    - Exact alias match → inject/boost (1.10x)
    - Cap 3 injections, ≤6 tokens

11. Evidence stamp: why it matched + create_safety hint

12. Adaptive return sizing: intent-aware cap

13. Autocut: score-discontinuity detection
    - Finds largest gap in sorted rerank scores
    - jumpRatio threshold, minKeep=1 failsafe

14. Token budget enforcement:
    - estimateTokens = ceil(text.length / 4)
    - Greedy top-down, stops at budget

15. Content flag stamp: markup-heavy/oversize warnings
```

---

## D. Lifecycle Management

### D.1 Fact → Take Consolidation

```
Facts (hot memory, per-session)
  ↓ consolidate phase (≥3 facts per entity)
Takes (typed claims with weight, holder, resolution tracking)
  ↓ never deleted — consolidated_at marks
```

### D.2 Soft-Delete + 72h Purge

```
softDeletePage(slug) → deleted_at = now()
  ↓ search filters WHERE deleted_at IS NULL
purgeDeletedPages(72) → hard DELETE WHERE deleted_at < now() - 72h
restorePage(slug) → deleted_at = NULL
```

### D.3 Page Versioning

Mỗi `putPage` trên existing row → snapshot vào `page_versions`. `revertToVersion` restore snapshot.

### D.4 Emotional Weight

```
emotional_weight = f(tag_emotion + take_density + holder_ratio)  -- [0,1]
salience_score = emotional_weight × 5 + ln(1 + take_count)
```

### D.5 Dream Cycle (66 cron jobs)

Phases: purge → synthesize → extract_facts → recompute_emotional_weight → reconcile_links → embed_stale

Cycle coordination: `gbrain_cycle_locks` (TTL-based, works qua PgBouncer).

### D.6 Per-Prefix Recency Decay

```
factor = 1.0 + strengthMul × coefficient × halflifeDays / (halflifeDays + daysOld)
```

Prefixes matched longest-first. Evergreen (halflifeDays=0) → contribute 0.

---

## E. Knowledge Graph

### E.1 Edge Types (zero-LLM extraction)

`attended`, `works_at`, `invested_in`, `founded`, `advises`, `mentions` (body-text auto-link), `wikilink-resolved`

### E.2 Graph Signals (post-fusion boost)

| Signal | Boost | Condition |
|---|---|---|
| Adjacency | 1.05x | ≥2 inbound links within top-K |
| Cross-source | 1.10x | ≥2 links from OTHER source (stacks on adjacency) |
| Session demote | 0.95x | ≥2 results share session prefix |

### E.3 Code Edges API

```typescript
getCallersOf(qualifiedName)   // "Who calls this?"
getCalleesOf(qualifiedName)   // "What does this call?"
searchKeywordChunks(query)    // chunk-grain FTS
// Two-pass walk: expand code_edges up to 2 hops with decayed scores
```

---

## F. Migration Path — mya → GBrain Heavy Mode

### F.1 Dependencies

| Dependency | Purpose |
|---|---|
| `@electric-sql/pglite` | Postgres 17 WASM, zero-config, in-process |
| pgvector | HNSW vector search (built into PGLite) |
| pg_trgm | Fuzzy text matching |
| Embedding provider | text-embedding-3-large (1536d) hoặc Voyage (1024d) |
| Reranker (optional) | ZeroEntropy zerank-2 |

### F.2 Schema Mapping

| mya (mnemopi) | GBrain Heavy | Notes |
|---|---|---|
| `working_memory` | `facts` | Hot memory, per-entity, decay by kind |
| `episodic_memory` | `takes` | Typed claims with weight + resolution tracking |
| `facts` (structured) | `pages` + `content_chunks` | Markdown pages với compiled_truth + embeddings |
| FTS5 BM25 | tsvector (weighted) + HNSW + RRF | GBrain adds vector + graph + reranking |
| Weibull decay | per-prefix recency halflife + emotional_weight | |

### F.3 Khi nào cần heavy mode

- >50K memories
- Multi-user / multi-source federation
- Cross-modal search (text + image)
- Self-wiring knowledge graph
- Subagent coordination với durable message log
- Production eval system

### F.4 Performance Notes

- PGLite ceiling: ~50K pages → migrate to hosted Postgres
- HNSW index size ∝ chunk count; partial HNSW cho image embeddings
- Query embed timeout: 6s default (bounded)
- Cache: two-layer (global clock + per-page generation)
- Batch operations: self-retry with decorrelated jitter (callers MUST NOT wrap externally)

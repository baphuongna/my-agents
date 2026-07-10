# Memory (roles + manager + unified context)

> Part of the Unified Agent SPEC — see [00-OVERVIEW.md](00-OVERVIEW.md). Section §8.



## 8. Memory (roles + manager + unified context)

Memory is a **flagship subsystem**, not a backend list. *(source: [openhuman](../../openhuman/) + [hermes](../../hermes-agent/).)*

**Named roles** *(source: [openhuman](../../openhuman/))* beyond backends:
- `archivist` — **conversation→tree-leaf bridge**: strips tool-call noise from chat turns and appends the cleaned markdown as a single leaf into a memory tree. No curation/decay/promotion (inactivity-triggered, runs on **auxiliary** provider).
- `tree` — hierarchical context.
- `diff` — change tracking over time.
- `goals` — **user goal-list manager** (CRUD + LLM reflection agent maintaining `MEMORY_GOALS.md`); not a retrieval key.
- `sync` — **upstream-source ingestion** pipelines (Composio connectors / workspace file-watch / MCP servers) pulling external data into the memory store; no CRDT/device-replication (see [§23 Open Questions](11-invariants-roadmap.md) #5).
- `working` — ephemeral per-turn working set (the context the loop assembles for the current turn; not persisted). *(C4/R28.)*

**Single `MemoryManager` integration point** *(source: [hermes](../../hermes-agent/))* — the ONLY place the loop touches memory: owns BOTH `MemoryBackend[]` (stores) AND `MemoryRole[]` (lifecycle roles) (R27-4), enforces **one-external-provider rule** (governs `MemoryBackend` only — ragfs is a read-only aggregation layer; its constituent sources (skills, knowledge, files) may use independent providers; prevents schema bloat), drains in-flight sync within a bounded timeout on shutdown (`SYNC_DRAIN_TIMEOUT_S`), exposes `prefetch_all`/`sync_all` (driving `syncTurn` via `syncAll`). No background memory fork touches the main session's prompt cache.

**Unified context FS (ragfs)** *(source: [OpenViking](../../OpenViking/) — architecture only, AGPL clean-room)* — one URI namespace over memory + skills + knowledge + files; uniform `list/read/grep` everywhere. `ContextSource` trait router + `StaticContextSource`. *(source: [mya-v1](../../mya-v1/) `mya-context-fs` already implements the skeleton.)*
- **Double-scan resolution (R25-18): ragfs is the authoritative scanner.** `scan-on-read` returns a typed `ScanVerdict`; the prompt assembler's `scanInject` ([§5 Prompt](04-prompt-compression.md)) defers to the ragfs verdict for ragfs-sourced files and only rescans direct-FS (non-ragfs) context files — no redundant double-scan.
- **`knowledge://<doc>` URI (R25-19):** a read-only `KnowledgeContextSource` over a `KnowledgeGraph`; writes stay on the `Knowledge` tool, not ragfs.

**Concrete memory interface (round 11 — R27-4 backend/role split + R27-18 drain durability):**
```ts
// R27-4: MemoryBackend = read/write STORE interface (SQLite/Markdown/Qdrant). Tree APIs (appendTreeLeaf,
//   …) live HERE so the archivist doesn't bypass the manager.
//   CC4/R28: a backend uses INTERNAL locking so concurrent reads/writes are safe; MemoryManager.syncAll
//   holds a `drainLock` that blocks prefetchAll until the drain completes or times out (no prefetch
//   races a draining shutdown).
interface MemoryBackend {
  read(query: MemoryQuery): Promise<MemoryHit[]>;
  write(entry: MemoryEntry): Promise<WriteResult>;        // R27-18/R27-20: typed result (Ok|Durable|Spilled|ResourceExhausted)
  durability: Durability;                                  // R27-18: BestEffort|Durable|DurableWithWal
  appendTreeLeaf?(path: string, md: string): Promise<WriteResult>;  // tree store API for archivist
}
// R27-4: MemoryRole = lifecycle ROLE interface. A role RECEIVES the canonical store handle and calls
//   role-specific ops THROUGH it (e.g. archivist syncTurn → store.appendTreeLeaf). Archivist/tree/
//   diff/goals/sync are MemoryRoles, NOT MemoryBackends.
interface MemoryRole {
  prefetch(store: MemoryBackend, query: MemoryQuery): Promise<void>;
  syncTurn(store: MemoryBackend, ctx: TurnContext): Promise<void>;
  systemPromptBlock(store: MemoryBackend): string;
}
interface MemoryManager {                  // the ONLY integration point the loop uses
  backends: MemoryBackend[];               // R27-4: stores
  roles: MemoryRole[];                     // R27-4: lifecycle roles
  prefetchAll(ctx: TurnContext): Promise<void>;   // CC4: blocks on drainLock if a syncAll drain is in flight
  snapshot(): MemorySnapshot;              // feeds the *volatile* prompt tier only
  // R27-18: syncAll returns a DrainReport; lost writes → health Degraded + persisted to a
  //   crash-recovery journal for replay on next boot. Durable writes fsync before the drain timer;
  //   a WAL/spill-file for the in-flight queue so a 5s-timeout write survives.
  syncAll(deadlineS = 5): Promise<DrainReport>;   // bounded shutdown drain; lostWrites.count → LaneBoard/health
  // one-external-provider rule: addBackend() refuses a 2nd external backend
}
// ragfs URI scheme:  memory://<role>/<id>   skill://<name>   knowledge://<doc>   file://<path>
//   — uniform list/read/grep via ContextSource; injection-scanned on read.
```

---

## Completeness (R35) — gbrain memory patterns

> Folded from [gbrain](../../gbrain/) (TS/Bun, PGLite/Postgres brain). The single most impactful upgrade to §8: replace flat `MemoryBackend/Role` with a richer page+chunk+facts+takes schema + push-based context + dream cycle.

| Pattern | 1-line | Source |
|---|---|---|
| **BrainEngine contract** | pluggable engine interface (PGLite local / Postgres managed); same SQL + operations across backends | [gbrain engine.ts](../../gbrain/src/core/engine.ts) |
| **Pages + chunks separation** | Page = compiled_truth + frontmatter + version history; Chunk = embedding + retrieval hits (enables per-chunk contextual retrieval) | [gbrain operations.ts](../../gbrain/src/core/operations.ts) |
| **Hot facts vs cold takes** | `facts(kind,visibility,notability,valid_from,valid_until,source_session)` hot conversation-extracted → dream cycle `consolidate` requires ≥3 facts per `(source,entity)` bucket, promotes clusters of ≥2 (cosine ≥0.85) → one `take`; facts marked `consolidated_at`+`consolidated_into`, never deleted | [gbrain cycle/consolidate.ts](../../gbrain/src/core/cycle/phases/consolidate.ts) · [takes-vs-facts.md](../../gbrain/docs/takes-vs-facts.md) |
| **Dream cycle** | 22-phase `ALL_PHASES`: lint → backlinks → sync → synthesize → extract → extract_facts → extract_atoms → resolve_symbol_edges → patterns → synthesize_concepts → **recompute_emotional_weight** → consolidate → propose_takes → grade_takes → calibration_profile → conversation_facts_backfill → enrich_thin → skillopt → embed → orphans → schema-suggest → purge (the ONLY reason a brain stays useful without decay) | [gbrain cycle.ts](../../gbrain/src/core/cycle.ts) |
| **Push-based context (reflex + volunteer)** | brain injects `## Brain pages mentioned this turn` block (default 3 pointer rows, hard cap 5, `min_confidence`=0.7) WITHOUT a tool call; agent told "open page before relying on details" | [gbrain context/](../../gbrain/src/core/context/) · [push-context.md](../../gbrain/docs/guides/push-context.md) |
| **Auto-link zero-LLM** | regex `[Name](path)` + `[[wikilink]]` + bare-name → typed knowledge graph (`links(from,to,link_type,link_source)`) on every write, zero token cost | [gbrain link-extraction.ts](../../gbrain/src/core/link-extraction.ts) |
| **4-arm RRF retrieval** | HNSW vector + BM25 keyword + relational (typed-edge walk) + graph_signal arms; merge via Reciprocal-Rank Fusion (k=60); per-arm confidence attribution | [gbrain search/hybrid.ts](../../gbrain/src/core/search/hybrid.ts) |
| **Mode bundles** | conservative / balanced / tokenmax bind cache + expansion + rerank + token_budget + graph_signals + autocut + relational + floor_ratio into one key | [gbrain search/mode.ts](../../gbrain/src/core/search/mode.ts) |
| **Cross-encoder rerank** | ZeroEntropy `zerank-2` post-dedup; fail-open with audit JSONL | [gbrain search/rerank.ts](../../gbrain/src/core/search/rerank.ts) |
| **Post-fusion boost stages** | composable, individually-disabled, floor-gated: backlink / salience / recency (per-prefix halflife) / title_phrase / graph_adjacency / alias_resolved / exact_match | [gbrain search/hybrid.ts](../../gbrain/src/core/search/hybrid.ts) |
| **Soft-delete + 72h TTL recovery** | `deleted_at` + `restore_page` + `purgeDeletedPages(72h)` — prevents silent loss | [gbrain engine.ts](../../gbrain/src/core/engine.ts) |
| **Per-page version snapshots** | `page_versions(compiled_truth,frontmatter,snapshot_at)` table; `createVersion` fires on explicit `revert_version` op (NOT auto on every `putPage`); enables audit + revert | [gbrain engine.ts](../../gbrain/src/core/engine.ts) · [operations.ts:2523](../../gbrain/src/core/operations.ts) |
| **Trust boundary first-class** | `OperationContext.remote: boolean` (REQUIRED) drives auto-link gating, fence-stripping, provenance stamping | [gbrain operations.ts](../../gbrain/src/core/operations.ts) |
| **Typed-claim trajectory** | `findTrajectory(entity)` returns chronological metric+event; regression detection `(newer-older)/older ≤ -0.10`; drift_score | [gbrain trajectory.ts](../../gbrain/src/core/trajectory.ts) |
| **Schema packs** | `page_type` taxonomy (gbrain-base.yaml = 27 types); 7-tier resolution chain: per-call opt → per-source DB key → brain DB key → `gbrain.yml` → `~/.gbrain/config.json` → default base pack | [gbrain schema-packs.md](../../gbrain/docs/architecture/schema-packs.md) |
| **Semantic query cache (knobs_hash)** | cache key folds resolved mode bundle so tokenmax write can't serve conservative read | [gbrain search/query-cache.ts](../../gbrain/src/core/search/query-cache.ts) |
| **Contextual retrieval at embed time** | `none|title|per_chunk_synopsis` wraps chunk with document-level orientation (Anthropic method) | [gbrain embedding-context.ts](../../gbrain/src/core/embedding-context.ts) |
| **Named-thing alias hop** | `page_aliases(normalizeAlias(name)→(source,slug))`; alias 0.9 / title 0.8 / slug-suffix 0.6 confidence | [gbrain search/hybrid.ts](../../gbrain/src/core/search/hybrid.ts) |

## R36 type glossary (gbrain reference patterns — Tier-1+)

> These types are referenced in the R35 table above. Declared here (Tier-1+; NOT Tier-0) so they are not orphans. Tier-0 memory uses the `MemoryBackend`/`MemoryRole` stub (§20).

```ts
interface BrainEngine { readonly kind: "pglite" | "postgres"; exec(sql: string, params: unknown[]): Promise<unknown[]> }   // pluggable backend
interface Page { id: string; compiled_truth: string; frontmatter: Record<string, unknown>; source_id: string; slug: string }
interface Chunk { id: string; pageId: string; embedding: number[]; chunk_source: string }
interface Fact { kind: "event"|"preference"|"commitment"|"belief"|"fact"; visibility: "private"|"world"; notability: number; valid_from?: number; valid_until?: number; source_session: string }
interface Take { id: string; sources: string[]; synthesized_at: number; text: string }
interface TrajectoryEntity { id: string; metrics: { at: number; value: number; source: string }[]; drift_score: number }
interface OperationContext { remote: boolean /* REQUIRED — trust boundary */; source: string; trust: "first-party"|"user"|"external" }
declare function findTrajectory(entity: string): Promise<TrajectoryEntity>;
declare function putPage(p: Page, ctx: OperationContext): Promise<void>;
declare function consolidate(): Promise<{ takesPromoted: number; factsConsumed: number }>;   // dream-cycle phase
```

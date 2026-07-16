# Memory Architecture & Management — Reference Catalog

**Lens correction**: The earlier synthesis (`memory-reference-study-synthesis.md`) framed each system as "what can mya borrow to fix its 7 bugs." That was the wrong lens. This doc re-reads the same ~12 systems as **architecture & management references** — how each one *structures, flows, governs, and manages* memory — independent of any consumer's bug list. The goal is to learn memory-system design patterns, not to patch mya.

**Systems**: mnemopi, agentmemory, gbrain, openclaw (4 exts), openhuman, mya-v1, codebase-memory-mcp, hermes (9 providers), headroom, OpenViking, pi-crew, Claude Code/Cursor/OpenCode/Devin.

---

## Theme 1 — How memory is STRUCTURED (tiers vs concerns vs flat)

There are 4 distinct structuring philosophies. This is the most important architectural decision.

### A. Tiered by lifecycle stage (consolidation pipeline)
Memory moves UP through tiers as it proves durable. Each tier = a processing stage.
- **mnemopi**: `working_memory` (hot) → `episodic_memory` (consolidated) → 3 degradation sub-tiers (tier 1/2/3 by age). Plus parallel typed tables (`memoria_facts`/`timelines`/`instructions`/`preferences`/`kg`). `scope` column (global/session/channel).
- **agentmemory**: 4 consolidation tiers — `working | episodic | semantic | procedural` (`types.ts:547`). Semantic needs ≥5 session summaries (LLM-merge); procedural needs ≥2 recurring patterns. A decay tier applies. Plus ~12 parallel "memory kinds" (Lesson/Crystal/Sketch/Sentinel/Checkpoint/Signal/MemorySlot...).
- **gbrain**: 4 tiers — L0 `facts` (hot, per-session/entity) → L1 `takes` (typed claims, multi-holder) → L2 `pages`+`compiled_truth` (curated) → L3 `content_chunks` (retrieval). **One-way bridge**: facts→takes `NEVER DELETE`.

### B. Concern-separated modules (NOT tiers — orthogonal responsibilities)
Each module owns a distinct concern; they compose side-by-side.
- **openclaw**: 4 extensions = 4 concerns — `active-memory` (working orchestrator, no storage) · `memory-core` (episodic, file-backed) · `memory-lancedb` (dense vector alt backend) · `memory-wiki` (durable knowledge vault). Backend selected via `plugins.slots.memory` slot.
- **openhuman**: 4 modules = 4 concerns — `memory_archivist` (chat→tree) · `memory_store` (persistence substrate) · `memory_sync` (upstream ingestion) · `memory_diff` (snapshot change-tracking). Only scoping = `namespace` string.

### C. Hierarchical by scope level (depth = persistence)
Memory lives at a scope depth; promotion moves it deeper (more persistent).
- **headroom**: 4 scope levels — `USER` (persistent) → `SESSION` → `AGENT` → `TURN` (ephemeral). **Bubbling**: importance ≥ 0.7 promotes session→user automatically. Budget per agent type (claude=2000, cursor=3000...).
- **pi-crew**: 2 levels — `.crew/knowledge.md` (cross-run, human-edited) + opt-in per-agent `MEMORY.md` (200-line cap). Radical: "No vector DB, no embeddings, no graph. Simple = trustworthy."

### D. Flat / single-store
- **hermes holographic**: flat `facts` table + category (`user_pref`/`project`/`tool`/`general`) + trust axis. No tiers.
- **Claude Code / Cursor / OpenCode**: no store at all — context window only (+ optional user-owned `CLAUDE.md`/transcripts).
- **Devin**: single append-only `AGENTS.md` file.

**Pattern insight**: tiered systems (A) optimize for *forgetting gracefully* (weak memory decays/demotes). Concern-separated (B) optimize for *swappability* (replace one concern without touching others). Hierarchical (C) optimizes for *promotion discipline* (what deserves to persist). Flat/radical (D) optimizes for *trustworthiness* (simple = auditable). **mya-v1 was tiered+port (A+engine); current mya is a half-tiered log.**

---

## Theme 2 — Data flow & lifecycle management

How a fact travels: capture → store → consolidate → recall → expire.

### Capture entry points (3 patterns)
- **Explicit tool only** — agentmemory `mem::remember` requires caller-supplied `type`. No regex/LLM at write. (Most disciplined.)
- **LLM extraction** — gbrain (Sonnet, strict-JSON, injection-sanitized); headroom (single-pass extraction with speaker attribution). (Most accurate, most expensive.)
- **Regex auto-capture** — mnemopi (70 patterns→14 types); mya; OpenViking triggers; hermes holographic session-end regex. (Cheapest, noisiest.)
- **Structural extraction** — codebase-memory-mcp (tree-sitter AST → nodes). Not conversational at all — captures the *codebase*. (Grounded by construction.)

### Consolidation / promotion (3 patterns)
- **Time + similarity clustering** — mnemopi `sleep()` groups unconsolidated working rows older than TTL/2, writes one episodic per source-group. gbrain consolidate: group by `(source_id, entity_slug)`, cosine ≥0.85, promote highest-confidence.
- **Signal-driven scoring** — openclaw `memory-core` tracks every `memory_search` hit (query/day/score), then `rankShortTermPromotionCandidates` weights frequency(0.24)+relevance(0.3)+diversity(0.15)+recency(0.15, 14-day halflife)+consolidation(0.1)+conceptual(0.06). **Promotion decided by observed usefulness, not age.**
- **Tier-gated threshold** — agentmemory semantic tier needs ≥5 summaries; procedural needs ≥2 patterns. Headroom bubbling at importance≥0.7.

### Recall assembly
- **agentmemory** `working-context`: token-budgeted block scored `importance*0.5 + recency*0.3 + access*0.2`.
- **gbrain**: `compiled_truth` per page (synthesized canonical) — recall returns the *compiled* version, not raw facts.
- **openclaw active-memory**: blocking pre-reply recall via LLM sub-agent with circuit breaker + cache + timeout (degrades gracefully on failure).

### Expiry / retention (3 patterns) — THE management crux
- **TTL-at-capture** — agentmemory `forgetAfter = now + ttlDays`; openclaw wiki freshness labels (fresh<30d/aging<90d/stale).
- **Score-threshold DELETE** — agentmemory `retention-evict` (score = salience(type)·e^(-λ·age) + σ·Σ1/daysSinceAccess, hard-DELETE below `cold`); openhuman profile facets (Active/Provisional/Candidate/Dropped→DELETE, `pinned` protected); headroom budget (importance×recency×access + git-staleness).
- **Never-delete (audit-forever)** — gbrain facts/takes `NEVER DELETE` (audit trail); mnemopi episodic (degradation only, **same gap as mya**); codebase-memory-mcp (recompute-on-reindex, delete only on source-gone 10min grace).

**Pattern insight**: the mature systems separate **3 retention concerns**: (1) working/short-term = TTL or LRU cap (cheap, aggressive); (2) profile/belief = score-threshold DELETE with pin protection (curated); (3) audit/legal = never-delete carve-out. mya conflates all 3 into one append-log with cosmetic degradation.

---

## Theme 3 — Storage engine & abstraction (the architecture layer)

How the storage is abstracted so consumers don't couple to a backend.

### Engine abstraction (deployment knob)
- **gbrain** `BrainEngine` interface: `readonly kind: 'postgres' | 'pglite'`. Same SQL (PGLite IS Postgres 17 WASM). Consumers never branch on engine. **Concurrency is a deployment choice, not an architecture rewrite.** Migration threshold: >50K pages or multi-user → Postgres.
- **headroom** hexagonal: 6 `@runtime_checkable` port Protocols — `MemoryStore | VectorIndex | TextIndex | Embedder | MemoryCache | GraphStore`. `LocalBackend` (SQLite+sqlite-vec+FTS5+SQLiteGraph) vs `DirectMem0Adapter` (Qdrant+Neo4j). Zero-config local default, production external.

### Plugin provider (swap whole backend)
- **hermes**: `MemoryProvider` ABC, 9 bundled providers (byterover/hindsight/holographic/honcho/mem0/openviking/retaindb/supermemory). ONE active at a time via `memory.provider` config. Plugin discovery scans dirs.

### Port traits
- **mya-v1**: Rust `Memory` trait (prefetch/sync_turn/get_tool_schemas/handle_tool_call/on_session_end) + `AgentScopedMemory` wrapper enforcing agent_id scoping.

### Read/write split (single-writer discipline)
- **codebase-memory-mcp**: query handles open `SQLITE_OPEN_READONLY` (skip mutating pragmas); the ONE writer (indexer) opens read-write. `manage_adr` opens a *dedicated* RW handle to the verified DB. Readers never take the WAL.

**Pattern insight**: every serious system abstracts storage behind an interface/trait/protocol so the backend is swappable. mya couples consumers directly to SQLite — that's why "add Postgres" would be an architecture rewrite for mya but a config flip for gbrain.

---

## Theme 4 — Isolation / scoping axis

The single most consequential management decision: **what is the unit of isolation?**

| System | Isolation axis | Why |
|---|---|---|
| gbrain | `source_id` (a repo inside a brain) | multi-source federation; no owner/agent |
| openhuman | `namespace` string (per-integration) | upstream sources (gmail/slack/github) |
| mya-v1 | `agent_id` + `namespace` + `tenant_id` | multi-agent + multi-tenant |
| headroom | 4 scope levels (USER/SESSION/AGENT/TURN) | hierarchical persistence |
| codebase-memory-mcp | `project` (one DB file) | per-codebase |
| agentmemory | `agentId` tag + opt-in `isolated` mode | shared-default, isolate-opt-in |
| pi-crew | run-scoped state dir + worktree | per-run isolation, no cross-run brain |
| Claude Code | none (session-bound, fresh per spawn) | no persistence = no isolation needed |

**Pattern insight**: the isolation axis determines what "multi-X" means. gbrain = multi-source. mya-v1 = multi-agent+tenant. agentmemory = multi-agent-opt-in. **The axis is chosen FIRST; everything else follows.** mya-current has no isolation axis (global brain) → can't express multi-anything.

---

## Theme 5 — Governance: trust, authority, conflict

How systems decide what's believable and resolve disagreement.

### Trust scoring (feedback-driven)
- **hermes holographic**: trust [0,1], deltas +0.05 (helpful)/-0.10 (unhelpful). Retrieval `score = relevance × trust_score`. **Contradiction detection**: facts sharing entities with divergent content vectors. Self-described "no other memory system does this."

### Bayesian confidence (source-weighted)
- **mnemopi** `VeracityConsolidator`: `bayesianUpdate` per mention weighted by `VERACITY_WEIGHTS` (stated=1.0/inferred=0.7/tool=0.5/imported=0.6). Auto `recordConflict` on (s,p,o) clash; resolve by confidence or explicit `resolveConflict(winner)`.

### Temporal supersession (belief revision)
- **mnemopi triples** + **headroom**: bitemporal `valid_from`/`valid_until`. Supersede = close old's valid_until + insert new. Point-in-time "as-of" queries. Old version kept (audit), not deleted.
- **mya-v1** `conflict.rs`: cosine/jaccard conflict detect → `superseded_by` column. (current mya dropped this.)

### Provenance taint (trust-by-origin)
- **openhuman** `MemoryTaint` (Internal/ExternalSync) flows through entire recall path → callers gate on origin. Synced-from-upstream memories escalated differently than self-captured.

### Holder/authority column
- **gbrain**: `holder` on takes (who believes: `people/X`, `world`, `brain`). RLS at DB layer for multi-user. No belief-layer authority.

### Deliberately weak / human-in-loop
- **gbrain**: NO auto TMS. `compiled_truth` + recency + active-flag + **human-runs-the-contradiction-probe**. Evidence a working system doesn't NEED full TMS.

**Pattern insight**: 3 philosophies — (a) score it (trust/Bayesian), (b) time-stamp it (bitemporal supersede), (c) don't let it conflict (human-in-loop / recompute). mya-current does NONE — it's a log with no governance.

---

## Theme 6 — Grounding (link symbols to referents)

### Grounded-by-construction
- **codebase-memory-mcp**: every node = `file_path`+`start_line`+`end_line`+`qualified_name`. **`file_hashes` table** (sha256+mtime+size) → `metadata_match`/`metadata_changed` is re-verification + self-expiry in one primitive. The only system that RE-CHECKS reality.
- **openclaw memory-core**: short-term recall entries = `path`+`startLine`+`endLine` + `fs.stat` re-verify before use.
- **headroom**: `entity_refs` + budget manager `staleness_check_git` (file-existence, maintenance sweep not on-read).

### Provenance-only (trust-on-write)
- mnemopi (`source_memory_id`), agentmemory (`files[]`/`concepts[]` from LLM compressor), gbrain (`entity_slug`→page; unresolved fall to legacy bucket), openhuman (`source_ref` permalink). **None re-verify.**

**Pattern insight**: ONLY codebase-memory-mcp and openclaw memory-core actually re-verify against reality. Everyone else is trust-on-write + TTL. Grounding is the rarest, hardest feature — and the one most memory systems punt on.

---

## Theme 7 — Concurrency model

| System | Model | Multi-writer? |
|---|---|---|
| gbrain (Postgres) | MVCC + `FOR UPDATE SKIP LOCKED` job queue + row-TTL locks surviving PgBouncer + `pg_advisory_lock(42)` for DDL | ✅ true parallel writers |
| gbrain (PGLite) | single-writer file lock, no-steal (#2348 lesson) | ❌ single process |
| agentmemory | server-side KV (iii state) + in-process `withKeyedLock` per-key | ✅ delegated to platform |
| mnemopi / mya / openhuman / hermes / headroom | SQLite WAL + busy_timeout + Mutex/RLock | ❌ single writer, readers concurrent |
| codebase-memory-mcp | SQLite WAL, agents READ-ONLY, single indexer writes | ❌ but no contention (read/write split) |
| pi-crew | file locks + worktree isolation + single-writer ownership gate | ❌ avoided by design |

**Pattern insight**: only gbrain-Postgres and agentmemory (platform-backed) support true concurrent writers. Everyone else either (a) is single-process, or (b) **eliminates contention by making agents read-only** (codebase-memory-mcp, pi-crew). The latter is the dominant pattern — **don't solve concurrent writes, eliminate them.**

---

## Cross-system architecture lessons (the actual reference value)

1. **Structure follows isolation axis** — pick the scoping unit (source/namespace/agent/project/run) FIRST; tier/concern/hierarchy design follows.
2. **Abstract storage behind a port/engine** — every mature system does; mya doesn't (couples to SQLite).
3. **Separate 3 retention concerns** — working(TTL/LRU) vs belief(score-threshold+pin) vs audit(never-delete). Don't conflate.
4. **Eliminate concurrent writes over solving them** — read-only agents + single writer (codebase-memory-mcp, pi-crew) beats locks-on-beliefs.
5. **Grounding is rare and worth it** — only 2 systems re-verify reality; both use a content-hash + referent pattern.
6. **Governance has 3 valid philosophies** — score-it / time-stamp-it / don't-let-it-conflict. Pick one explicitly; mya picked none.
7. **Radical simplification is a legitimate architecture** — pi-crew (1 file) and Devin (append AGENTS.md) ship working systems with zero memory infra. "Simple = trustworthy" is a real design choice, not a cop-out.
8. **Engine-as-deployment-knob** (gbrain) lets you start simple (PGLite/SQLite) and scale (Postgres) without consumer rewrites — the single most portable architectural idea.

---

## Where deeper re-reads would help

This catalog is built from the round-1/round-2 agent reports (which were bug-fixation-framed) + direct mya-v1 read. For pure architecture/management depth, these would benefit from a re-read with the corrected lens:
- **gbrain** cycle.ts phase orchestration (the dream-cycle phase machine) — how phases compose, failure handling
- **headroom** port/adapter wiring (the hexagonal contracts in full) — how a memory *library* is structured for embedding
- **mya-v1** full trait surface + how agent_scoped enforced isolation (the predecessor's complete architecture, not just conflict.rs)

If the user wants any of these deepened, they're focused single-system reads with the architecture lens.

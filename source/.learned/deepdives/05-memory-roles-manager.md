# Deep-dive: Memory roles + MemoryManager → port to mya

> Sources: openhuman `src/openhuman/memory_*` modules (13 modules — reimplement, license check before cross-crate) + hermes-agent `agent/memory_manager.py` (MIT — reimplement). mya integration design.

## Source design

### openhuman — the "memory empire" as named roles
13 top-level `memory_*` modules; pattern = **one role = one module = thin wrapper composing canonical storage (`memory_store` trait impl) with role-specific transforms**. Cross-cutting invariants: (a) sources-of-truth delegated not duplicated (`memory_graph` derives edges FROM tree entity index; `memory_diff` builds snapshots FROM `mem_tree_chunks`; `memory_sync` writes ONLY into `memory_store`); (b) one role one trait (`SyncPipeline`, `SourceReader`, `ObsidianRepresentable`/`VectorEmbeddable`); (c) namespacing is isolation primitive (`taint` Internal/ExternalSync, `namespace`, `MemoryKind`).

| Role | Module | Kind | Responsibility |
|---|---|---|---|
| **Archivist** | `memory_archivist` | partial | Clip tool-call noise from chat turn, compose to md, append as single leaf to memory tree |
| **Tree** | `memory_tree` | partial | Generic summary-tree engine: bucket-seal cascade, scoring, embedding, entity extraction, retrieval, summarisation (engine only; policy instances under `memory/`) |
| **Diff** | `memory_diff` | partial | Snapshot-based change tracking over `mem_tree_chunks`; git-backed ledger at `<workspace>/memory_diff/repo`; diffs are tree-diffs of chunk store, not re-reads |
| **Goals** | `memory_goals` | partial | Compact durable `MEMORY_GOALS.md` (200-500 tok) of user goals, mutated explicitly OR by turn-based reflection agent (`goals_agent`) on summary context |
| **Sync** | `memory_sync` | novel | Multi-upstream ingest: Composio (managed)/Workspace (local)/MCP (third-party) — each implements `SyncPipeline`; writes only into `memory_store` |
| **Graph** | `memory_graph` | partial | Co-occurrence edges derived ON-DEMAND from tree entity index; no separate triple store |
| **Conversations** | `memory_conversations` | partial | UI thread persistence: JSONL threads+messages under `<workspace>/memory/conversations/` + subscription bus |
| **Search** | `memory_search` | partial | Consolidated agent-facing retrieval: `MemoryHybridSearchTool`/`VectorSearchTool`/`StoreRawSearchTool`/`ChunkContextTool`/`StoreKindsTool` |
| **Sources** | `memory_sources` | novel | Registry of data connectors (Composio OAuth/local folders/GitHub/RSS/Twitter/web); CRUD + `SourceReader` trait |
| **Entities** | `memory_entities` | partial | Obsidian-md-backed people/handle/topic registry at `<content_root>/entities/<kind>/<id>.md` |
| **Store** | `memory_store` | existing | Persistent substrate: `UnifiedMemory` (SQLite+FTS5+vector), `Memory` trait, factories, `MemoryClient`, `MemoryKind`, event log |
| **Tools** | `memory_tools` | partial | Per-tool memory namespace `tool-{tool_name}` for actionable guidance |
| **Queue** | `memory_queue` | partial | Async SQLite-backed job pipeline (extract_chunk/append_buffer/seal/topic_route/digest_daily/flush_stale) |

### hermes — the single integration point
**One orchestrator owns all memory state**: `MemoryManager` (`agent/memory_manager.py`); agent loop NEVER calls providers directly.
- `add_provider` — builtin always wins; **only ONE external provider** (second rejected — prevents tool-schema bloat + conflicting backends); core tool names reserved (shadow → rejected #40466).
- `build_system_prompt` — collect `system_prompt_block()` from every provider, merge.
- `prefetch_all(query,session_id)` — pre-turn inline.
- `sync_all(user,assistant,session_id,messages)` — post-turn, **single-worker daemon ThreadPoolExecutor** (wedged provider never blocks turn; serializes writes turn N before N+1).
- `queue_prefetch_all` — background prefetch warm cache for next turn.
- `flush_pending(timeout)` — barrier for tests/session boundaries.
- `on_turn_start/on_session_end/on_session_switch/on_pre_compress/on_memory_write/on_delegation` — fan-out lifecycle hooks, failures isolated.
- `shutdown_all` — reverse-order teardown, **drains executor bounded by `_SYNC_DRAIN_TIMEOUT_S = 5.0`** (file:42-46, 1004-1029); daemon threads die with interpreter if drain times out — **wedged provider never blocks process exit**.
**Two maxims**: (a) one place owns state, everything else is a provider; (b) bounded shutdown non-negotiable (agent loop on call path of every interface).

## mya today — same fragmentation, no uniform surface
### Trait + backends (`crates/mya-memory/src/`)
- `Memory` trait (~25 async methods) + `MemoryStrategy{load_context,consolidate_turn,run_governance}` in `crates/mya-api/src/memory_traits.rs`. Types: `MemoryEntry`, `MemoryCategory{Core,Daily,Conversation,Custom}`, `MemoryKind{Episodic,Semantic,Procedural}`, `StoreOptions`.
- 7 backends + 2 wrappers: `SqliteMemory`, `LucidMemory`, `PostgresMemory`(feat), `QdrantMemory`, `MarkdownMemory`, `NoneMemory`, `AgentScopedMemory`, `AgentScopedMarkdownMemory`. `MemoryBackendKind`. Factories `create_memory*`.
- **Processing pipeline** (free functions, not roles): `consolidation`, `merge`, `retrieval` (cache→FTS→vector), `decay` (exp half-life, Core-exempt), `dedup`, `importance`, `budget`, `chunker`, `conflict`, `hygiene` (12h throttled), `snapshot`, `response_cache`, `policy_gate`, `audit`, `embeddings`, `knowledge_graph` (separate SQLite graph).

### Context loading (`crates/mya-runtime/src/agent/`)
`memory_loader.rs` (`MemoryLoader` trait + `DefaultMemoryLoader` — wraps `&dyn Memory`, `recall`+`decay`+drop autosave+format sentinels, emits `ObserverEvent::MemoryRecall`). `memory_strategy.rs` (`DefaultMemoryStrategy` — load_context→DefaultMemoryLoader, consolidate_turn→`mya_memory::consolidation`, run_governance→`hygiene::run_if_due`). Wired in `agent.rs:325` (`memory_strategy: Arc<dyn MemoryStrategy>`), set `agent.rs:605`, default `agent.rs:1806-1807`, called `agent.rs:2290`.

### Roles exist vs missing
| openhuman role | mya | Gap |
|---|---|---|
| Store | ✅ 7 backends + Memory trait + factories | parity |
| Tree | 🟡 `knowledge_graph.rs` closest but typed node-edge store, not summary-bucket tree | no bucket-seal cascade, no L0/L1/L2 |
| Archivist | 🟡 `consolidation::consolidate_turn` extracts history_entry+memory_update, doesn't persist to tree | no chat→tree leaf; tool-call stripping partial |
| Diff | ❌ none | no snapshot ledger/checkpoints/diff tool |
| Goals | 🟡 system prompt+memory capture goals informally | no structured list/reflection enrichment |
| Sync | ❌ none (consolidation per-turn, not external sources) | no Composio/MCP/Workspace ingest |
| Graph | 🟡 `knowledge_graph.rs` hand-managed edge table | no entity extraction/co-occurrence-on-demand |
| Conversations | ❌ none in mya-memory (UI thread persistence elsewhere) | no JSONL thread store + bus |
| Search | 🟡 `retrieval::RetrievalPipeline` engine exists | no agent-facing search TOOLS surface |
| Sources | ❌ none | no data-connector registry |
| Entities | ❌ none | no people/topic registry |
| Tools | 🟡 namespacing exists (`namespace` field) | no per-tool `tool-{name}` namespace + capture hook |
| Queue | ❌ none (`consolidate_turn` inline or fire-and-forget mya_spawn) | no SQLite job queue |
| **MemoryManager** | ❌ no single integration point | 3 call sites touch memory (recall/autosave/consolidate), no fan-out, no shutdown drain |

**Fragmentation symptoms**: 3 call sites no orchestration object; inline sync no backpressure (wedged embedding blocks daemon exit — the bug hermes fixed w/ 5s timeout); no provider-fan-out policy (one `Memory` handle consumed as single object); role-shaped code lives in pipeline not named modules (can't ask "what does diff role do?"); no background sync drain (`mya_spawn::spawn!` tasks dropped at Ctrl-C).

## Proposed design for mya — **additive**: keep Memory trait + 7 backends + pipeline; promote valuable roles to named modules; add `MemoryManager` orchestrator; bind pipeline helpers via role interfaces. **No duplicate state** — every role resolves from canonical `Arc<dyn Memory>` on demand.

### Crate placement
- `crates/mya-memory/src/roles/{mod,archivist,tree,diff,goals,sync,graph}.rs` (new) — role impls
- `crates/mya-runtime/src/memory_manager.rs` (new) — `MemoryManager` orchestrator
- `crates/mya-api/src/memory_traits.rs` (additive) — `MemoryRole` trait + 3 new `Memory` methods w/ safe defaults

### `MemoryRole` trait (real signature)
```rust
#[async_trait] pub trait MemoryRole: Send + Sync {
    fn name(&self) -> &str;   // "builtin"|"archivist"|"tree"|… — builtin always coexists w/ ≤1 external
    async fn prefetch(&self, memory:&dyn Memory, query:&str, session_id:Option<&str>) -> Result<Option<String>>;
    async fn sync_turn(&self, memory:&dyn Memory, user:&str, assistant:&str, session_id:Option<&str>, messages:Option<&[ConversationMessage]>) -> Result<()>;
    async fn system_prompt_block(&self, memory:&dyn Memory) -> Result<Option<String>>;
    async fn on_turn_start(&self, _n:usize, _m:&str) -> Result<()> { Ok(()) }
    async fn on_session_end(&self, _m:&[ConversationMessage]) -> Result<()> { Ok(()) }
    async fn shutdown(&self) -> Result<()> { Ok(()) }
}
```
Roles are NOT backends — close over `&dyn Memory`/`Arc<dyn Memory>` at call time, never hold parallel cache. **SSOT: roles are views, not stores.**

### `MemoryManager` (real signature)
```rust
pub const SYNC_DRAIN_TIMEOUT_S: f64 = 5.0;   // mirrors hermes
pub struct MemoryManager {
    builtin_roles: Vec<Arc<dyn MemoryRole>>,
    external_role: Option<Arc<dyn MemoryRole>>,   // one-external-role rule
    sync_executor: Option<tokio::sync::Mutex<()>>,   // single-worker → serializes writes
    drain_notify: Arc<tokio::sync::Notify>,
}
impl MemoryManager {
    pub fn new() -> Self;
    pub fn add_role(&mut self, role: Arc<dyn MemoryRole>);   // builtin coexist; 2nd external logged+dropped
    pub async fn build_system_prompt(&self, memory:&dyn Memory) -> String;
    pub async fn prefetch_all(&self, memory:&dyn Memory, query:&str, session_id:Option<&str>) -> String;   // inline pre-turn
    pub fn sync_all(&self, memory:Arc<dyn Memory>, user:String, assistant:String, session_id:Option<String>, messages:Option<Vec<ConversationMessage>>);   // background post-turn
    pub fn queue_prefetch_all(&self, memory:Arc<dyn Memory>, query:String, session_id:Option<String>);   // warm next-turn cache
    pub async fn flush_pending(&self, timeout:Option<Duration>) -> bool;   // barrier
    pub async fn on_turn_start(&self, n:usize, m:&str); pub async fn on_session_end(&self, m:&[ConversationMessage]);
    pub async fn shutdown(&self);   // bounded drain, never blocks process exit
}
```

### Adopting openhuman roles — Priority 1 (initial port, all on-demand views, no duplicate state)
- `ArchivistRole` (`roles/archivist.rs`): `sync_turn` = clip (strip `[media]`+tool-call JSON) → compose (single md blob/turn) → `memory.append_tree_leaf(label,"turn",blob,sid)`. prefetch/prompt/shutdown = no-ops.
- `TreeRole` (`roles/tree.rs`): `prefetch` = `memory.recall_trees(label,query,5,sid)` (new trait method, default composes from `recall_namespaced`+`namespace "tree:<label>"`; SqliteMemory overrides w/ FTS5 tree table). bucket-seal cascade config from `[memory.tree]`.
- `DiffRole` (`roles/diff.rs`): `sync_turn` = `memory.snapshot_chunks()` → `SnapshotLedger.commit` (initial `Vec<Snapshot>` JSONL; later git-backed). `system_prompt_block` = last summary.
- `GoalsRole` (`roles/goals.rs`): `sync_turn` = reflection sub-call via MemoryManager (best-effort on summary); writes canonical store namespace "goals" (+ optional derived `MEMORY_GOALS.md` file = view of namespace).
- `GraphRole` (`roles/graph.rs`): `prefetch` = `memory.co_occurring_entities(query,10,sid)` (on-demand, walks tree entity index, no edges table).
- **Deferred (P2/P3)**: ConversationsRole (if mya-channels doesn't own it), SearchRole (agent-facing tools), SourcesRole+EntitiesRole (after SyncRole), ToolsRole (per-tool namespace + `crates/mya-tools` PostTurnHook), QueueRole (subsumed by manager executor for now).

### Composing with existing pipeline (wraps, doesn't replace)
- `consolidation::consolidate_turn` → `BuiltinRole` (`name()=="builtin"`, always present); LLM extraction keeps fire-and-forget but through manager's bounded executor.
- `decay/retrieval/hygiene/merge/dedup/importance/budget/chunker/conflict/snapshot/response_cache/policy_gate/audit/embeddings` — **unchanged**; `BuiltinRole::prefetch` calls them in existing order, `BuiltinRole::sync_turn` calls consolidate_turn+decay+hygiene(throttled).
- `DefaultMemoryStrategy` → deprecated 1-line forwarder to `MemoryManager::prefetch_all/sync_all` (preserves `MemoryStrategy` trait for external callers — channels/eval/gateway).
- `DefaultMemoryLoader` → internal helper of `BuiltinRole`; public `MemoryLoader` trait kept (back-compat).
- **`Memory` trait unchanged**; 7 backends + factories unchanged; agent wiring (`agent.rs:325,605,2290`) → construct `MemoryManager` once, delegate.

### SSOT — no duplicate state
Roles = views over canonical `Arc<dyn Memory>`: Archivist writes same chunk store; Tree reads via new `Memory::recall_trees` (default composes, no cache); Diff keeps derived git/JSONL ledger (explicitly derived view, chunks authoritative); Graph walks entity index on-demand (no edges table); Goals writes canonical store namespace "goals" (file = derived view); **MemoryManager holds ZERO cached rows/embeddings/sync state** — only role handles + executor + Notify.

## Integration points
| Crate | Change |
|---|---|
| `mya-memory` | `roles/` module + 5 P1 role impls; new `Memory::{recall_trees, co_occurring_entities, snapshot_chunks}` w/ safe default impls (backends opt in incrementally) |
| `mya-runtime` | `memory_manager.rs` (`MemoryManager` + `SYNC_DRAIN_TIMEOUT_S`); wire `agent.rs` construct manager once, `prefetch_all` pre-turn, `sync_all` post-turn, `shutdown()` on drop |
| `mya-api` | add `MemoryRole` trait (additive); re-export `mya_memory::roles` |
| `mya-runtime/src/agent/memory_strategy.rs` | `DefaultMemoryStrategy` → thin wrapper over manager (deprecation cycle) |
| `mya-runtime/src/agent/memory_loader.rs` | `DefaultMemoryLoader` → internal to `BuiltinRole`; public trait kept |

Config (additive): `[memory.manager] sync_drain_timeout_s=5.0, one_external_role=true`; `[memory.roles.{archivist,tree,diff,goals,graph,sync}]` (enabled/params). **Breaking changes: NONE** (Memory trait gains 3 methods w/ safe defaults; MemoryStrategy trait unchanged; factories unchanged; AgentBuilder unchanged internally wrapping manager).

## Migration / implementation steps (PR-sized, additive; size:S/XS)
**Phase 0 scaffolding 🟢 (~1 PR)**: `MemoryRole` trait in mya-api + `roles/mod.rs`; `memory_manager.rs` skeleton (add_role/prefetch_all/sync_all inline/shutdown); no roles registered; existing paths untouched.
**Phase 1 BuiltinRole + bounded executor 🟢 (~2 PRs)**: `BuiltinRole` wraps DefaultMemoryStrategy 3 responsibilities; register as "builtin"; bounded tokio single-worker + `SYNC_DRAIN_TIMEOUT_S` drain; wire `shutdown` into agent Drop; update `agent.rs:2290` to `manager.prefetch_all`; verify byte-for-byte (same recall/consolidation/hygiene cadence); config schema `[memory.manager]`+`[memory.roles.*]`.
**Phase 2 Archivist + Tree 🟡 (~3 PRs)**: ArchivistRole (clip→compose→`append_tree_leaf` new trait method, default composes from store namespace); TreeRole (bucket-seal cascade on-demand read via `recall_trees`); wire both default + `[memory.roles.{archivist,tree}].enabled` opt-out; integration tests (archivist writes leaf → tree next-turn prefetch surfaces it).
**Phase 3 Diff + Goals 🟡 (~2 PRs)**: DiffRole (snapshot ledger, initial `Vec<Snapshot>` JSONL, later git); `snapshot_chunks` trait method; GoalsRole (reflection sub-call on `on_pre_compress`, `reflection_agent` config).
**Phase 4 Graph + Sync 🔴 (~3+ PRs)**: GraphRole (on-demand co-occurrence, `co_occurring_entities`, needs entity extraction); SyncRole (`SyncPipeline` trait + Workspace adapter first, Composio+MCP later); `ingest_sync_payload` seam. (Conversations/Search/Sources/Entities/Tools/Queue deferred.)
**Phase 5 observability 🟢 ongoing**: per-role `ObserverEvent::MemoryRoleXxx`; per-role recall/sync counters (query canonical store on-demand, no caching); mya-eval e2e replay asserts archivist-leaf/tree-surface/diff-snapshot/goals-reflection/shutdown-drain-5s.

## Effort & risk — 🔴 overall (6-10 weeks one engineer; most value in Phases 0-1)
- Trait stability 🟢 (3 new Memory methods w/ safe defaults; backends override incrementally).
- **SSOT 🟢** — roles resolve canonical backends on-demand; manager caches nothing.
- Bounded shutdown vs existing `mya_spawn::spawn!` fire-and-forget 🟡 — audit `loop_.rs:store_result` + other spawn sites so no inline sync blocks shutdown.
- Reflection sub-call (GoalsRole) 🟡 — must be best-effort + bounded (fail-closed log-loudly like openhuman `enrich::spawn_enrich_goals`).
- Multi-backend fan-out 🟡 — role fans out across ROLES not backends; document distinction; handle `AgentScopedMemory` wrapping `SqliteMemory` composite.
- License check 🟡 — **reimplement never vendor** openhuman modules; verify `@docs/maintainers/audit-policy.md` + dep allowlist before cross-crate.
- One-external-role rule 🟡 — WASM plugins (P4+) register ≤1 custom role; document in plugin SDK.
- 3 new Memory methods 🟡 — audit all 7 backends + AgentScoped wrappers in Phase 0 (none panic in default path).
- No unsafe 🟢; fl!() 🟢; no duplicate state 🟢.

## Open questions
1. Snapshot ledger backing — git (`git2`) vs plain JSONL vs SQLite WAL? → **JSONL P3**, git only if cross-process diff queries needed.
2. Tree summarise or reuse consolidation? → **reuse** `consolidation`'s `memory_update` as leaf content (avoid duplicate LLM calls).
3. External role lifecycle — `AgentBuilder::external_role(Arc<dyn MemoryRole>)` setter; WASM plugins too? → **both**, gated by one-external-role rule.
4. Goals — `MEMORY_GOALS.md` file vs namespace vs both? → **both** (file = derived view of namespace, SSOT holds, grep parity).
5. Sync scope — ship trait + Workspace first (lowest), defer Composio+MCP until consumer? → **yes**, trait is durable artifact.
6. `MemoryManager` + multi-agent isolation — DiffRole snapshot cross-session or bound? → **bound default** (`memory.roles.diff.agent_scope="bound"|"all"`) to match AgentScopedMemory posture.
7. `shutdown` integration — Agent Drop vs SIGTERM vs both? → **both** (Drop 5s safety net, SIGTERM primary longer drain).
8. `DefaultMemoryStrategy` fate — forwarder one release then remove? → **forwarder 1 release, then migrate all callers**.

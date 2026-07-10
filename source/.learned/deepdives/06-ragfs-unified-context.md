# Deep-dive: Unified context filesystem → port to mya

> ⚠️ **OpenViking is AGPLv3** (`source/OpenViking/LICENSE`; README:861-867 — only `crates/ov_cli`/`examples`/`third_party` are Apache-2.0). mya is permissively licensed → **cannot vendor AGPLv3 code**. This is a **clean-room design informed by the concept only** (mount/read/list/grep/tree); all signatures/names below are original. New crate ships Apache-2.0 SPDX headers + clean-room notice.

## Source concept (OpenViking ragfs)
"Context Database for AI Agents" built on a **filesystem paradigm** unifying memories/resources/skills under one virtual URI space (`viking://`). Problem it names = mya's problem: *"Fragmented Context: Memories are in code, resources are in vector databases, skills are scattered"* (README:40).

**FS metaphor** (`crates/ragfs/src/core/filesystem.rs:96-396`): `FileSystem` trait with `read/write/read_dir/stat/mkdir/create/remove/rename/replace/chmod/truncate/ensure_parent_dirs/grep/tree_directory`. `MountableFS` (`core/mountable.rs:96-300`) = router (radix trie of `MountInfo` → dispatch to underlying `FileSystem`). Backends ("plugins") in `plugins/{memfs,localfs,kvfs,queuefs,sqlfs,s3fs,serverinfofs}/` — the FS metaphor is intentionally over-applied (MemFS=in-memory map, KVFS=key-value, QueueFS=queue) so retrieval/tooling are uniform.

| FS verb | agent meaning | example |
|---|---|---|
| mount | bind backend at path | `viking://resources` ← localfs over dir |
| read | one entry's content | `read("viking://resources/foo/.overview")` |
| list | enumerate dir | `ls("viking://resources/")` |
| tree | recursive listing (depth+node limits) | `tree(..., level_limit=2)` |
| grep | regex across files (exclude_path, level_limit) | `grep("foo", pattern, recursive=true)` |

**Tiered context L0/L1/L2** (README:744-759): auto-derived per directory as ordinary files — `.abstract` (~100 tok, L0 cheap relevance), `.overview` (~2k tok, L1 planning), full content (L2 on-demand). Tiering is a *protocol* on file naming, not a separate API.

**Pluggable cache-tier** (`cache/provider.rs:18-90`): `CacheProvider{get,put,delete,exists,batch_get/batch_put,invalidate,flush,close}` + `CachePolicy` (`policy.rs:1-200`) returning `CacheDecision::{Bypass,Cache,Prefer}` per call (size/dir-entry-count/path-bypass/`.abstract`+`.overview` prefer). `CachedFileSystem` wrapper. Redis/Mooncake/Yuanrong adapters fulfill same trait.

## mya today — same fragmentation, no uniform surface
- **Memory**: `Memory` trait (`crates/mya-api/src/memory_traits.rs:208-310`) ~25 async methods + `MemoryStrategy`. 7+ backends each own API: `SqliteMemory` (FTS5+vector), `MarkdownMemory` (`MEMORY.md`+`memory/YYYY-MM-DD.md`), `QdrantMemory`, `PostgresMemory`, `LucidMemory`, `NoneMemory`, `AgentScoped*` wrappers. `MemoryBackendKind` enum; `create_memory*` factories (`lib.rs:510-759`).
- **Memory → context**: 3 call sites all consume `Memory` handle directly — `build_context` (loop_.rs:739), `DefaultMemoryLoader::load_context` (memory_loader.rs:11-120), `DefaultMemoryStrategy` (memory_strategy.rs:78-95). Channels cap `MEMORY_CONTEXT_MAX_ENTRIES=4`/`MAX_CHARS=4000`.
- **Skills**: file-backed, 4-source union — `load_skills_for_agent_from_config` (skills/mod.rs:656) merges workspace + open-skills + plugin + `[skill_bundles]`. `ReadSkillTool` exposes one by name. Read at prompt-compile, not navigated at runtime.
- **Knowledge graph**: SEPARATE — `KnowledgeGraph` (knowledge_graph.rs:1-130) + `KnowledgeTool` (10 actions). Not in `Memory`, not reachable from memory loader.
- **Workspace tools**: shell-level only — `ContentSearchTool` (ripgrep), `GlobSearchTool`, `MemoryRecallTool` — **cannot cross memory→skill→knowledge in one call**. No `ls memory://` / `grep skill://auth`.
- **Fragmentation concretely**: no uniform address space; per-source tool surface; per-backend recall semantics; no cross-source directory recursion.

## Proposed design for mya
**SSOT statement (AGENTS.md pre-edit ritual):** `ContextFs` is **a view over canonical sources** (the `Memory` backend, live skill resolver, live knowledge graph) — **not a parallel store**. No entry materialized ahead of read; resolver trait returns owned entries by calling canonical backend on every operation. Tiered cache (optional) = per-call memoization keyed by backend version, never duplicate mutable state.

**New crate `mya-context-fs`** (Experimental tier, parallels `mya-memory`). Depends on `mya-api`, `mya-memory`; references `mya-runtime` skills via `SkillsService` (not vendored).

**`ContextSource` trait** (`source.rs`) — thin adapter holding references to canonical backend (never a copy):
```rust
#[async_trait] pub trait ContextSource: Send + Sync {
    fn scheme(&self) -> &'static str;        // "memory"|"skill"|"knowledge"|"agent"
    fn mount_prefix(&self) -> &'static str;  // "default", "core"
    async fn list(&self, path:&str) -> Result<Vec<ContextEntry>>;
    async fn read(&self, path:&str) -> Result<Vec<u8>>;
    async fn grep(&self, path:&str, pattern:&str, recursive:bool, ci:bool, node_limit:Option<usize>) -> Result<Vec<ContextGrepMatch>>;
    async fn tree(&self, path:&str, node_limit:Option<usize>, level_limit:Option<usize>) -> Result<Vec<ContextEntry>> { /* default walks list() */ }
    async fn write(&self, _path:&str, _data:&[u8]) -> Result<()> { bail!("writes not supported") }
}
pub struct ContextEntry { name:String, is_dir:bool, size:u64, mod_time:Option<SystemTime>, meta:BTreeMap<String,String> }
pub struct ContextGrepMatch { path:String, line:u64, content:String }
```

**`ContextFs` router** (`fs.rs`) — analogue of `MountableFS` but smaller/read-oriented:
```rust
pub struct ContextUri { scheme:String, mount:String, path:String }  // "memory://default/core/foo"
pub struct ContextFs { sources: RwLock<HashMap<(String,String), Arc<dyn ContextSource>>> }
impl ContextFs {
    pub fn mount(&self, source: Arc<dyn ContextSource>);  // idempotent on (scheme,mount)
    pub async fn list/read/grep(&self, uri:&ContextUri, ...) -> ...;
    pub async fn grep_all(&self, scheme:&str, pattern:&str, node_limit:Option<usize>) -> Result<Vec<(String,ContextGrepMatch)>>;  // union across mounts
}
```

**URI scheme:**
```
memory://<backend-alias>/{core,daily/<date>,conversation/<session>,custom/<cat>}/<key>.md
skill://<alias>/<name>/SKILL.md
knowledge://default/nodes/<kind>/<title>.md
agent://<alias>/{memory,skill,knowledge}/...   # per-agent scoped view
```

**Adapters:**
- `MemoryContextSource` (holds `Arc<dyn Memory>` — same handle agent runtime already holds; `list`/`read`/`grep` resolve on every call, no `Vec<MemoryEntry>` cached). MarkdownMemory is cheapest first adapter (reads existing on-disk layout directly).
- `SkillContextSource` (holds `Arc<Config>`; re-reads via `load_skills_for_agent_from_config` every call — no `Skill` data copied).
- `KnowledgeContextSource` (read-only; write actions stay on `KnowledgeTool`).

**Tiered cache (optional, clean-room):** `ContextCacheProvider` trait + `ContextCachePolicy` (mirrors OpenViking `CachePolicy` shape, not code) → `CacheDecision::{Bypass,Cache,Prefer}`. `CachedContextFs` wraps any source. **Cache key embeds source version token** (entry count / config hash) → reload invalidates without manual flush. No entries pre-loaded.

**L0/L1/L2 as path protocol** (not a new API): `memory://default/core/.abstract.md` (top N keys), `.overview.md` (decisions + recent), `<key>.md` (L2). Replace OpenViking's `.abstract`/`.overview` generators with mya-native "hot keys" (most-frequently-recalled) for first PR.

## Integration points
- **mya-memory**: each backend `Memory` impl unchanged; new `MemoryContextSource` adapter wraps `Arc<dyn Memory>`. **`Memory` trait unchanged** (SSOT — Memory stays canonical read/write store; `ContextSource` is a view).
- **mya-runtime**: `DefaultMemoryLoader` stays canonical; new **opt-in** `ContextFsMemoryLoader` selectable via `[runtime_profiles.<alias>].context_loader`. `build_context` call sites (loop_.rs:1813/2335/3155) unchanged; new loader emits same `ObserverEvent::MemoryRecall`.
- **mya-tools**: 2 new tools `context_browse` + `context_grep` (registered behind `context_fs.enabled`) — replace the 4-tool dance (memory_recall/read_skill/knowledge/content_search) with one uniform URI surface.
- **mya-api**: `ContextSource` in new crate; `mya-api` unchanged. No cross-namespace re-export.
- **mya-config**: additive `[agents.<alias>.context_fs]` (enabled=false default, mount flags, optional cache).
- **Breaking changes: NONE** — Memory trait/backends/loader/tools all unchanged; new crate + trait + opt-in config + new tools.

## Migration / implementation steps (size:S/XS each; reversible behind flag, default off until step 5 green one release)
1. **XS** — skeleton crate `mya-context-fs/` (Cargo.toml, lib.rs, source.rs trait+types, fs.rs router). Apache-2.0 SPDX + clean-room notice. Add to workspace.
2. **S** — `MarkdownMemoryContextSource` (cheapest — MarkdownMemory's on-disk layout, no SQL). TempDir + seeded tests.
3. **M** — `SqliteMemoryContextSource` (via canonical `Memory::list`/`get_for_agent`/`recall`; SSOT preserved).
4. **S** — `SkillContextSource` (wraps `load_skills_for_agent_from_config` + SKILL.md file read; `Arc<Config>` in, no copy).
5. **M** — `ContextFs::mount_default` + `ContextFsMemoryLoader` (opt-in via `[agents.<alias>.context_fs].enabled`; default behavior identical).
6. **S** — `context_browse` + `context_grep` tools (registered in `tools/mod.rs::all_tools` behind flag).
7. **M** — `KnowledgeContextSource` (read-only; off by default).
8. **M** — tiered cache (`ContextCacheProvider`/`ContextCachePolicy`/`CachedContextFs`; in-memory first via `moka`, redis later).
9. **L** (post-port) — dashboard "Browse context" page.
10. **L** (optional) — L0/L1/L2 generators (gate on usage data).

## Effort & risk — 🔴 overall (small per-PR, ~6-9 PRs across 6 crates; total surface large)
- New crate / Memory trait unchanged / on-demand resolution → 🟢 (AGENTS.md §1 explicitly allows on-demand materialized views).
- Memory backend adapters → 🟡 (7 backends × 4 verbs = combinatorial test surface).
- Skills adapter re-reads config each call → 🟡 (smoke test that reload flips skill visibility).
- Tiered cache invalidation across reload → 🟡 (SSOT-safe via per-source version tokens).
- Cross-source `grep_all` ordering → 🟡 (documented tie-breaker: mount lexical).
- **AGPL clean-room → 🟡**: all signatures original; ragfs `FileInfo`/`GrepResult` names NOT reused; `ov_cli` Apache carve-out does NOT cover the FS abstraction, so we work only from the README *concept*, never the trait code. Maintain `// SPDX-License-Identifier: Apache-2.0` on every file + top-of-file clean-room notice.
- L0/L1/L2 generators → 🔴 (need summarization mya lacks; defer behind flag).
- Bidirectional skill writes → 🔴 (`ContextSource::write` stays `bail!` until reshaped; skill writes go through `SkillsService` for audit).
- `KnowledgeTool` → `knowledge://` migration → 🔴 (high-traffic tool; ship KnowledgeContextSource read-ONLY, keep existing tool as write path).

## Open questions
1. Per-agent scoping at URI vs Memory layer? → mount install-wide backend, let `MemoryContextSource` see what its wrapped `Memory` sees (avoids SSOT violation).
2. Skill writes from FS surface? → default `bail!`; revisit if unified write API lands.
3. Tiered cache prefer defaults? → mya-native "hot keys" (most-recalled) first PR (no `.abstract`/`.overview` generators yet).
4. `KnowledgeTool` + unified surface? → FS read-only for knowledge (writes stay on existing tool); test `grep_all` interaction.
5. Locale routing for skills? → out of scope initial (`SKILL.en.md`/`SKILL.fr.md` follow-up).
6. Telemetry → keep `ObserverEvent::MemoryRecall` firing; add analogous `ContextBrowse{scheme,mount,path,match_count}`.
7. **Maintainer confirm OpenViking clean-room scope** — `ov_cli` Apache carve-out must not expose the `FileSystem`/`MountableFS`/`CacheProvider` trait surface we model after; if it does, revisit clean-room claim before RFC.

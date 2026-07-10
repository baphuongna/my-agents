# Code Navigation & Channels

> Part of the Unified Agent SPEC — see [00-OVERVIEW.md](00-OVERVIEW.md). Section §11 · §12.



## 11. Code Navigation & Execution

- **LSP format + diagnostics surfaced as opt-in post-write feedback** (`lsp.formatOnWrite`/`lsp.diagnosticsOnWrite`); the write always succeeds — diagnostics are an appended notice, NOT a gate. LSP is force-disabled for eval/subagent turns (cold-start cost). The **real DAP debugger** (drive/time-travel) IS first-class. *(source: [oh-my-pi](../../oh-my-pi/).)*
- **`codegraph`** **content-addressed file-relevance search** (BM25 + structural-doc embeddings + reciprocal-rank fusion) returning **ranked file paths** — NOT a symbol/ref/call-graph (a tree-sitter call-graph is a *future* upgrade, [§23 Open Questions](11-invariants-roadmap.md) #1); codegraph = file-relevance ranking only; symbol/ref/call-graph is deferred. *(source: [openhuman](../../openhuman/).)*
- **Bidirectional code-execution bridge:** persistent Python + Bun worker kernels that call **back into the agent's own tools** (read/search/task) over loopback. Agent never leaves the cell. *(source: [oh-my-pi](../../oh-my-pi/) §01.)*

> **Structured subsections (name + 1-line + source):**

- **§11.1 LSP service** — per-workspace LSP client (multi-server: ts/rust/py); capabilities: hover/goto-def/find-refs/rename/diag; results typed as `LspResult`. *(source: [oh-my-pi](../../oh-my-pi/) `pi-langsrv` · [MyAgents](../../MyAgents/).)*
- **§11.2 DAP session protocol** — debug-adapter (27 ops: launch/attach/breakpoint/step/evaluate/...); session FSM (uninit→launched→running→paused→terminated); binds to code-exec bridge. *(source: [oh-my-pi](../../oh-my-pi/) DAP.)*
- **§11.3 codegraph** — FILE-RELEVANCE index (NOT a call graph — corrected in R24); symbol→file map for "which files relate to X"; incremental on file-change. *(source: [hermes](../../hermes-agent/) codegraph.)*
- **§11.4 code-exec bridge** — in-process (R30) `callTool` filtered by `DELEGATE_BLOCKED_TOOLS` (§10); returns `ShellResult` (§4); bounded by §7 permission gate at spawn. *(source: [oh-my-pi](../../oh-my-pi/) task.)*

---
## 12. Channels & Gateway

- **Multi-platform gateway** around one loop, plugin-friendly `ChannelRegistry` (trait + link-time registration) with `check_fn`/`validate_config`/`setup_fn` split so the gateway decides "is this configured?" without booting the adapter. *(source: [hermes](../../hermes-agent/) [`platform_registry`](../../hermes-agent/gateway/platform_registry.py).)*
- **Per-channel access control** via resolver closure over `Arc<RwLock<Config>>` (never cached allowlists). *(source: [hermes](../../hermes-agent/) SSOT rule, cross-confirmed.)* **(R27-15: channel messages MUST pass through `scanInject` with `scope="context"` BEFORE entering history — the injection scanner is the gateway's context-intake gate, defense-in-depth.)**
- **Per-session runtime cache with LRU + idle-TTL eviction** (`MAX_SIZE`, `IDLE_TTL_SECS`), flushing underlying Provider/Channel/Tool handles on eviction (not just the ref); bounded SSE buffer (~16 MiB). *(source: [hermes](../../hermes-agent/) gateway [`run.py`](../../hermes-agent/gateway/run.py).)*
- **`HookRegistry` as the unified extension primitive** — one registry: user hooks (`~/.agent/hooks/<name>/HOOK.yaml` (**uppercase**) + Python `handler.py`, loaded via importlib — **never WASM**) via HookRegistry (**no shipped built-ins yet**: `_register_builtin_hooks()` is empty; scale-to-zero/memory-monitor are **separate gateway subsystem modules**, not hook-registry entries); errors never block. *(source: [hermes](../../hermes-agent/) [`hooks.py`](../../hermes-agent/gateway/hooks.py).)* For the new agent, WASM handlers are a SPEC aspiration (clearly marked), not inherited from hermes.
- **Gateway control-plane protocol** as a separate extracted crate (`gateway-protocol`) — sessions/channels/cron/config/tools/skills/terminals/agents/nodes (includes multi-agent messages, but is broader than agent-to-agent); protocol ≠ server. *(source: [openclaw](../../openclaw/) + [mya-v1](../../mya-v1/) `mya-gateway-protocol`.)*

> **Structured subsections (name + 1-line + source):**

- **§12.1 MCP server lifecycle** — 11-phase FSM (Unconfigured→Discovered→Validated→Initializing→Healthy→Degraded→Failed→Restarting→Draining→Stopped + Quarantine); `ServerHealth{status,capabilities,last_error}`; retry/cooldown; startup→3 terminal outcomes. *(source: [claw-code](../../claw-code/rust/crates/runtime/) `PluginLifecycle`/`PluginState`.)*
- **§12.2 ACP bridge** — session lineage; `AcpEventLedger` (bounded, replay); permission relay (triple-gate); external-agent spawn policy + failure modes. *(source: [MyAgents](../../MyAgents/) ACP · harness catalog.)*
- **§12.3 Cron scheduler** — trigger types (cron/on-interval/once); atomic claim + TTL lease; run-log + failure-alert; delivery-target grammar; direct-delivery isolation. *(source: [MyAgents](../../MyAgents/) scheduler.)*

---

## Completeness (R35) — fff file-search patterns

> Folded from [fff](../../fff/) (TS+Rust hybrid, long-running search engine). Improves §11 search + §7 file tools with a persistent index + bigram prefilter + frecency ranking.

| Pattern | 1-line | Source |
|---|---|---|
| **Long-running SearchIndex service** | per-root Rust index (owns file table + watcher + grep state); `wait_for_indexing_complete` / `trigger_full_rescan_async` / health; incremental overlay (watcher tombstones deletes, updates modified, adds new) | [fff file_picker.rs](../../fff/crates/fff-core/src/file_picker.rs) · [shared.rs](../../fff/crates/fff-core/src/shared.rs) · [background_watcher.rs](../../fff/crates/fff-core/src/background_watcher.rs) |
| **Bigram content prefilter** | optional inverted bigram bitset + skip-1 index built post-scan; regex HIR + fuzzy queries compile to bitset candidates before grep (10-100× faster on large repos) | [fff bigram_filter.rs](../../fff/crates/fff-core/src/bigram_filter.rs) |
| **Frecency + git-aware ranking** | score = base_fuzzy + filename_bonus + frecency_boost + git_status_boost + distance_penalty + current_file_penalty + combo_match_boost + path_alignment_bonus; returns score breakdown | [fff score.rs](../../fff/crates/fff-core/src/score.rs) · [dbs/frecency.rs](../../fff/crates/fff-core/src/dbs/frecency.rs) |
| **Constraint grammar** | unified query parser: `*.ext` (glob) / `src/` (path segment) / `!exclude` (negation) / `git:modified` (git status) / `file:line:col` (location suffix); grep vs AI configs differ | [fff parser.rs](../../fff/crates/fff-query-parser/src/parser.rs) |
| **Multi-mode grep** | SIMD literal (fastest) / regex / fuzzy line search / Aho-Corasick multi-pattern OR; auto-detect smart-case; regex→literal fallback | [fff grep.rs](../../fff/crates/fff-core/src/grep.rs) |
| **Chunked path arena** | paths deduped as 16-byte SIMD chunks → zero/low-copy into fuzzy matcher (saves memory on 100k+ file repos) | [fff simd_path.rs](../../fff/crates/fff-core/src/simd_path.rs) |
| **Glob-only fast path** | `fff_glob` bypasses fuzzy/parser, applies one Glob constraint + frecency-ranks (fastest for exact-pattern queries) | [fff file_picker.rs](../../fff/crates/fff-core/src/file_picker.rs) |
| **Directory + mixed search** | separate directory index; dirs inherit child frecency; mixed file/dir interleave by score | [fff types.rs](../../fff/crates/fff-core/src/types.rs) |
| **Agent guardrails** | wildcard-only grep rejection; fuzzy fallback on zero exact matches; weak fuzzy-result cap; cursor pagination; `is_definition` classifier on grep hits | [fff pi-fff/](../../fff/packages/pi-fff/src/) · [grep.rs](../../fff/crates/fff-core/src/grep.rs) |
| **C FFI boundary (not napi)** | `fff-c` C cdylib with opaque handles; Node uses `ffi-rs`, Bun uses `bun:ffi` — alternative to napi for Rust↔TS | [fff fff-c/](../../fff/crates/fff-c/) |

## R36 type glossary (fff reference patterns — Tier-1+)

> These types are referenced in the R35 table above. Declared here (Tier-1+; NOT Tier-0). Tier-0 search uses plain glob/grep via Rust napi (§7). **Note:** fff uses a C FFI boundary (`fff-c` cdylib); the SPEC stays napi-only ([§3](00-OVERVIEW.md) + invariant #14) — these patterns would be re-implemented as napi functions in `crates/search/`, NOT adopted as a C FFI crate.

```ts
interface SearchIndex { wait_for_indexing_complete(): Promise<void>; trigger_full_rescan_async(): Promise<void>; health(): ComponentHealth }   // long-running per-root Rust index
interface BigramFilter { /* inverted bigram bitset + skip-1; regex/fuzzy compile to candidates */ match(query: string): number[] }
interface FrecencyDB { bump(path: string): Promise<void>; score(path: string): number }   // LMDB access timestamps
declare function fff_glob(query: string, root: string): Promise<string[]>;   // glob-only fast path
```

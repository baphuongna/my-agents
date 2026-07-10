# Deep-dive: Context compression stage → port to mya

> Sources: headroom `crates/headroom-core/` (Apache-2.0 — vendoring/cargo-dep viable) + claw-code `runtime/src/trident.rs` (license unverified → reimplement algorithm). mya integration design.

## Source design

### headroom-core — content-aware per-type compressors
Cargo workspace, 4 members; load-bearing crate = `headroom-core`. **License: Apache-2.0** (`source/headroom/LICENSE:175`) — permissive, attribution-only → **fully compatible with vendoring or direct `path`/`git` Cargo dep**.

Parity contract (`transforms/mod.rs:8-19`): "When in doubt, prefer keeping bytes… we MUST drop everything Python drops, even when it feels lossy."

`LogCompressor` (`transforms/log_compressor.rs`) = 5-stage pipeline: (1) `FormatDetector` (AhoCorasick markers for pytest/npm/cargo/jest/make → Generic, no per-call regex compile); (2) `LevelClassifier` (word-boundary ERROR/FAIL/WARN/INFO/DEBUG/TRACE, avoids `informant`→INFO false-positive); (3) `StackTraceDetector` 5-flavor state machine (PythonTraceback/Js/Java/RustError/Go) with flavor-specific termination (**bug-fixed vs Python**: continues across blanks for chained-exception traces); (4) adaptive total-lines budget via `adaptive_sizer::compute_optimal_k(bias)`; (5) `select_lines` (ERROR/FAIL first+last, WARN dedupe via `normalize_for_dedupe`, stack-trace caps, summary lines, ±error_context_lines, adaptive cap).

CCR (Compressed-Context Retrieval): optional `&dyn CcrStore` injected; marker `[N lines compressed to M. Retrieve full…: hash=<md5-prefix-24>]` appended when `compressed < original*0.8`. MD5 trunc fn `md5_hex_24` (`5d41402abc4b2a76b9719d91` for "hello").

`DiffCompressor`: parses unified-diff → files → hunks, 3 caps (`max_files`, `max_hunks_per_file`, `max_context_lines`), `DiffCompressorStats` sidecar surfacing lossy decisions (`file_mode_normalizations`, `binary_files_simplified`) via `tracing::info!` — **never silently lose info**.

`live_zone.rs` block dispatcher (proxy path): after Phase B retired message-dropping, all compression is *within* messages, never *between* them. Anthropic `/v1/messages` live zone bounded by **floor** `frozen_message_count` (from `cache_control` markers, `compute_frozen_count`) and **ceiling** latest user message. Bytes outside live zone **literally copied** via byte-range surgery on `&RawValue`, never re-serialized — Realignment invariant **I1 (byte-faithful passthrough)**.

`Cargo.toml:32-50` serde_json triple: `preserve_order` (IndexMap, parse-order survives) + `arbitrary_precision` (`1.0`≠`1`, big ints round-trip) + `raw_value` (byte-range surgery). **mya needs this same triple** (currently default `["std"]`).

**Cache-safety invariants** (must copy): I1 byte-faithful passthrough; I2 cache hot-zone never modified; I3 append-only; I4 determinism (same input+frozen → byte-equal); I5 token-aware (compressed.tokens ≥ original.tokens → forward original — the validation gate).

### claw-code Trident — staged compaction (`runtime/src/trident.rs`, 380 lines)
3 stages sequential, each gated by bool in `TridentConfig` (L13-42: `supersede_enabled/collapse_enabled/cluster_enabled` + thresholds + `max_file_operations`), then summarization pass.
- **Stage 1 Supersede** (L144-209): zero-cost factual pruning. Build `BTreeMap<path, Vec<FileOperation>>` from ToolUse/ToolResult; for paths with ≥2 ops, mark indices < last_write_idx obsolete. **Loses no info** (surviving write holds final state).
- **Stage 2 Collapse** (L245-313): summarize "chatty" exchanges (block chars <200, no ToolUse/ToolResult). When ≥`collapse_threshold` consecutive, replace with one System msg `[Collapsed Conversation]\n<N> messages…Topics:`.
- **Stage 3 Cluster** (L363-470): semantic grouping via `MessageFingerprint` + `compute_similarity` (0.4·tool_overlap + 0.4·file_overlap + 0.2·length_similarity, Jaccard both axes). Greedy first-fit; each cluster → one `[Clustered N messages]` summary.
`TridentStats::format_report` (L91-128): 6-line report incl `tokens_saved_estimate` (`block_chars/4+1` heuristic — NOT tokenizer-validated) + ratio `original/final` (confirmed: `final=8` → "7.5x compression").

### headroom's 3 modes + evidence
Modes: **library** (`compress(messages)` callable anywhere), **proxy** (`headroom proxy --port 8787` intercepts wire bytes — most interesting for `mya-gateway`), **MCP server** (expose as tools). Evidence (README:96-110): code search 92%, SRE incident 92%, GitHub triage 73%, codebase exploration 47% token savings; accuracy GSM8K ±0.000, TruthfulQA +0.030. **This accuracy preservation is the contract mya-eval must honor.**

## mya today
- `crates/mya-runtime/src/agent/history_trim.rs` — only whole-turn trim pass: `trim_to_recent_turns(history, budget_tokens)`; drops oldest turns until ≤budget; never splits tool_use/tool_result pair; injects `breadcrumb()` user msg; 11 tests incl orphan sweep.
- `history_pruner.rs` — `remove_orphaned_tool_messages` (2 passes: remove unpaired assistant tool_calls; sweep orphan tool msgs; substring-on-summary trap handled); `strip_orphaned_tool_calls_from_assistants` salvages assistant text. **Both are sanitizers, NOT compressors.**
- `context_analyzer.rs` — keyword-based TOOL FILTER (not a compressor); returns `ContextSignals{suggested_tools,history_relevant}`.
- Call site `loop_.rs:2572-2628`: **reactive** error-driven trim on `is_context_window_exceeded` (400/context-overflow). Proactive path is `trim_history` (loop_.rs:2658) — **message-count cap** (`DEFAULT_MAX_HISTORY_MESSAGES=50`), not token-budget.
- **Missing vs headroom/Trident**: content-type detection, per-type compressors, reversibility (CCR), staged compaction, per-stage stats, provider-wrapper form, byte-faithful cache safety (I1), token-validation gate (I5), serde_json feature triple.
- **mya HAS that headroom doesn't**: `mya-eval` Phase 0 deterministic replay (`TraceLlmProvider` plays scripted responses) — a **better** drift gate than headroom's 3-arm Python eval (free, fast, deterministic).

## Proposed design for mya
**Pipeline location:** proactive invocation at start of every `Agent::turn_streamed` (replaces reactive-only path which becomes fallback breaker):
```
history → [Stage 0: history_pruner (existing)] → [Stage 1: history_trim (existing, last-resort)]
        → [Stage 2 NEW: Trident Supersede→Collapse→Cluster] → [Stage 3 NEW: ContentRouter→per-type Compressor]
        → [Stage 4 NEW: token-validate gate (I5)] → [Stage 5 NEW: CCR retrieval-marker] → ChatRequest
```

**Module layout** (`crates/mya-runtime/src/agent/compress/`): `mod.rs`, `compressor.rs` (`Compressor` trait + `CompressError` + `CompressedBlock` + `ReversePointer{Lossy,Ccr{key:[u8;24]},Reversible}`), `content_router.rs` (`ContentKind` + `Router` + `Sniffer` trait), `compressor/{log,diff,json,rag,history}.rs`, `ccr.rs` (`CcrStore` trait + `InMemoryCcrStore`), `trident.rs` (port), `pipeline.rs` (`CompressPipeline` orchestrator), `stats.rs` (`PipelineStats`/`StageStats`).

**Key signatures:**
```rust
#[async_trait] pub trait Compressor: Send + Sync {
    fn kind(&self) -> ContentKind;
    fn worth_compressing(&self, block:&ChatMessage, budget:&CompressBudget) -> bool;
    async fn compress(&self, block:&ChatMessage, ctx:&CompressContext<'_>) -> Result<CompressedBlock, CompressError>;
    fn reverse(&self, pointer:&ReversePointer) -> Option<String>;
}
pub struct CompressPipeline { cfg:CompressConfig, router:Router, ccr:Arc<dyn CcrStore> }
impl CompressPipeline { pub async fn run(&self, history:Vec<ChatMessage>, budget:&CompressBudget) -> (Vec<ChatMessage>, PipelineStats) }
```
**Trident port** operates on `mya_api:*** (not claw-code's ConversationMessage), `async fn`, drops the inner LLM-summarization `compact_session` (out of scope).

**Provider-wrapper** `CompressingProvider` in `crates/mya-providers/src/compressing.rs` — mirrors `ReliableProvider` wrap-a-`ModelProvider`-via-`Arc` pattern; intercepts `chat()`, runs messages through pipeline before wire call.

**mya-eval gate** `CompressionDriftGrader` (extend `Grader` trait): compare replay-without-compression vs replay-with-`CompressingProvider` over the **same** `LlmTrace` fixture → diff final responses → fail if expected-token drifts outside `max_answer_drift_lines`. Reuses fixtures unchanged; new suite `crates/mya-eval/fixtures/compression-drift/*.json` (~8: long diffs, build logs, JSON array tool output, RAG snippets, chatty convos, stack-trace tool output).

**serde_json adoption** (`crates/mya-runtime/Cargo.toml`): `serde_json = { version="1", features=["preserve_order","arbitrary_precision","raw_value"] }` — scoped to compression stage first, existing serialization stays on `Value` one release.

## Integration points
- **mya-runtime**: `loop_.rs:2572` rewrite reactive-only → proactive `pipeline.run` (keep trim as breaker); `history_pruner` as pipeline Stage 0; new `agent::compress::*`.
- **mya-providers**: `CompressingProvider` + `Compressing::compressing()` ext trait (conventional seam like `reliable`).
- **mya-memory**: `chunker.rs` adjacent; `RagSnippetCompressor` doesn't modify `RetrievalPipeline`.
- **mya-eval**: `CompressionDriftGrader` + `runner.rs` optional compressor injection + `report.rs` `compression_stats` column.
- **mya-config**: `[compress]` schema block (enabled=false default, trident/ccr/token_gate/emit_observability).
- **mya-gateway**: out of scope initial (agent loop is consumer); later PR = `compressing_middleware`.
- **Token flow**: `mya_api:*** {input,output,cached_input}` already populated by every adapter — diff across 2 calls, no new counters.
- **Breaking changes: zero for end users** (opt-in `[compress] enabled=true`, default false = today's behavior; serde_json feature upgrade additive). Internal: grep `Value::Number`/`as_f64`/`to_string` before flipping features.

## Migration / implementation steps (11 PRs, lowest-risk-first)
1. **PR-A** 🟢 — foundation: `compress/{mod,ccr,stats}.rs` (CcrStore trait, InMemoryCcrStore, PipelineStats/StageStats) + schema (`enabled=false`). ~250 LOC.
2. **PR-B** 🟢🟡 — serde_json feature triple (mya-runtime only) + 8 SHA-256-pinned wire-faithfulness fixtures + converter snapshot tests. ~30 LOC + tests.
3. **PR-C** 🟢 — LogCompressor port (headroom-core, Apache-2.0 attribution). ~700 LOC.
4. **PR-D** 🟢 — DiffCompressor port. ~700 LOC.
5. **PR-E** 🟡 — ContentRouter + sniffers (JSON-array/BuildOutput/GitDiff). ~400 LOC.
6. **PR-F** 🟢 — Trident port (operating on ChatMessage). ~400 LOC.
7. **PR-G** 🟡 — CompressPipeline orchestrator + token-gate (I5) + CCR emit. ~300 LOC.
8. **PR-H** 🟡 — agent loop integration (loop_.rs:2572 proactive; trim as breaker). ~120 LOC.
9. **PR-I** 🟡🟡 — CompressingProvider wrapper (production hot path). ~150 LOC.
10. **PR-J** 🟢 — mya-eval gate + 8 fixtures. ~400 LOC + fixtures.
11. **PR-K** 🟢 — docs RFC `docs/book/src/architecture/04-context-compression.md`.

## Effort & risk — ~16 days focused / 4-6 weeks calendar
🔴 **THE BIG RISK = ANSWER DRIFT.** Headroom's whole GTM hinges on GSM8K ±0.000. **`mya-eval`'s `CompressionDriftGrader` is the single most important guarantee** — must catch every regression before merge. Mitigations: (1) `TraceLlmProvider` deterministic by construction; (2) per-stage stats → `mya_log` (drift detectable even if text matches); (3) CCR sidecar costs visible in `cost.rs`; (4) all 10 Realignment invariants enforced day 1 (typestate API makes frozen-zone mutation compile-time impossible); (5) reuse headroom-core (inherits its 20-fixture parity gate).
SSOT: `RawValue` byte-range surgery + frozen-count tracking prevent live-zone bleed.

## What to copy vs reimplement
- **headroom-core compressors: DEPEND, don't copy.** Apache-2.0 (permissive, attribution-only). `headroom-core = { git="...", package="headroom-core", rev="<pinned-tag>" }` + thin mya adapter wrapping `headroom_core::transforms::log_compressor::LogCompressor`. Inherits 20-fixture parity gate. Alternative: vendor as `_vendor/headroom-core/` (~6 KLOC) if git-dep policy blocks. License bookkeeping: add to `deny.toml` allowlist, create workspace `NOTICE`, `cargo deny` in CI.
- **claw-code Trident: REIMPLEMENT algorithm** (license unverified — claw-code README/LICENSE needs check). Port the 3-stage algorithm + `TridentConfig` defaults + `TridentStats::format_report`, write fresh code. Prior-art reasoning makes reimplement safe.
- **Content-router sniffers: write fresh** (~400 LOC glue, AhoCorasick matchers — can reuse headroom's `FormatDetector`).
- **mya-eval: reuse as-is** (already exists, deterministic replay, `Grader` trait extension point).

## Open questions
1. Where does the live-zone dispatcher live? (headroom walks request body for cache hot zone; mya has no multi-turn-prompt-cache abstraction) → keep in mya-runtime first PR, defer provider-cache-aware framing; **architecture review before PR-I**.
2. CCR store backend → InMemory now, SQLite later (reuse `mya-memory/src/sqlite.rs` pool). **Decide before PR-G**.
3. Tokio in compressors → sync LogCompressor/DiffCompressor wrapped in async; `spawn_blocking` OK today.
4. Auth-mode policy (headroom's `CompressionPolicy`) → defer (mya-gateway is separate binary, one identity at a time).
5. **Intra-turn vs inter-turn compression** → boundary first (PR-I), intra-turn (between tool calls) as 2nd PR after PR-I proves out.
6. Kompress-v2 model port (ONNX/`ort`) → separate RFC, out of scope.
7. `record!` WARN cadence → one INFO per stage (category `::Agent`); WARN only when token-gate trips ≥N/turn.
8. headroom upstream goes stale → pin tag insulates; worst case vendor.

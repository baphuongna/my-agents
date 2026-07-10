# claw-code — Learnings for mya

> Studied 2026-07-08. **Source:** `/home/bom/source/my-agent/source/claw-code` (Rust workspace, ~48.6K Rust LOC, 9 crates, ~292 commits). Brief: a "Claude Code-like" coding-agent CLI (`claw`) plus a lean variant (`claw-analog`) and a separate RAG service. Heavy emphasis on **"clawable" agent design** — explicit state machines, events over logs, recovery-before-escalation.

## TL;DR (what it is, stack, why it matters)

**Claw Code** is a **Rust CLI coding-agent harness** with a layered architecture:
- **`rusty-claude-cli`** — full-featured `claw` binary (REPL, OAuth, bash/MCP/plugins/tools, streaming, Anthropic + OpenAI-compat + xAI providers).
- **`claw-analog`** — lean agent over the same `api` crate: filesystem tools only, explicit permission modes, NDJSON output, CI/script-friendly.
- **`claw-rag-service`** — separate HTTP service (SQLite + embeddings) called by agents via `retrieve_context` over HTTP.
- **`mock-anthropic-service`** + **`compat-harness`** — parity/replay infrastructure.
- **`runtime`** — sessions, config, **PermissionPolicy / PermissionEnforcer**, MCP, plugin lifecycle, **TaskRegistry**, **TeamRegistry**, **CronRegistry**, **Trident** compaction pipeline, **bash validation** (6 submodules), **hooks** system, **green_contract**, lane events, branch lock, stale branch detection, trust resolver.
- **`api`** — provider clients + SSE streaming + prompt cache + types.
- **`plugins`** — plugin host runtime.
- **`commands`** — command surface.

**Why it matters for mya:** claw-code is the closest 1:1 functional analogue of mya's coding-agent surface (Provider/Channel/Tool/Memory/Observer, agent loop, cron, subagents, skills, plugins, security/sandbox, audit). It's a **production-shaped Rust reference** with strict design discipline (`unsafe_code = forbid`, `pedantic = warn`, parity-checked against a Python upstream). The clearest transferable lessons are: **explicit state machines for everything** (Task, Team, Cron, MCP, Plugin, Lane), **typed lifecycle phases with degraded-mode reporting**, **lane events as first-class citizens**, **mock parity harness for deterministic replay**, **provider-agnostic API crate with SSE + prompt-cache abstraction**, and a **lean/dual binary** split (`claw` vs `claw-analog`) for CI/automation.

## Architecture overview (cite paths)

```
claw-code/
├── rust/
│   ├── Cargo.toml                 # workspace: 9 crates, unsafe_code = forbid, pedantic = warn
│   ├── crates/
│   │   ├── api/                   # Provider clients (Anthropic, OpenAI-compat, xAI) + SSE + types + prompt_cache
│   │   ├── runtime/               # Agent heart: sessions, config, permissions, MCP, plugins, bash, hooks
│   │   ├── tools/                 # Tool implementations wired through runtime
│   │   ├── commands/              # CLI command surface
│   │   ├── plugins/               # Plugin host runtime
│   │   ├── rusty-claude-cli/      # The `claw` binary (full agent)
│   │   ├── claw-analog/           # Lean agent over api (FS-only, NDJSON)
│   │   ├── claw-rag-service/      # RAG HTTP service (SQLite + embeddings)
│   │   ├── mock-anthropic-service/# Deterministic mock for parity tests
│   │   └── compat-harness/        # Compatibility harness
│   └── scripts/                   # run_mock_parity_diff.py, etc.
├── src/                           # Companion Python workspace (audit/helpers; not primary)
├── USAGE.md, how_to_run.md, PARITY.md, ROADMAP.md, PHILOSOPHY.md, concept.md, PRD
└── docs/                          # g012-release-readiness, g011-acp-status-contract, navigation-file-context, container, etc.
```

**Logical layering (per `concept.md`):**
```
Providers (Anthropic / OpenAI / xAI)
        |
        v
[ rusty-claude-cli (claw) ] [ claw-analog (lean) ] [ claw-rag-service HTTP + SQLite ]
       \                  |                      /
        ------- shared `api` crate -------------
                       |
                       v
                runtime / tools / plugins
                       |
                       v
              Filesystem / workspace (-w)
```

**9-lane parity checkpoint (`PARITY.md`):** all 9 lanes merged; bash-validation, sandbox CI fix, file-tool edge cases, TaskRegistry, task wiring, Team+Cron registries, MCP lifecycle, LSP client, permission enforcement.

**"Clawable" design tenets (`ROADMAP.md`):**
1. **State machine first** — every worker has explicit lifecycle states.
2. **Events over scraped prose** — channel output derived from typed events.
3. **Recovery before escalation** — known failure modes auto-heal once before asking.
4. **Branch freshness before blame** — stale-branch detection before classifying test failure as regression.
5. **Partial success is first-class** — MCP startup can succeed for some servers and fail for others.
6. **Terminal is transport, not truth** — orchestration state lives above tmux/TUI.
7. **Policy is executable** — merge/retry/rebase/cleanup rules machine-enforced.

## Notable patterns & techniques

### 1. Typed lifecycle states as enum + serde tag = machine-readable state machines
- **Where:** `runtime/src/task_registry.rs` (`TaskStatus`), `team_cron_registry.rs` (`TeamStatus`), `plugin_lifecycle.rs` (`PluginState`), `mcp_lifecycle_hardened.rs` (`McpLifecyclePhase`).
- **Pattern:** Tagged-enum state machines (`#[serde(rename_all = "snake_case", tag = "state")]`) with `Display` + `startup_event()`/`is_startup_terminal()` helpers.
- **Why:** Observers/dashboards/recovery loops can pattern-match on `PluginState::Degraded { healthy_servers, failed_servers }` instead of parsing logs.
- **How mya adopts:** Enforce `#[serde(tag = "state")]` shape across `JobStatus`, `SubagentStatus`, `CronStatus`, `ProviderStatus`, `McpServerStatus`, `PluginStatus`. Add `startup_event()` / `is_terminal()` helpers so the agent loop emits typed `LifecycleEvent`.

### 2. Per-component LaneFreshness heartbeats → operational liveness board
- **Where:** `task_registry.rs::LaneHeartbeat { observed_at, transport_alive, status }` + `freshness_at(now, stalled_after_secs)` returns `LaneFreshness::{Healthy, Stalled, TransportDead, Unknown}`; aggregated into `LaneBoard { active, blocked, finished }`.
- **Pattern:** Every async worker emits heartbeat with timestamp + transport-alive flag; centralized board classifies each as healthy/stalled/dead.
- **Why:** When 10+ subagents/cron workers run, one place to ask "which workers are stuck" without log-spelunking.
- **How mya adopts:** Add `LaneBoard` to `mya-runtime` for subagents + cron jobs + channel listeners. Each runtime handle already updates `updated_at`; expose `freshness()` returning the same enum. Surface as `RuntimeAdapter::lane_board() -> LaneBoard` for `mya-gateway` dashboard.

### 3. MCP lifecycle as 11-phase typed FSM with structured error surface
- **Where:** `mcp_lifecycle_hardened.rs::McpLifecyclePhase::{ConfigLoad, ServerRegistration, SpawnConnect, InitializeHandshake, ToolDiscovery, ResourceDiscovery, Ready, Invocation, ErrorSurfacing, Shutdown, Cleanup}` + `McpErrorSurface { phase, server_name, message, context: BTreeMap<String,String>, recoverable, timestamp }`.
- **Pattern:** Every MCP failure carries **phase** + **recoverable** flag + structured `context` map.
- **Why:** "MCP failed" is useless; "MCP `InitializeHandshake` failed for `server-x` (recoverable=true, context={retry_count:2,last_error:protocol_mismatch})" is actionable.
- **How mya adopts:** `crates/mya-runtime/src/security/` and `crates/mya-channels/` should follow the same 11-phase enum + structured error surface. Add `recoverable: bool` and `phase` to every channel/plugin/mcp error variant.

### 4. Plugin partial-success as first-class `Degraded` state
- **Where:** `plugin_lifecycle.rs::PluginState::Degraded { healthy_servers, failed_servers }` + `ServerHealth { server_name, status: ServerStatus::{Healthy, Degraded, Failed}, capabilities, last_error }`.
- **Pattern:** Per-server health aggregates into `Healthy | Degraded | Failed`. `from_servers(servers) -> PluginState` is the canonical aggregator.
- **How mya adopts:** `mya-plugins` (WASM) and `mya-channels/orchestrator` should aggregate channel/plugin startup into the same tri-state.

### 5. Trident compaction pipeline = staged compaction with measurable stats
- **Where:** `runtime/src/trident.rs::TridentConfig { supersede_enabled, collapse_enabled, cluster_enabled, collapse_threshold, cluster_min_size, cluster_similarity_threshold, max_file_operations }` + `TridentStats { superseded_count, collapsed_chains, clusters_found, tokens_saved_estimate, original_message_count, final_message_count }` + `format_report()`.
- **Pattern:** Compaction is 3 optional stages (Supersede → Collapse → Cluster) each independently toggleable, each reporting its own counter. Final report shows `compression_ratio = original / final`.
- **How mya adopts:** `mya-runtime`'s context compression should expose stage-level stats. Pipe mya's memory backends (markdown, sqlite, vector) through a similar 3-stage pipeline.

### 6. PermissionPolicy with mode + allow/deny/ask rules + unconditional denied_tools list
- **Where:** `permissions.rs::PermissionMode::{ReadOnly, WorkspaceWrite, DangerFullAccess, Prompt, Allow}` + `PermissionPolicy { active_mode, tool_requirements, allow_rules, deny_rules, ask_rules, denied_tools }` + `PermissionOverride::{Allow, Deny, Ask}` from hooks.
- **Pattern:** Layered — mode baseline + per-tool requirements + per-rule lists + hook override + unconditional `denied_tools` checked first.
- **Why:** Real agents need "always deny this tool even in danger mode" (e.g. production credentials) without order-dependence.
- **How mya adopts:** `mya-runtime/src/security/` should expose the same 5-mode enum + 3-rule-list + hook override + unconditional-deny-first ordering. **Source of truth for `allowed_users`/`denied_tools` must live in `mya-config` TOML only** — runtime resolves on demand via `Arc<RwLock<Config>>`, never caches Vec in channel handles (AGENTS.md "no duplicate state" rule).

### 7. Hook system with AbortSignal + ProgressReporter + JSON-stdin commands
- **Where:** `hooks.rs::HookEvent::{PreToolUse, PostToolUse, PostToolUseFailure}` + `HookAbortSignal { aborted: Arc<AtomicBool> }` + `HookProgressReporter` trait + `HookRunResult { denied, failed, cancelled, messages, permission_override, permission_reason, updated_input }`.
- **Pattern:** Hooks are external commands with JSON over stdin; can emit messages, override permission, mutate input, abort.
- **How mya adopts:** Mya has `mya-channels/orchestrator` hooks; add the **input-mutation + abort-signal + permission-override** triad to enable policies like "auto-redact secrets in `Write` tool inputs".

### 8. Bash validation as 6 orthogonal submodules with `CommandIntent` classifier
- **Where:** `bash_validation.rs::CommandIntent::{ReadOnly, Write, Destructive, Network, ProcessManagement, PackageManagement, SystemAdmin, Unknown}` + 6 submodules (`readOnlyValidation`, `destructiveCommandWarning`, `modeValidation`, `sedValidation`, `pathValidation`, `commandSemantics`).
- **Pattern:** Composable — each submodule produces `ValidationResult::{Allow, Block{reason}, Warn{message}}`; policy composes them.
- **How mya adopts:** Refactor `mya-tools` shell tool to the same `ValidationResult` + `CommandIntent` shape with each guard as a pure function over argv.

### 9. Mock parity harness for deterministic replay — 12 scenarios, 21 captured requests
- **Where:** `PARITY.md` lists scenarios: `streaming_text`, `read_file_roundtrip`, `grep_chunk_assembly`, `write_file_allowed/denied`, `multi_tool_turn_roundtrip`, `bash_stdout_roundtrip`, `bash_permission_prompt_approved/denied`, `plugin_tool_roundtrip`, `auto_compact_triggered`, `token_cost_reporting`. Driver: `rust/crates/rusty-claude-cli/tests/mock_parity_harness.rs` + `mock-anthropic-service` + `mock_parity_scenarios.json` + `run_mock_parity_diff.py`.
- **Pattern:** Deterministic mock Anthropic-compatible HTTP service + scripted scenario JSON + behavioral diff runner.
- **How mya adopts:** `mya-eval` should borrow this structure: deterministic mock provider + scenario JSON + request-level diff + behavioral checklist.

### 10. Lean/dual binary split (`claw` vs `claw-analog`) over shared `api` crate
- **Where:** `concept.md` §3 + `rust/crates/claw-analog/` + `rust/crates/rusty-claude-cli/`. Both depend on `crates/api`.
- **Pattern:** One full agent (REPL, OAuth, MCP, plugins, all tools) and one lean agent (FS tools only, explicit modes, NDJSON) share provider/SSE/types layer.
- **How mya adopts:** Extract **`mya-headless`** crate (FS tools + NDJSON + lean loop) reusing `crates/mya-api` and `crates/mya-providers`, separate from full `mya-runtime`.

## Top ideas worth adopting

1. **Typed FSM + `startup_event()` helpers across every mya subsystem.** Highest leverage — single change turns ad-hoc enum tracing into data-driven observability.
2. **`LaneBoard` freshness aggregator as a `RuntimeAdapter` method.** Subagents + cron + channel listeners emit heartbeats aggregated into `{active, blocked, finished}` with `LaneFreshness`.
3. **MCP/channel/plugin partial-success tri-state aggregation.** Replace "plugin X started/failed" with `Healthy | Degraded{healthy,failures} | Failed{reason}`.
4. **Structured lifecycle error surface with `phase` + `recoverable` + `context: BTreeMap`.** Replace freeform `tracing::error!` with `McpErrorSurface`; recovery loops auto-retry only recoverable phases.
5. **`mya-headless` lean binary** extracted from `mya-runtime` for CI/script/agent-of-agents use. Shares `mya-api` + `mya-providers`; smaller attack surface, zero REPL/TUI assumptions.

## Gotchas / anti-patterns

- **Companion Python `src/` directory is a museum exhibit.** Don't get confused — truth is in `rust/`.
- **`cargo install claw-code` installs the wrong thing** — deprecated stub prints "renamed to agent-code"; upstream binary is `agent`, not `claw`. mya must not publish a deprecated stub crate under confusingly similar names.
- **`unsafe_code = forbid` workspace-wide is the right default** for sandbox-execution runtimes. mya's `aardvark-sys` is correctly isolated as the only `unsafe` exception.
- **`pedantic = warn` with `priority = -1`** — keeps strictness without blocking CI on cosmetic lints. mya's clippy config should consider this trick.
- **Stub-then-replace pattern is dangerous for mya** because of the "no duplicate state" rule — a stub field that survives the merge is an instant violation. mya must not stub-then-replace without removing the stub in the same PR.
- **`now_secs()` duplicated across nearly every file** in `runtime/`. mya should have a single `mya-infra::time::now_secs()` helper, not duplicate the `SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs()` pattern.
- **`.expect("... lock poisoned")` everywhere** in registry code. mya's AGENTS.md bans `unwrap()`/`expect()` in production paths — registry code should propagate poison errors via `try_lock` + `Result`.
- **Multi-version dual-binary + multi-name confusion** (`claw` vs `claw.exe` vs `agent-code` vs `agent` vs `claw-code-deprecated.exe`). mya should pick one binary name per release channel.
- **ROADMAP explicitly distrusts the terminal as state-of-truth** — "Terminal is transport, not truth". `apps/myacode/` and `apps/tauri/` must surface **typed events** from `mya-runtime`, not derive UI state from scraping stdout/stderr.

## Key reference files

| Path | What it teaches mya |
|---|---|
| `claw-code/README.md` | Dual-binary quick start, `claw doctor` health-check pattern |
| `claw-code/concept.md` | Logical architecture + design principles |
| `claw-code/PARITY.md` | 9-lane checkpoint, mock parity harness, scripted scenarios |
| `claw-code/ROADMAP.md` | "Clawable" agent design tenets |
| `claw-code/rust/Cargo.toml` | `unsafe_code = forbid`, `pedantic = warn` with `priority = -1` |
| `claw-code/rust/crates/runtime/src/permissions.rs` | 5-mode + 3-rule + hook-override permission model |
| `claw-code/rust/crates/runtime/src/task_registry.rs` | `TaskStatus` FSM + `LaneHeartbeat` + `LaneBoard` |
| `claw-code/rust/crates/runtime/src/team_cron_registry.rs` | Team + Cron registries as in-memory `Arc<Mutex<HashMap>>` |
| `claw-code/rust/crates/runtime/src/plugin_lifecycle.rs` | Plugin tri-state aggregation `Healthy | Degraded | Failed` |
| `claw-code/rust/crates/runtime/src/mcp_lifecycle_hardened.rs` | 11-phase MCP FSM + `McpErrorSurface` |
| `claw-code/rust/crates/runtime/src/trident.rs` | 3-stage compaction pipeline with stage-level stats |
| `claw-code/rust/crates/runtime/src/bash_validation.rs` | 6 orthogonal validation submodules + `CommandIntent` |
| `claw-code/rust/crates/runtime/src/hooks.rs` | Pre/Post/Failure hook protocol with input-mutation + abort-signal |
| `claw-code/rust/crates/mock-anthropic-service/` | Deterministic mock provider for parity replay |
| `claw-code/rust/scripts/run_mock_parity_diff.py` | Behavioral diff runner over `mock_parity_scenarios.json` |

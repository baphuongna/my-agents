# SYNTHESIS — Consolidated Roadmap for mya

> Capstone of the learning loop (2026-07-06). 9 reference projects studied → this file deduplicates, prioritizes, and maps every actionable idea to a concrete mya integration point.
>
> Source studies: `openclaw`, `openhuman`, `headroom`, `OpenViking`, `claw-code`, `MyAgents`, `harness`, `Awesome-…-Papers`, `hermes-agent` (see sibling `<project>.md` files).

## How to read this
Each recommendation: **idea → why → source project(s) → mya integration point → effort**. Effort: 🟢 small, 🟡 medium, 🔴 large. Prioritized by leverage × mya-fit.

---

## Tier 1 — High-leverage, adopt soon

### 1. Three-tier prompt assembly, cache-stable by construction 🟢
Split system prompt into **stable | context | volatile**, joined once per session, rebuilt **only** on compression. Scan context files for injection before injecting (`[BLOCKED: …]` placeholder).
- Sources: **hermes-agent** (#4), claw-code
- mya: `crates/mya-runtime/src/agent/system_prompt.rs` (new) + `mya-runtime/src/security/`
- *Why:* prompt-prefix caching makes long sessions cheap; mid-conversation mutation multiplies cost. Single biggest cache win.

### 2. Typed FSMs + structured error surfaces everywhere 🟡
Every lifecycle as `#[serde(tag="state")]` enum + `startup_event()`/`is_terminal()` helpers. Every failure carries `phase` + `recoverable` + `context: BTreeMap`.
- Sources: **claw-code** (11-phase MCP FSM, `LaneBoard`), openhuman
- mya: `JobStatus`/`SubagentStatus`/`CronStatus`/`ProviderStatus`/`McpServerStatus`/`PluginStatus` + `mya-channels`/`mya-runtime/src/security/`
- *Why:* observers/recovery loops pattern-match on typed state instead of parsing logs.

### 3. Pit-of-success lint wrappers 🟢
Convert AGENTS.md "forbidden patterns" into `clippy.toml::disallowed_methods` so the wrong call won't compile (one canonical helper per concern).
- Source: **MyAgents** (local_http, process_cmd, proxy_config, system_binary, normalize_external_path)
- mya: `clippy.toml` + helpers in `mya-infra`/`mya-runtime`
- *Why:* mya already lists forbidden patterns as prose — lint-enforcing them is the next step. Cheap, high ROI.

### 4. Context compression as a first-class stage 🟡
Content-aware, per-type, reversible compression of tool outputs/logs/RAG/history before the provider call; measure both input & output token reduction. Also: **staged compaction** (Supersede→Collapse→Cluster) with per-stage stats.
- Sources: **headroom** (60-95% token cut), **claw-code** (Trident), hermes-agent
- mya: new compression stage in the context pipeline + provider-wrapper form; reuse `mya-eval` as the quality gate (compression must not drift answers)
- *Why:* mya already *tracks* cost (`cost`) but doesn't *reduce* it systematically.

### 5. Declarative `ProviderProfile` metadata struct 🟡
Pair the `Provider` trait with a typed metadata record (`aliases, api_mode, env_vars, supports_vision, fallback_models, hooks: prepare_messages/build_extra_body/fetch_models`) readable by `mya-config` at config-build time.
- Source: **hermes-agent** (`providers/base.py`)
- mya: alongside `crates/mya-api/src/provider.rs`; surface to the setup wizard
- *Why:* new provider = one record, not a 6-file change; wizard UX benefits enormously.

---

## Tier 2 — Strategic, high value

### 6. Memory as a flagship subsystem with named roles 🟡
Named roles beyond backends: **archivist** (auto-curate/decay), **memory_tree** (hierarchy), **memory_diff** (change tracking), **memory_goals** (goal-oriented retrieval), **memory_sync** (multi-device). Plus a **single `MemoryManager`** integration point (one-external-provider rule, timed shutdown drain).
- Sources: **openhuman** (roles), **hermes-agent** (`MemoryManager`), **OpenViking** (unified FS)
- mya: `crates/mya-memory/` + `crates/mya-runtime/src/memory_manager.rs`
- *Why:* mya is backend-rich but role-poor & fragmented; memory/context is a research-validated first-class area (Papers survey).

### 7. Tool-call *repair* pipeline 🟡
`stream-normalize → grammar/payload repair → promote` ahead of dispatch — fix malformed streamed tool calls before execution.
- Source: **openclaw** (`tool-call-repair`)
- mya: extend `mya-tool-call-parser` into a repair/promote stage
- *Why:* mya parses 10+ formats but doesn't *repair*; robustness win against model malformation.

### 8. Skill curator with provenance + auxiliary fork 🟡
`SkillProvenance` enum (`Bundled|HubInstalled|UserCreated|AgentCreated`) gating edits; explicit `SkillCurator` task (inactivity-triggered) running on an **auxiliary provider chain** so the main prompt cache stays warm; archive-not-delete; pinned = never auto-transitioned.
- Source: **hermes-agent** (`agent/curator.py`, `skill_manager_tool.py`)
- mya: `crates/mya-runtime/src/skills/` + `JobType::Agent` for the curator fork
- *Why:* self-improving agents need a principled edit/rollback policy or they silently overwrite user state.

### 9. Formalize the 6 multi-agent topologies 🟢
Pipeline / Fan-out-Fan-in / Expert Pool / Producer-Reviewer / Supervisor / Hierarchical Delegation — as named, declarable shapes.
- Sources: **harness** (6 patterns), **Papers survey** (research-validated), openhuman (`model_council` = Expert Pool variant)
- mya: `TeamTopology` enum in `mya-runtime` + pi-crew workflows; let `cron`/SOP/skills declare topology
- *Why:* vocabulary + declarable orchestration; academically validated.

### 10. Lean/headless binary split 🟡
Extract `mya-headless` (FS tools + NDJSON + lean loop) reusing `mya-api` + `mya-providers`, separate from full `mya-runtime`.
- Source: **claw-code** (`claw` vs `claw-analog`)
- mya: new crate
- *Why:* CI/script/agent-of-agents use; smaller attack surface, zero REPL/TUI assumptions.

### 11. Lazy feature bundles with allowlist + shadow-safe resolution 🟡
Hardcoded `LAZY_DEPS`-style allowlist; writable target; resolution **appended-last** so core crates can never be shadowed; refuse on ABI-stamp mismatch.
- Source: **hermes-agent** (`tools/lazy_deps.py`)
- mya: `crates/mya-plugins/` (WASM) bundle loading
- *Why:* structural guarantee that a bad/incompatible plugin can only fail to load, never shadow core.

### 12. Event-hook registry as the unified extension primitive 🟡
One registry: user scripts (`~/.mya/hooks/<name>/hook.yaml` + WASM handler) AND built-in core hooks (shutdown, scale-to-zero, memory-monitor) via the **same** path. Errors never block the pipeline.
- Source: **hermes-agent** (`gateway/hooks.py` + `builtin_hooks/`)
- mya: `crates/mya-gateway/src/hooks.rs`
- *Why:* users extend gateway without forking core; core "always-on" hooks stop being a separate code path.

---

## Tier 3 — Architecture cleanup & hygiene

### 13. Extract `mya-gateway-protocol` + `mya-net-policy` as separate crates 🟡
Protocol ≠ server; network egress policy reusable across gateway/tools/channels.
- Source: **openclaw** (`gateway-protocol`, `net-policy` as core packages)
- mya: split from `mya-gateway` / `mya-runtime/src/security/`

### 14. `LaneBoard` liveness aggregator 🟢
Subagents + cron + channel listeners emit heartbeats → centralized board classifies each as Healthy/Stalled/TransportDead; surface as `RuntimeAdapter::lane_board()`.
- Source: **claw-code** (`task_registry.rs`)
- mya: `mya-runtime` + gateway dashboard

### 15. MCP/channel/plugin partial-success tri-state 🟢
Replace "plugin X started/failed" with `Healthy | Degraded{healthy,failures} | Failed{reason}`.
- Source: **claw-code** (`plugin_lifecycle.rs`)
- mya: `mya-plugins`, `mya-channels/orchestrator`

### 16. Mock parity harness for deterministic replay 🟡
Deterministic mock provider + scenario JSON + request-level behavioral diff. Also: **test classification** (unit/integration/credentialed) + **no-egress guard** on non-credentialed tests.
- Sources: **claw-code** (`mock-anthropic-service` + `mock_parity_scenarios.json`), **MyAgents** (test pools)
- mya: extend `mya-eval`

### 17. Byte-faithful JSON: `serde_json` `preserve_order` + `arbitrary_precision` 🟢
For deterministic/byte-stable round-trips (reproducible evals, fixture replay, signature verification).
- Source: **headroom** (`Cargo.toml` rationale, Realignment invariant I1)
- mya: where JSON byte-stability matters (eval, signing)

### 18. Supply-chain: min-release-age gate + transitive `[patch]` policy 🟢
Refuse deps younger than N days; aggressive overrides/patches for known-bad transitives.
- Source: **openclaw** (`minimumReleaseAge: 2880` + overrides/patches), **hermes-agent** (exact-pin rationale)
- mya: `cargo-deny` + custom age gate

### 19. Embedded scripting workflows (Rhai) 🔴
User-authorable, sandboxed in-process automations — fills the gap between cron/SOP and full code.
- Sources: **openhuman** (`rhai_workflows`), harness (skill templates)
- mya: new scripting layer in `mya-runtime`
- *Why:* the gap between config-only automation and shell tools.

### 20. `codegraph` in-process code semantic graph 🔴
Makes mya self-sufficient for code tasks without external LSP.
- Source: **openhuman**
- mya: new crate (or vendor approach)

---

## Frontier / research-aligned (longer-term)

- **Multi-agent shared state** (Shared-Harness Synchronization / Representation / Convergence) — invest in mya's `distributed nodes` + subagent task store. *(Papers survey frontier)*
- **Verifiable payments** — pair mya's Verifiable Intent (SD-JWT) with **x402** micropayments + wallet. *(openhuman)*
- **On-device MLX TTS** + native mobile apps. *(openclaw)*
- **Channels mya lacks**: Zalo, Synology Chat, Tlon, Google Chat, Microsoft Teams, WebChat, Google Meet. *(openclaw)*

---

## ⚠️ Hard "do NOT" list
- **Never vendor OpenViking code** — it's **AGPLv3** (copyleft). Study its `ragfs` architecture; interoperate only via clean-boundary network/API.
- **Never mutate past context / swap toolsets / rebuild system prompt mid-conversation** (except compression) — invalidates prompt cache, multiplies cost. *(hermes-agent invariant)*
- **Never cache allowlists/`denied_tools` in channel/plugin handles** — resolve via `Arc<RwLock<Config>>` closure on demand. *(hermes-agent + mya AGENTS.md SSOT rule — cross-confirmed)*
- **Never propagate parent stdin/file-handle ownership to subagent tasks** — route via explicit `ApprovalChannel`. *(hermes-agent deadlock)*
- **Never stub-then-replace fields** — a surviving stub is an instant SSOT violation. *(claw-code)*

---

## Theme clusters (where multiple projects converge)
| Theme | Converging sources |
|---|---|
| Typed FSMs / structured errors / liveness | claw-code, hermes-agent, openhuman |
| Prompt-cache stability + compression | hermes-agent, headroom, claw-code |
| Memory depth + unified context | openhuman, OpenViking, hermes-agent |
| Registry-driven self-registering tools/channels/providers | hermes-agent, openclaw, claw-code |
| Supply-chain hygiene (age-gate, exact-pin, overrides) | openclaw, hermes-agent |
| Multi-agent topology vocabulary | harness, Papers survey, openhuman |
| Lean/headless + dual-binary | claw-code, openclaw |
| Skill lifecycle + provenance + curator | hermes-agent, harness |

## Suggested first PR (quick wins, one concern)
1. `clippy.toml::disallowed_methods` pit-of-success wrappers (#3) 🟢
2. `serde_json` byte-faithful features where needed (#17) 🟢
3. `LaneBoard` + partial-success tri-state (#14, #15) 🟢
4. 6-topology `TeamTopology` enum (#9) 🟢

# hermes-agent — Learnings for mya

> Studied 2026-07-08. Source: `/home/bom/source/my-agent/source/hermes-agent` (Python, ~4,059 files, v0.18.0). hermes is the **architecturally closest** reference to mya — proves out the same problems mya solves in Rust.

## TL;DR (what it is, stack, why it matters)

**hermes-agent** is a single Python/uv-managed codebase that bundles an AI agent runtime with a multi-platform messaging gateway, an Electron desktop app, a TUI, a cron daemon, a Skills Hub, a Plugins system, MCP, voice/STT/TTS, browser automation, and 30+ messaging-platform adapters — all sharing one agent core (`AIAgent` in `run_agent.py`) and one provider abstraction (`ProviderProfile`).

**Stack:**
- Python 3.11–<3.14, runtime pinned with **exact-pinned** deps (no ranges) — deliberate supply-chain hardening in response to the May-2026 Mini Shai-Hulud worm on PyPI.
- `uv` for install/lock; one `hermes` CLI; multi-process daemon for the gateway.
- OpenAI SDK as the *transport*; provider-specific behavior moves into declarative `ProviderProfile` dataclasses.
- Optional providers installed lazily via `tools/lazy_deps.py` at first use — never eager `[all]` extras.
- Tools self-register via a central `registry.register(...)`; discovery is automatic via AST scan + import.
- Plugins live under `plugins/<category>/<name>/`, loaded from repo or `~/.hermes/plugins/`.

**Why it matters for mya:** hermes proves out the *exact* architectural problems mya is solving in Rust — narrow agent core with trait-style extension points, lazy dependency surface, declarative provider metadata, registry-driven tools, multi-channel gateway around one loop, learned procedural memory (skills) vs declarative memory (MEMORY.md), background "self-improvement" fork, prompt-cache-safe turn pipeline. The interesting lessons are about **policy discipline**, **runtime invariants**, and **keeping the core small while pushing capability out to edges**.

## Architecture overview (cite paths)

```
┌─────────────────────────────────────────────────────────────────────┐
│                        CLI / TUI / Desktop / Gateway                │
│  cli.py · tui_gateway/ · apps/ (Electron) · gateway/run.py          │
│  ↪ all hit the same AIAgent class                                   │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       Agent Core (one process, one loop)            │
│  run_agent.py  — AIAgent (god class; methods extracted into agent/) │
│  agent/conversation_loop.py  — 3.9k-line turn driver                │
│  agent/system_prompt.py + agent/prompt_builder.py                  │
│      ↪ 3-tier prompt: stable | context | volatile (cache-safe)      │
│  agent/memory_manager.py — single integration point for memory     │
│  agent/curator.py         — background skill-maintenance fork       │
│  agent/learning_graph.py  — derived "what user learned" graph       │
└─────────────────────────────────────────────────────────────────────┘
            │                       │                       │
            ▼                       ▼                       ▼
   Tool Registry            Provider Profiles         Memory Providers
   tools/registry.py        providers/base.py         agent/memory_provider.py
   tools/*.py               plugins/model-providers/ MemoryManager
            │
            ▼
┌─────────────────────────────────────────────────────────────────────┐
│                 Gateway (messaging platforms)                       │
│  gateway/run.py            — lifecycle, AIAgent cache LRU+TTL       │
│  gateway/base.py           — ABC PlatformAdapter                    │
│  gateway/platform_registry.py — plugin-friendly factory registry    │
│  gateway/platforms/*.py    — 22+ built-in adapters                  │
│  gateway/hooks.py          — event hooks                            │
│  gateway/builtin_hooks/    — ship-with-core hooks                   │
└─────────────────────────────────────────────────────────────────────┘
```

**Key architectural constants:**
- *The narrow waist* — the "Footprint Ladder" in `AGENTS.md` ranks how to add capability: extend existing code → CLI command + skill → service-gated tool (`check_fn`) → plugin → MCP catalog → new core tool (last resort).
- *Per-conversation prompt caching is sacred* — system prompt built once per session; only context compression triggers a rebuild.
- *Profiles are independent islands* — each `HERMES_HOME` profile owns its own `cron/jobs.json`, skills, `.env`. Anchoring on the active profile prevents cross-profile leakage.
- *Lazy, vetted deps* — heavy SDKs in optional extras, installed on first use with venv-scoping + a hard `LAZY_DEPS` allowlist.
- *Self-registering tools* — every `tools/*.py` calls `registry.register(...)`; discovery via AST scan.
- *Plugin providers as declarative dataclasses* — `ProviderProfile` carries `env_vars`, `base_url`, `models_url`, `auth_type`, `supports_vision`, hooks.

## Notable patterns & techniques (Pattern → Why → How mya adopts)

### 1. Central registry + AST-based discovery for self-registering tools
`tools/registry.py` exposes `registry.register(name, toolset, schema, handler, check_fn, requires_env, ...)`. Discovery globs `tools/*.py`, AST-parses each, imports only those with `registry.register(...)` at module body. `model_tools.py` is a thin facade. → **Decouples "what tools exist" from "how the loop calls them"; removing a tool = a file delete.** mya's `crates/mya-tools/src/registry.rs` already exists — extend with compile-time `inventory`/`linkme` collection + a `Tool::is_available(&self, &Config) -> bool` gate (the `check_fn` analogue) so absent tools cost nothing at schema-emission.

### 2. Declarative `ProviderProfile` dataclass instead of per-provider branches
`providers/base.py::ProviderProfile` carries identity, auth, endpoints, vision flags, model catalog fallback, host detection, message prep (`prepare_messages`), extra-body construction (`build_extra_body`), API-kwargs injection, live catalog fetch (`fetch_models`). Transport reads the profile. → **New provider = register one dataclass, not a 6-file change.** mya's `Provider` trait mirrors this in spirit — pair it with a typed `ProviderProfile` metadata struct so `mya-config` can read `provider.env_vars` for the setup wizard without going through the runtime.

### 3. Lazy dependency installation with venv-scoping + allowlist
`tools/lazy_deps.py::ensure(feature)` runs a venv-scoped install against an allowlist. Three load-bearing properties: **venv-scoped by default**; for sealed images, installs go to a writable data-volume subdir **appended to `sys.path`** (never prepended) so the agent's own site-packages wins every collision → *"worst a bad backend can do is fail to import"*. Offline detection surfaces `FeatureUnavailable`. Opt-out via `security.allow_lazy_installs: false`. → **mya's WASM plugins should codify this: hardcoded allowlist, writable target, resolution appended-last so core can never be shadowed, refuse on ABI-stamp mismatch.**

### 4. Three-tier prompt assembly for cache-stable system prompt
`agent/system_prompt.py` joins **stable** (identity, tool/skill guidance, env/platform hints) | **context** (caller system_message + discovered context files) | **volatile** (memory snapshot, USER.md, timestamp/session/provider line) with `\n\n`. Only compression triggers a rebuild → per-conversation prefix cache stays warm. `_scan_context_content` runs injection-pattern detection on every context file; blocked files → `[BLOCKED: …]` placeholder that never enters the prompt. → **mya: expose `SystemPrompt { stable, context, volatile }`, joined once per session, replaced only by the compressor. Threat-pattern scanner lives in `mya-runtime/src/security/`. This is the single highest-leverage cache-saving pattern.**

### 5. Per-session AIAgent cache with idle-TTL eviction
`gateway/run.py` holds `_AGENT_CACHE_MAX_SIZE = 128`, `_AGENT_CACHE_IDLE_TTL_SECS = 3600`, enforced by `_enforce_agent_cache_cap()` + `_session_expiry_watcher()`. → **Cap by count + evict by idle time + flush underlying Provider/Channel/Tool handles on eviction (not just the Arc).** Also bounds SSE buffer to 16 MiB.

### 6. Subagent isolation with blocked-tool allowlist + per-thread approval callback
`tools/delegate_tool.py::DELEGATE_BLOCKED_TOOLS` is a hard `frozenset` every child inherits. Subagents run in a `ThreadPoolExecutor` with `initializer=_set_subagent_approval_cb` — without the worker-thread-injected callback, `prompt_dangerous_approval()` would deadlock against the parent's stdin-owning TUI. Default callback is `_subagent_auto_deny`. → **mya: `Tool::is_blocked_in_subagent()` hook (or deny-list per spawn config). Route any `HumanApproval` through an explicit `ApprovalChannel` handle passed at spawn time — never parent-context-resolved.**

### 7. Skill lifecycle with provenance, archival, and a background curator
Skills have lifecycle states (active/archived/pinned), provenance (bundled/hub-installed/user-created), timestamps. `agent/curator.py::maybe_run_curator()` is **inactivity-triggered** — when idle and last run > interval, it spawns a **forked AIAgent on the auxiliary client** (never the main session, to preserve prompt cache) to pin/archive/consolidate. Strict invariants: only touches `is_agent_created` skills, never auto-deletes (only archives), pinned skills bypass all auto-transitions. `learning_graph.py` derives the "what the user learned" graph. → **mya: add `SkillProvenance` enum (`Bundled|HubInstalled|UserCreated|AgentCreated`) gating edits; lifecycle states driven by an explicit `SkillCurator` task; curator runs as a separate `AgentHandle` on an auxiliary provider chain so the main prompt cache stays warm; archive-not-delete; pinned = never auto-transitioned.**

### 8. Progressive-disclosure skills with frontmatter discovery
`tools/skills_tool.py` implements Anthropic's progressive disclosure: `skills_list` returns only `name`+`description` frontmatter; `skill_view` loads full content only on invoke. Index → system prompt = name + short description only. → **mya skill discovery: index = name + description; full SKILL.md loaded only when invoked. `SkillMetadata` mirrors `name/description/version/platforms/prerequisites/related_skills`. Adopt the `agentskills.io` frontmatter standard for cross-tool compat.**

### 9. Plugin-friendly platform registry + ABC adapter
`gateway/platforms/base.py` defines the `PlatformAdapter` ABC; `platform_registry.py::PlatformEntry` is a dataclass (`name, adapter_factory, check_fn, validate_config, is_connected, required_env, install_hint, setup_fn, source, allowed_users_env, allow_all_env, ...`). Plugins register via `platform_registry.register(...)`. Parallel `HookRegistry` fires on lifecycle events. → **mya: a `ChannelRegistry` (trait + inventory collection) so plugin crates register at link time; keep `check_fn`/`validate_config`/`setup_fn` split so the gateway decides "is this configured?" without booting the adapter.**

### 10. Single integration point for cross-cutting subsystems (memory manager)
`agent/memory_manager.py::MemoryManager` is the *only* place `run_agent.py` touches memory. `add_provider` rejects a second external provider (prevents schema bloat + conflicting backends). `_SYNC_DRAIN_TIMEOUT_S = 5.0` caps shutdown. → **mya: promote a single `MemoryManager` in `mya-runtime/src/memory_manager.rs` owning `Vec<Box<dyn Memory>>` with the one-external-provider rule, drains in-flight sync within a timeout, exposes `prefetch_all`/`sync_all`. No background memory fork may touch the main session's prompt cache.**

### 11. Event hooks for the gateway lifecycle
`gateway/hooks.py::HookRegistry` discovers `~/.hermes/hooks/<name>/HOOK.yaml + handler.py`, fires on `agent:start|step|end`, `session:start|end|reset`, `gateway:startup`, `command:*`. Errors caught+logged, never block. `builtin_hooks/` ships core hooks (cgroup_cleanup, scale_to_zero, memory_monitor, restart_loop_guard, …) via the *same* registry. → **mya: `HookRegistry` in `mya-gateway/src/hooks.rs` with the same event surface; user hooks = `~/.mya/hooks/<name>/hook.yaml` + WASM handler; mya's own shutdown/scale-to-zero/memory-monitor ship as built-in hooks registered the same way — no parallel "core hook" path.**

### 12. Per-platform access control with explicit allowlists + DM pairing — and the SSOT rule
`PlatformEntry` carries `allowed_users_env` / `allow_all_env`; `authz_mixin.py` resolves the effective check. **hermes' `AGENTS.md` calls out the previous bug class explicitly:** *"channel `allowed_users` Vec fields cached inside channel handles while the truth lived in config TOML; reloading config didn't refresh the channels; an authorized user couldn't talk to the bot until daemon restart. Every such field is now banned."* → **This is cross-confirmation: mya's AGENTS.md "no duplicate state" rule is the same solution hermes converged on. Every channel handle resolves `is_authorized(peer)` through a resolver closure backed by `Arc<RwLock<Config>>`. Verify mya's `mya-channels/src/orchestrator/` has no residual cached allowlist fields.**

## Top ideas worth adopting (prioritized)
1. **Lazy feature bundles with allowlist + shadow-safe path placement** (`tools/lazy_deps.py`) — codify for mya's WASM plugins: hardcoded allowlist, writable target, appended-last resolution, refuse on ABI mismatch.
2. **Declarative `ProviderProfile` + lazy-discovered plugin providers** — pair mya's `Provider` trait with a typed metadata struct readable by `mya-config` at config-build time (huge setup-wizard UX win).
3. **Three-tier prompt assembly (stable|context|volatile), cache-stable-by-construction** + threat-pattern scan on context files before injection. Single highest-leverage cache-saving pattern.
4. **Skill curator with provenance, lifecycle, and auxiliary fork** — `SkillProvenance` enum, explicit `SkillCurator` task, archive-not-delete, pinned bypass, auxiliary client to preserve main prompt cache.
5. **Event-hook registry as the unified extension primitive** — one registry, user scripts + built-in core hooks via the same path; errors never block.

## Gotchas / anti-patterns
- **God-class sprawl** (`run_agent.py` so big that extraction into `agent/*.py` is a deliverable). mya: extract any function >~600 lines or struct init >~30 fields.
- **Prompt-cache invalidation by mid-conversation mutation** — hermes is unequivocal: *"Anything that mutates past context, swaps toolsets, or rebuilds the system prompt mid-conversation invalidates that cache and multiplies the user's cost. We do not do it."* Only exception: compression. mya must enforce the same invariant.
- **`asyncio.run()` per-call destroys cached async clients** — mya analogue: don't spawn a fresh tokio runtime per tool call; keep long-lived client handles in the runtime struct.
- **Exact-pin deps are non-cosmetic** (Mini Shai-Hulud worm 2026-05-12 via auto-update). mya already pins in `Cargo.toml` — confirm no transitive floats via `^` that the lockfile didn't pin.
- **Subagent approval deadlock** (threads competing for parent stdin). mya: don't propagate stdin/file-handle ownership to subagent tasks; route through explicit `ApprovalChannel`.
- **AIAgent cache LRU+TTL** — without bounds, long-uptime gateway leaks hundreds of MB. mya-gateway: same LRU-with-idle-TTL discipline on per-session runtime cache.
- **Lazy-install targets appended-last to `sys.path`** so core wins collisions. Rust analogue: `dlopen`/WASM resolution keeps core crates ahead of plugin-loaded ones.
- **Context-file prompt injection** — scan every AGENTS.md/.cursorrules/SOUL.md with threat patterns before injecting; matched → `[BLOCKED: …]` placeholder that never enters the prompt.
- **Profiles must be independent islands** — cron anchored on active profile, not shared root, to prevent cross-profile leakage.

## Key reference files
| Path | What to study |
|---|---|
| `AGENTS.md` | "Narrow waist, expansive edges" rubric; the Footprint Ladder; contribution red lines |
| `agent/conversation_loop.py` | 3.9k-line turn driver — best single artifact for "what does a turn do" |
| `agent/system_prompt.py` + `agent/prompt_builder.py` | 3-tier prompt assembly + threat-pattern scanner |
| `agent/memory_manager.py` | Single memory integration point; one-external-provider rule |
| `agent/curator.py` | Background skill curator; inactivity-triggered; auxiliary-client fork |
| `providers/base.py` | `ProviderProfile` dataclass — **template for mya Provider trait metadata** |
| `tools/registry.py` | Self-registering tool registry; AST discovery — **template for mya-tools registry** |
| `tools/lazy_deps.py` | Lazy-install allowlist + venv-scoping — **template for mya-plugins bundle loading** |
| `tools/skills_tool.py` + `tools/skill_manager_tool.py` | Progressive-disclosure skills + provenance-tracked lifecycle |
| `tools/delegate_tool.py` | Subagent isolation; `DELEGATE_BLOCKED_TOOLS`; per-thread approval callback |
| `gateway/run.py` | GatewayRunner lifecycle; AIAgent cache LRU+TTL |
| `gateway/platform_registry.py` | `PlatformEntry` plugin-friendly factory registry |
| `gateway/hooks.py` + `gateway/builtin_hooks/` | User-level + built-in event hook registry |
| `cron/{scheduler,jobs,lifecycle_guard}.py` | Per-profile file-locked scheduler; cross-process advisory locking |

## Scope note (what I skipped)
22 files read, ~30 directory listings, ~10 existence probes. Captured: agent loop, system prompt assembly, prompt caching, tool registry, skill lifecycle + curator + hub, provider profile metadata, lazy-deps plugin loading, gateway lifecycle + hooks + platform registry, subagent isolation, cron scheduler, memory manager, learning graph, and the contribution rubric. **Skipped:** per-platform adapter bodies (22+ channels), browser/voice/MCP implementations, security internals, Electron/desktop surface, RL/eval trajectory surface, and individual `agent/*.py` implementation modules.

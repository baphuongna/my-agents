# mya vs Hermes Agent — Comprehensive Feature Comparison

> **Generated:** 2026-07-28
> **Sources:** mya codebase (`packages/` + `crates/`), Hermes vendored source (`source/hermes-agent/` v0.19.0, direct filesystem inspection), pre-existing analysis docs.
> **Supersedes:** `docs/mya-vs-hermes-features.md` (dated 2026-07-21, now stale — predates the `PLAN-HERMES-PORT.md` completion of ~6,316 LOC / 553 tests that closed many formerly Hermes-only gaps).

---

## 1. Disambiguation Note

**"Hermes agent" = Hermes Agent by Nous Research** ([github.com/NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent)).

> ⚠️ **Web claims unverified in this environment:** Star counts and external URLs cited from the `01_explore` worker's web research could not be independently re-verified in this offline setting. They are included as reported but flagged. All Hermes *technical* claims below are grounded in the vendored source copy at `source/hermes-agent/` (v0.19.0).

| Evidence | Detail |
|----------|--------|
| **Official identity** | "The self-improving AI agent — creates skills from experience, improves them during use, and runs anywhere" — `source/hermes-agent/pyproject.toml:2-3`. MIT license. Python 3.11–<3.14, managed by `uv`. |
| **NOT a mere LLM model** | Nous Research *also* publishes "Hermes" LLM fine-tunes (Hermes 2/3/4 on Llama/Mistral bases). However, the **Hermes Agent** is a separate, full-featured autonomous agent *product/framework* — agent loop, tool system, memory, 31 LLM providers, channels, TUI, web dashboard, desktop app, cron, skills, plugins. It is the feature-comparable candidate. |
| **Local vendored copy** | `source/hermes-agent/` exists in the mya repo — v0.19.0 (confirmed via `pyproject.toml`), ~3,339 Python files, MIT license. Used as a reference implementation study for mya's architecture. |
| **Alternative candidates ruled out** | (1) Nous Hermes *LLM models* — not an agent, just model weights. (2) Hermes (Ethereum/JS messaging) — unrelated. (3) Hermes (React Native) — unrelated JS engine. None are feature-comparable. |

**Conclusion:** Hermes Agent (Nous Research) is the sole credible feature-comparable "Hermes agent." The comparison below is grounded in direct source code inspection of the v0.19.0 vendored copy.

---

## 2. At-a-Glance Table

| Dimension | **mya** | **Hermes Agent** |
|-----------|---------|------------------|
| **Architecture** | TS monorepo (32 packages) + Rust napi-rs crates; dual agent loops (mya-native `runTurn` FSM + pi-forked `AgentSession`) | Single Python codebase (~3,339 files); one agent core (`AIAgent`, extracted into `agent/*.py` modules) |
| **Language / Runtime** | TypeScript 7 strict ESM + Rust-stable via napi-rs; Node ≥20 | Python 3.11–<3.14, `uv`-managed, exact-pinned deps |
| **License** | MIT (inherited from pi-coding-agent fork) | MIT (Nous Research) |
| **Maturity / Origin** | Fork of `@earendil-works/pi-coding-agent` 0.80.10; ~182k LOC TS + ~1.2k LOC Rust; **~5,370 tests / 282 files / 0 failures** | Independent build by Nous Research; ~3,339 Python files; v0.19.0 |
| **Deployment model** | Single `mya` binary (esbuild bundle); gateway (HTTP+WS), TUI, desktop (Tauri), web SPA, RPC (stdio/TCP), SDK | `hermes` CLI via `uv run`; gateway daemon, TUI (`@hermes/ink` Ink fork), desktop (Electron 40), web SPA; 6 terminal backends (local/Docker/SSH/Singularity/Modal/Daytona) |
| **Single binary?** | ✅ `mya` (esbuild single-file) | ⚠️ `hermes` via `uv-run` (Python virtualenv, not truly single-binary) |
| **Desktop** | Tauri 2 (Rust IPC shell, `myagent://` deep-link) | Electron 40 |
| **i18n** | **8 locales** (en, vi, zh, ja, ko, es, fr, de) — `packages/web/src/lib/i18n/` | **16 locales** (af, de, en, es, fr, ga, hu, it, ja, ko, pt, ru, tr, uk, zh-hant, zh) — `locales/` |
| **Web framework** | React 19 + Tailwind 3 + hand-rolled components | React 19 + Tailwind 4 + `@nous-research/ui` (50+ primitives) + Three.js + GSAP |

---

## 3. Feature Matrix

Legend: ✅ = full · 🟡 = partial / different approach · ❌ = absent

### 3.1 Agent Loop & Execution

| Capability | **mya** | **Hermes** |
|------------|---------|------------|
| Frozen/minimal core | ✅ `packages/core` (loop FSM, budget, types — 3,125 LOC) | ✅ `AIAgent` extracted into `agent/*.py` modules |
| 3-tier prompt assembly (stable/context/volatile) | ✅ `packages/prompts/src/assembler.ts` | ✅ `agent/conversation_loop.py` (5,785 LOC) |
| Threat-pattern prompt scanner | ✅ `packages/core/src/threat-scan.ts` + `packages/prompts/src/scan.ts` (17 patterns) | ✅ `agent/_scan_context_content` |
| Per-subagent IterationBudget | ❌ (only `BudgetConfig` token ceiling) | ✅ `agent/iteration_budget.py` (parent=90, sub=50, thread-safe) |
| Delegation depth control | ❌ (hardcoded one-level) | ✅ `delegation.max_spawn_depth` (default **1** = flat) |
| Subagent isolation | ✅ `spawnSubagent/listSubagents/killSubagent` | ✅ `tools/delegate_tool.py` + `DELEGATE_BLOCKED_TOOLS` frozenset + per-thread approval callback |
| Multi-agent council | ✅ `CouncilProvider` (attributed/majority/judge) + adversarial review (Skeptic/Pragmatist/Critic) | 🟡 `moa_loop.py` (Mixture of Agents, up to 8 concurrent) |
| Background review | ✅ `HindsightReviewer` (single-turn critic) | 🟡 `spawn_background_review` (daemon-thread fork replays snapshot) |
| Budget tree-accounting | ✅ `packages/core/src/budget.ts` (deriveChild, releasePrecharge, CC2 refund) | ❌ |
| Crash resilience / recovery FSM | ✅ `RecoveryRecipe` FSM, drain gate | ✅ `restart_loop_guard.py`, `shutdown_watchdog.py` |

### 3.2 Provider / LLM Integrations

| Capability | **mya** | **Hermes** |
|------------|---------|------------|
| Provider count | ✅ **8** wired natively + 30+ available via vendored pi-ai-src (OpenAI, Anthropic, Gemini, MiniMax, DeepSeek, Groq, Mistral, xAI, OpenRouter, Ollama) | ✅ **31** plugin providers (`plugins/model-providers/` — alibaba, alibaba-coding-plan, anthropic, arcee, azure-foundry, bedrock, copilot, copilot-acp, custom, deepinfra, deepseek, fireworks, gemini, gmi, huggingface, kilocode, kimi-coding, minimax, nous, novita, nvidia, ollama-cloud, openai-codex, opencode-zen, openrouter, qwen-oauth, stepfun, upstage, vertex, xai, xiaomi, zai) |
| Lazy plugin install | ❌ (hard-coded + vendored) | ✅ `tools/lazy_deps.py` (allowlist + venv-scoping) |
| OAuth/PKCE | ✅ `packages/ai/src/oauth.ts` | ✅ per-provider |
| Multi-provider fallback | ✅ `streamWithFallback` ordered + skip-tainted | ✅ multi-provider registry |
| Auth/quota taint tracking | ✅ `ProviderRegistry` (cooldown, not retried) | 🟡 partial (per-provider) |
| Central key rotation | ✅ `key-rotation.ts` (KeyRouter, regex classification) | 🟡 per-provider only |
| Tier-based model routing | ✅ `model-routing.ts` (SMALL/BIG model hints, phase routing) | ❌ |

### 3.3 Tools & Skills

| Capability | **mya** | **Hermes** |
|------------|---------|------------|
| Tool registry | ✅ `packages/tools/src/registry.ts` (explicit imports) + 7-step permission pipeline (34k LOC) | ✅ `tools/registry.py` (AST-discovered self-registration, 99 tool files) |
| Permission modes | ✅ 7 modes (allow/deny/ask/auto + escalation) | 🟡 4 modes (allow/deny/ask/auto) |
| Built-in tools | ✅ read/write/edit/bash/glob/grep/ls/find + hashline edit | ✅ read/write/edit/bash/glob/grep/ls/find |
| Browser automation (Camofox) | ✅ `packages/tools/src/web/browser/` | ✅ `tools/browser_camofox.py` |
| Web search backends | ✅ 8 (Brave/Tavily/Exa/SearXNG/DDG/Firecrawl/Parallel/X) | ✅ 8 (brave_free, ddgs, exa, firecrawl, parallel, searxng, tavily, xai) |
| Composio integration | ✅ `composio.ts` | ❌ |
| **Image generation** | ✅ `imageGenTool` — `packages/tools/src/image-gen.js` (`builtin.ts:376`) | ✅ `plugins/image_gen/` |
| **Video generation** | ✅ `videoGenTool` — `packages/tools/src/video-gen.js` (`builtin.ts:377`) | ✅ `plugins/video_gen/` |
| **OSV vulnerability check** | ✅ `osvCheckTool` — `packages/tools/src/osv-check.ts` (`builtin.ts:374`) | ✅ `tools/osv_check.py` |
| **URL safety** | ✅ `urlSafetyTool` — `packages/tools/src/url-safety.ts` (`builtin.ts:375`) | ✅ `tools/tirith_security.py` |
| **Disk cleanup** | ✅ `diskCleanupTool` — `packages/tools/src/disk-cleanup.js` (`builtin.ts`) | ✅ `plugins/disk-cleanup/` |
| **Kanban** | 🟡 `packages/tools/src/kanban.ts` + `kanban-sqlite.ts` (SQLite-backed, 7-table schema — ported from Hermes) | ✅ `plugins/kanban/` + `tools/kanban_tools.py` |
| Symbol extractor (tree-sitter) | ✅ `packages/tools/src/symbol-extractor.ts` (Rust natives) | ❌ |
| Tool repair | ✅ `packages/tools/src/repair.ts` | ❌ |
| Codegraph / reference graph | ✅ `packages/tools/src/codeGraph.ts` + `reference-graph.ts` | ❌ |
| Path safety | ✅ `packages/tools/src/path-safety.ts` | ❌ |
| Skills — progressive disclosure | ✅ `packages/skills/` (name+desc in prompt, body on invoke) | ✅ same pattern |
| Skills — provenance | ✅ 4-value enum (Bundled/Hub/UserCreated/AgentCreated) | ✅ |
| Skills — in-browser editor | ❌ (listing only) | ✅ `SkillEditorDialog.tsx` |
| Skills — categories | ~50+ (un-categorized) | 14 categories (`skills/`: apple, autonomous-ai-agents, creative, email, github, index-cache, media, mlops, note-taking, productivity, research, smart-home, social-media, software-development) |

### 3.4 Memory & Knowledge

| Capability | **mya** | **Hermes** |
|------------|---------|------------|
| Storage backend | ✅ SQLite FTS5 (unified) | 🟡 per-backend (mem0=PG, openviking=custom, etc.) |
| Memory architecture | ✅ `SqliteMemoryManager` 5-layer pipeline (working/episodic/facts/triples), FTS5 BM25, Weibull temporal decay (22 curves), vector arm, 3-tier scope | 🟡 `MemoryManager` single integration point, multiple plugin backends |
| Memory backends | 🟡 single SQLite (unified) | ✅ **8 plugin backends** (`plugins/memory/`: byterover, hindsight, holographic, honcho, mem0, openviking, retaindb, supermemory) + `query_rewrite.py` |
| Weibull temporal decay | ✅ `packages/memory/src/weibull.ts` | ❌ |
| Memory domains (14) | ✅ archivist/conversations/diff/entities/goals/graph/queue/search/sources/store/sync/tools/tree | ❌ |
| Conflict detection | ✅ `packages/memory/src/conflict.ts` (jaccard ≥0.7) | ❌ |
| Governance grounding | ✅ `packages/memory/src/governance.ts` | ❌ |
| RRF (Reciprocal Rank Fusion) | ✅ `packages/memory/src/rrf.ts` | ❌ |
| Auto-capture | ✅ `packages/memory/src/auto-capture.ts` | ❌ |
| Dream cycle / curator | ✅ `DreamCycle` (4h interval, runs in main session) | 🟡 `agent/curator.py` (inactivity-triggered, on **auxiliary** AIAgent — preserves cache) |
| **Learning graph** | ✅ `packages/memory/src/learning-graph.ts` — `deriveLearningGraph()` (concept→concept graph from Brain facts, DOT export) | ✅ `agent/learning_graph.py` |
| ragfs unified URI namespace | ✅ `memory://`, `skill://`, `knowledge://`, `file://` | ❌ |
| Migration tool | ✅ `packages/memory/src/migrate.ts` | ❌ |
| CJK FTS bigram tokenizer | ✅ (ported from Hermes, pure-TS `cjk-tokenizer.ts`) | ✅ (native C extension `libfts5_cjk`) |
| External-content FTS5 | ✅ (ported) | ✅ Schema v23 |
| **Test coverage** | ✅ **707 tests** (most thoroughly tested subsystem) | 🟡 moderate |

### 3.5 Channels & Integrations

| Capability | **mya** | **Hermes** |
|------------|---------|------------|
| Channel count | ✅ **8** TS adapters (Telegram, Discord, Slack, WeChat, Gmail, Linq, Notion, Signal) — `packages/gateway/src/channels*.ts` | ✅ **20+** plugin platforms (dingtalk, discord, email, feishu, google_chat, homeassistant, irc, line, matrix, mattermost, ntfy, photon, raft, simplex, slack, sms, teams, telegram, wecom, whatsapp, bluebubbles, msgraph, qqbot, signal, yuanbao) |
| Per-platform identity | 🟡 basic OAuth | ✅ native identity (`whatsapp_identity.py`) |
| Rate-limit guards | ❌ | ✅ per-platform |
| Sticker cache | ❌ | ✅ |
| Channel as agent context | ✅ `ChannelSessionRouter` | ✅ |
| Channel MCP lifecycle | ✅ `packages/gateway/src/mcp-lifecycle.ts` (11-phase FSM) | ✅ via MCP plugins |
| Hooks | ✅ `packages/channels/src/hooks.ts` | ✅ `gateway/hooks.py` + `builtin_hooks/` |

### 3.6 UI Surfaces

| Capability | **mya** | **Hermes** |
|------------|---------|------------|
| TUI | ✅ Hand-rolled (15.4k LOC, pi fork) | ✅ React 19 + Ink fork + nanostores (`ui-tui/`) |
| TUI — markdown | 🟡 basic (779 LOC) | ✅ richer (math, footnotes, diff, audio directive — 1,066 LOC) |
| TUI — widget SDK | ❌ | ✅ 2-axis grid layout + ambient zones + hot-load |
| TUI — recovery FSM | ❌ | ✅ `gatewayRecovery.ts` (3 attempts/60s respawn) |
| TUI — pet sprites / charms | ❌ | ✅ (petSprite, ambient charms, achievements) |
| Web dashboard | ✅ React 19 SPA (19.3k LOC, 19 pages) | ✅ React 19 SPA (47.8k LOC, 19 pages) |
| Web — component library | 🟡 hand-rolled | ✅ `@nous-research/ui` 50+ primitives |
| Web — plugin SDK / slot registry | ❌ | ✅ 30+ slots (backdrop, header, overlay, etc.) |
| Web — profile management | ❌ | ✅ ProfileBuilder wizard + ProfileSwitcher |
| Web — in-browser skill editor | ❌ | ✅ |
| Web — embedded xterm terminal | ❌ | ✅ ChatPage embeds TUI via xterm.js + PTY |
| Web — i18n | 🟡 **8 locales** (en, vi, zh, ja, ko, es, fr, de) | ✅ **16 locales** |
| Desktop | ✅ Tauri 2 (Rust IPC, `myagent://` deep-link, single-instance) | ✅ Electron 40 |
| Collab (multi-user) | 🟡 display-only relay (no E2E, no CRDT) | ❌ (single-user) |
| WireEnvelope (seq/replay) | ✅ per-session 10k-event buffers + `?since=seq` | ❌ |
| Voice / STT | 🟡 TTS only + voice call + basic STT | ✅ continuous voice mode (STT→agent pipeline) |

### 3.7 Cron / Scheduling

| Capability | **mya** | **Hermes** |
|------------|---------|------------|
| Scheduler | ✅ `packages/cron/` (atomic claim + TTL lease) | ✅ `cron/scheduler.py` (3,638 LOC, flock cross-process lock) |
| At-most-once across crashes | 🟡 per-job TTL lease | ✅ pre-exec advance + claim + post-exec mark |
| Catch-up with grace window | 🟡 "run now if past due" | ✅ fire-once + fast-forward (MIN_GRACE=120, MAX_GRACE=7200) |
| One-shot grace | ❌ | ✅ `ONESHOT_GRACE_SECONDS=120` |
| Lifecycle guard | ❌ | ✅ `cron/lifecycle_guard.py` |
| Prompt-injection scanner | ✅ 17 threat patterns + invisible-Unicode block | ❌ |
| Snapshot-drift check | ✅ (mya-only) | ❌ |
| Base URL exfil guard | ✅ | ❌ |
| **Agent-callable scheduling** | ✅ `packages/cron/src/agent-tools.ts` — `cron_create/list/delete/run` as `ToolImpl` (MAX_AGENT_JOBS=10, `agent-` prefix enforced) | ✅ `tools/cronjob_tools.py` (full CRUD from agent) |
| Cron security tests | ✅ | ❌ |

### 3.8 Security

| Capability | **mya** | **Hermes** |
|------------|---------|------------|
| Permission pipeline depth | ✅ 7-step (DangerFullAccess always-escalates, ask-rules inviolable) | 🟡 4-mode |
| Structural redaction (2-pass) | ✅ `packages/secrets/` (field-name before value-scan) | ❌ |
| Merkle hash-chain audit | ✅ `packages/audit/` (tamper-evident, recovery FSM) | ❌ (usage accounting only) |
| **OSV vulnerability check** | ✅ `osvCheckTool` — `packages/tools/src/osv-check.ts` | ✅ `tools/osv_check.py` |
| **URL safety** | ✅ `urlSafetyTool` — `packages/tools/src/url-safety.ts` (DNS SSRF guard + blocklist) | ✅ `tools/tirith_security.py` |
| WebAuthn | ✅ `packages/secrets/src/webauthn.ts` | ❌ |
| Sigstore signing + NPM provenance | ✅ `packages/signing/` | ❌ |
| ACP triple-gate relay | ✅ `packages/acp/` (external + my gate + human) | ❌ |
| Pairing (device auth) | ✅ 8-char codes, 1h expiry, 5-attempt lockout | ❌ |
| Project trust store | ✅ `~/.my-agent/trust/` (symlink defense) | ❌ |
| Eval egress guard + freshness warn | ✅ 3-tier eval harness | ❌ |
| MCP dashboard OAuth | ❌ | ✅ |
| Secrets management (Bitwarden/1Password/Command) | ❌ | ✅ `agent/secret_sources/` |
| Exact-pinned deps (supply chain) | ✅ Cargo.lock + npm shrinkwrap | ✅ exact-pinned `pyproject.toml` |

### 3.9 Payment, Sync, Workflows, & Other

| Capability | **mya** | **Hermes** |
|------------|---------|------------|
| x402 payment protocol (HTTP 402 micropayments) | ✅ `packages/x402/` (ECDSA secp256k1, paid_fetch tool) | ❌ |
| DAP (Debug Adapter Protocol) client + server | ✅ `packages/dap/` + `packages/dap-server/` | ❌ |
| HLC + LWW sync (cross-machine) | ✅ `packages/sync/` | ❌ (single-user) |
| Collab relay (multi-user rooms) | ✅ `packages/collab/` | ❌ |
| Workflow runner (VM + worker_thread + Rhai) | ✅ `packages/workflows/` | ❌ |
| JSON-RPC (stdio + TCP) | ✅ `packages/rpc/` | ❌ (uses ACP) |
| CoW overlay (FICLONE ioctl) | ✅ `crates/natives/` | ❌ |
| Rhai script eval | ✅ (Rust natives) | ❌ |
| Context compression engine | ✅ `packages/prompts/src/compress.ts` (ported from Hermes) | ✅ `agent/conversation_compression.py` |
| MCP lifecycle (11-phase FSM) | ✅ `mcp-lifecycle.ts` (ported from Hermes) | ✅ `tools/mcp_tool.py` |
| Daemon pool | ❌ (AgentPool LRU+TTL only) | ✅ `tools/daemon_pool.py` |
| Systemd / cgroup lifecycle | ❌ | ✅ `cgroup_cleanup.py`, `systemd_notify.py`, `scale_to_zero.py` |
| Terminal backends | ❌ | ✅ 6 (local/Docker/SSH/Singularity/Modal/Daytona) |
| Batch trajectory generation | ❌ | ✅ `batch_runner.py` |
| Spotify / Google Meet plugins | ❌ | ✅ `plugins/spotify/`, `plugins/google_meet/` |
| TTS (local MLX/Kokoro) | ✅ `packages/tts/` | ✅ |
| HTTP control plane (3-phase readiness) | ✅ `/health/{live,ready,functional}` | ❌ (platform-driven) |
| Sigstore native gate | ✅ | ❌ |

> **Authoritative mya tool surface:** `packages/print/src/mya-bridge.ts:1686` explicitly enumerates: `"Tools: code, paid_fetch, hashline_edit, browser_*, osv_check, check_url_safety, image_generate, video_generate, kanban, disk_cleanup, cron_create/list/delete/run, delegate_task, MCP tools"`. The `builtin-completeness.test.ts` test file asserts these tools exist.

---

## 4. mya-Unique Strengths (Hermes Lacks)

1. **x402 micropayment protocol** — HTTP 402 payment protocol with ECDSA wallet + paid_fetch tool
2. **DAP (Debug Adapter Protocol)** — full client + server (agent breakpoint/debugging on tool calls)
3. **Tamper-evident Merkle audit log** — SHA-256 hash-chain with recovery FSM + project trust levels
4. **HLC + LWW sync** — cross-machine ordering, push/pull state sync (Hermes is single-user)
5. **Multi-user collab relay** — WebSocket rooms with bounded event replay
6. **Workflow runner** — embedded VM + worker_thread + Rhai scripting
7. **ACP triple-gate permission relay** — external agent + my gate + human approval
8. **Structural 2-pass redaction** — field-name scrub before value-scan
9. **Weibull temporal decay** — principled forgetting curves (22 per-type)
10. **14 memory domains** — granular separation (graph/queue/sync/tree/diff/entities)
11. **Tier-based model routing** — central cost optimization (SMALL/BIG hints)
12. **7-step permission pipeline** — DangerFullAccess always-escalates, ask-rules inviolable
13. **WebAuthn + device pairing** — hardware-key auth + 8-char pairing codes
14. **Sigstore signing + NPM provenance** — supply-chain verification
15. **JSON-RPC (stdio + TCP)** — 2 transport modes beyond gateway
16. **Rust napi acceleration** — BLAKE3, tree-sitter AST, CoW reflink (FICLONE), Rhai eval, log compression
17. **Tauri deep-link** — `myagent://` URI scheme + single-instance + Rust IPC shell
18. **3-phase readiness probes** — `/health/{live,ready,functional}` streaming control plane
19. **Adversarial review** — Skeptic/Pragmatist/Critic council fan-out
20. **Codegraph + reference graph** — structural code understanding
21. **Eval harness** — 3-tier (UNIT/INTEGRATION/CREDENTIALED) with no-egress guard + 30d freshness warn
22. **Composio integration** — mature tool ecosystem connector
23. **Push notifications (VAPID/PWA)** — web push subscriptions
24. **Cron snapshot-drift guard** — detect provider/model drift in scheduled jobs
25. **Cron prompt-injection scanner** — 17 threat patterns + invisible-Unicode block
26. **Budget tree-accounting** — deriveChild, releasePrecharge, CC2 refund

---

## 5. Hermes-Unique Strengths (mya Lacks)

1. **31 plugin providers** (vs mya's 8 wired natively) — lazy install with venv-scoping + allowlist
2. **20+ plugin channels** (vs mya's 8) — per-platform identity, rate-limit, sticker cache
3. **8 pluggable memory backends** — mem0, openviking, byterover, supermemory, retaindb, honcho, holographic, hindsight (+ query_rewrite)
4. **Per-subagent IterationBudget** — parent=90, sub=50, thread-safe consume/refund
5. **Delegation depth control** — `delegation.max_spawn_depth` (configurable, default 1 = flat)
6. **6 terminal backends** — local/Docker/SSH/Singularity/Modal/Daytona (serverless persistence)
7. **Batch trajectory generation** — for training tool-calling models
8. **Continuous voice mode** — STT→agent pipeline (mya has TTS + voice call, no continuous mode)
9. **Widget grid SDK** — 2-axis layout + ambient zones + hot-load widgets in TUI
10. **In-browser skill editor** — `SkillEditorDialog.tsx`
11. **Web plugin SDK** — 30+ slot registry (backdrop, header, overlay, etc.)
12. **Profile management** — ProfileBuilder wizard + ProfileSwitcher (multi-island)
13. **Embedded xterm terminal** — ChatPage embeds TUI via xterm.js + PTY
14. **16-locale i18n** — (vs mya's 8)
15. **Daemon pool** — long-lived process supervisor
16. **Systemd / cgroup lifecycle** — scale-to-zero, shutdown watchdog, restart loop guard
17. **Secrets management** — Bitwarden/1Password/Command source registry with encrypted stale cache
18. **AST-discovered tool registry** — self-registering tools (removing a tool = file delete)
19. **Cron catch-up with grace window** — fire-once + fast-forward (fixes infinite-defer)
20. **Cron lifecycle guard** — restart-loop detection
21. **MCP dashboard OAuth** — `tools/mcp_dashboard_oauth.py`
22. **Spotify / Google Meet plugins**
23. **Theme/skin system** — seed→derived tone ladder, cross-surface sync, `hermes skin set`
24. **TUI markdown richness** — math rendering, footnotes, diff, audio directive
25. **TUI pet sprites / ambient charms** — petSprite, long-run tool charms, achievements
26. **Gateway recovery FSM** — 3-attempt/60s respawn budget

---

## 6. Where They Overlap (Both Strong)

| Area | Convergence |
|------|-------------|
| **Architecture** | Narrow waist (minimal core) + plugin edges; both have frozen core with capability pushed out |
| **3-tier prompt assembly** | Both use stable \| context \| volatile with cache-safe rebuild |
| **Provider abstraction** | Both have `ProviderProfile` (declarative dataclass/struct) |
| **Skills** | Both implement progressive disclosure (name+desc in prompt, body on invoke) + provenance tracking + curator |
| **Subagent isolation** | Both gate tools (denylist/frozenset vs allowedTools) |
| **Cron at-most-once** | Both claim before side effect |
| **Threat-pattern scanner** | Both scan injected context files for prompt injection |
| **Browser automation** | Both use Camofox |
| **Web search** | Both support 8 search backends |
| **Image/video generation** | Both have image_generate + video_generate tools |
| **OSV vuln check + URL safety** | Both have security scanning tools |
| **Kanban** | Both have agent-callable Kanban (mya ported from Hermes) |
| **Learning graph** | Both derive concept→concept graphs from memory facts |
| **Agent-callable cron** | Both expose cron_create/list/delete/run to the agent |
| **Context compression** | Both have multi-pass compaction (mya ported from Hermes) |
| **MCP** | Both have MCP client with reliability features (mya ported reconnect budget + park failures from Hermes) |
| **FTS5** | Both use external-content FTS5 + CJK bigram tokenizer (mya ported) |
| **TTS** | Both have local TTS (MLX/Kokoro) |
| **Disk cleanup** | Both have disk cleanup tools |
| **Tamper-evident history** | mya via Merkle hash-chain; Hermes via filesystem + SQL ledger |
| **Cross-process cron lock** | Both use advisory file locking |

---

## 7. Honest Verdict

### Positioning

**mya** is the **operations-grade agent**: structurally richer infrastructure (HTTP control plane with 3-phase readiness, 3 transport modes, multi-user collab, HLC sync, tamper-evident Merkle audit, x402 payments, DAP debugging, ACP relay, eval harness, workflow runner, Rust-native acceleration). It excels at **full-stack observability, security depth, and deterministic multi-process orchestration**. It is built on a TS+Rust foundation with strict type safety and invariant enforcement (§18: no `process::exit` in natives, single time helper, byte-faithful JSON). **~85% SPEC fidelity** with ~5,370 tests across 282 files.

**Hermes Agent** is the **product-richer, user-facing agent**: broader coverage (31 providers, 20+ channels, 8 memory backends, continuous voice mode), more polished daily-driver UX (widget SDK, web plugin slots, 16-locale i18n, in-browser skill editor, embedded xterm terminal, theme system), and superior deployment flexibility (6 terminal backends including serverless Modal/Daytona). It excels at **breadth of integrations and end-user polish**. It's built on Python with `uv`-managed exact-pinned deps (supply-chain hardening).

### Recommended Use Cases

| Use case | Recommended |
|----------|-------------|
| Multi-user collaboration / sync across machines | **mya** (HLC + LWW sync, collab rooms) |
| Enterprise security / tamper-evidence / compliance | **mya** (Merkle audit, 7-step permission, ACP triple-gate, structural redaction) |
| Code debugging with breakpoints on agent actions | **mya** (DAP client + server) |
| Operations / multi-process orchestration | **mya** (HTTP control plane, 3 transports, workflow runner) |
| Micropayments / paid tool calls | **mya** (x402 protocol) |
| Maximum provider/channel breadth | **Hermes** (31 providers, 20+ channels) |
| Serverless / cloud deployment | **Hermes** (Modal, Daytona, 6 terminal backends) |
| Multilingual / global user base | **Hermes** (16 locales vs 8) |
| Voice-first / continuous STT interaction | **Hermes** (continuous voice mode) |
| Extensible TUI dashboard with widgets | **Hermes** (widget grid SDK) |
| Training data / trajectory generation | **Hermes** (batch trajectory gen) |
| Media generation (images/video) | **Either** — both have image_generate + video_generate |

### What mya Could Learn from Hermes (Highest ROI)

1. **Plugin providers with lazy install** (M) — closes the 31 vs 8 natively-wired provider gap
2. **Per-subagent IterationBudget** (S, ~50 LOC) — deepest single subagent gap
3. **AST-based self-registering tool discovery** (S) — cleaner registry pattern
4. **Cron catch-up with grace window** (S) — fixes infinite-defer edge cases
5. **Web plugin SDK + slot registry** (L) — biggest UX gap
6. **Continuous voice mode (STT)** (L) — STT→agent pipeline
7. **Profile management** (M) — multi-island invariant
8. **Expand i18n from 8 to 16+ locales** (M) — mya already has 8; Hermes has 16
9. **Gateway recovery FSM** (S) — 3-attempt/60s respawn budget
10. **Daemon pool + systemd/cgroup lifecycle** (M) — for production multi-process deployments

### What Hermes Could Learn from mya

1. **x402 micropayment protocol** (M) — frontier payment pattern
2. **DAP server + client** (M) — agent debugging
3. **Structural 2-pass redaction** (S) — catches split-secret cases
4. **Tier-based model routing** (M) — central cost optimization
5. **Weibull temporal decay memory** (S) — principled forgetting
6. **Memory domains** (M) — better separation of concerns
7. **Merkle hash-chain audit** (S) — tamper-evidence + recovery FSM
8. **HLC + LWW sync + collab** (L) — multi-user is a real gap
9. **Workflow runner** (M) — embedded JS + Rhai scripting
10. **Eval harness + egress guard** (M) — principled evaluation

### Bottom Line

Both are independent, mature implementations of the same core problem (narrow-waist agent + plugins + memory + skills + channels + cron + multi-surface UI). Convergence is high (~65% surface overlap and rising — mya has already ported compression, MCP reliability, FTS5, kanban, image/video gen, OSV check, URL safety, learning graph, agent-callable cron, and disk cleanup from Hermes). **mya wins on operations, security depth, and infrastructure rigor; Hermes wins on breadth, polish, and deployment flexibility.** Neither subsumes the other — the highest-value path forward is continued cross-pollination.

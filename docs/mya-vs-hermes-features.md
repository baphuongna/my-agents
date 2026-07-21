# mya vs Hermes — Feature Parity Comparison

> Generated: 2026-07-21
> Source artifacts: `.crew/artifacts/team_20260721074248_a9d3686c521b40a0/shared/{02_explore-core, 03_explore-ui, 06_synthesize}.md`
> Convention: ✅ both have · 🟡 both have but different · ❌ one missing

## 0. Metadata

| Dimension | mya | Hermes |
|---|---|---|
| **Language** | TypeScript 7 + napi-rs Rust (Node ≥20 ESM) | Python 3.11+ (uv-pinned exact deps) |
| **Source size** | 31 TS packages + 3 Rust crates | 3,152 Python files (~1.5M LOC) |
| **LOC** | ~50K TS + ~440 LOC Rust natives | ~1.5M Python |
| **Tests** | 1,824/1,825 (1 pre-existing firecrawl flake) | 75+ vitest TUI + Python test suite |
| **Single binary** | `mya` (esbuild single-file bundle) | `hermes` (uv-run) |
| **Forked from** | `@earendil-works/pi-coding-agent` 0.80.10 | Independent (Nous Research) |
| **Vendored deps** | `packages/pi-agent-src/` + `packages/pi-ai-src/` (parallel copies) | `@nous-research/ui` (private pkg) |
| **Design system** | Tailwind 3 + RGB space-channel CSS vars | Tailwind 4 + `@nous-research/ui` primitives |
| **Web LOC** | ~4,500 LOC, 19 pages, 14 components | ~47,810 LOC, 19 pages, 26 components |
| **i18n** | 2 langs (en, vi) | 17 langs |
| **TUI** | Hand-rolled `packages/tui/` (1615L) | `@hermes/ink` (Ink fork) + `ui-tui/` (1069L+) |
| **Desktop** | Tauri 2 (`crates/desktop-shell`) | Electron 40 (`apps/desktop/`) |

**Package count note**: mya has 27 fork packages (excluding `pi-agent-src` + `pi-ai-src` vendored copies) or 29/31 if counted inclusively. This doc uses 27 to match `AGENTS.md` invariant.

**Rust channels note**: `FEATURE-CATALOG.md §6` mentions Rust channels (Gmail push, Notion, Linq, WeChat, TTS, voice call) that don't exist under `crates/` — the catalog appears aspirational. Channels are implemented as 8 TS adapters in `packages/gateway/src/channels*.ts`.

---

## 1. Agent Loop & Execution

| Feature | mya | Hermes | Marker |
|---|---|---|---|
| **Minimal frozen core** | `packages/core` (18 files: loop, session, budget, types) | AIAgent extracted into `agent/*.py` modules | ✅ |
| **3-tier prompt assembly** | `packages/prompts/src/assembler.ts` (stable/context/volatile) | `agent/conversation_loop.py` (same) | ✅ |
| **Threat-pattern scanner** | `packages/prompts/src/scan.ts` (Tier-1+2) | `agent/_scan_context_content` | ✅ |
| **Per-conversation prompt cache** | Single-shot context files | Single-shot context files | ✅ |
| **Per-subagent IterationBudget** | ❌ (only `BudgetConfig` token ceiling) | ✅ `agent/iteration_budget.py` (parent=90, sub=50, thread-safe consume/refund) | ❌ **Hermes-only** |
| **Delegation depth control** | ❌ (hardcoded one-level) | ✅ `delegation.max_spawn_depth` (default 2) | ❌ **Hermes-only** |
| **Subagent isolation** | `spawnSubagent/listSubagents/killSubagent` | `tools/delegate_tool.py` + `DELEGATE_BLOCKED_TOOLS` frozenset | ✅ |
| **Multi-agent council/fan-out** | `CouncilProvider` (attributed/majority/judge) | `moa_loop.py` (Mixture of Agents, up to 8 concurrent) | 🟡 |
| **Background review** | `HindsightReviewer` (single-turn critic) | `spawn_background_review` (daemon-thread fork replays snapshot) | 🟡 |
| **Adversarial review pattern** | ✅ (Skeptic/Pragmatist/Critic) | ❌ | ❌ **mya-only** |
| **Conversation loop size** | ~800 LOC | 5,785 LOC `agent/conversation_loop.py` | 🟡 different scale |

**Recommendation**: mya should adopt **`IterationBudget`** (S, ~50 LOC) — single biggest subagent gap.

---

## 2. Provider Integrations

| Feature | mya | Hermes | Marker |
|---|---|---|---|
| **Provider abstraction** | `ProviderProfile` + `ProviderRegistry` (taint/cooldown) | `ProviderProfile` dataclass + `Provider` transport | ✅ |
| **Providers wired** | **8** (OpenAI, Anthropic, Gemini, MiniMax, DeepSeek, Groq, Mistral, xAI, OpenRouter, Ollama) | **30+** plugin providers (alibaba, arcee, azure-foundry, bedrock, copilot, custom, deepinfra, deepseek, fireworks, gemini, gmi, huggingface, kilocode, kimi-coding, MiniMax, nous, novita, nvidia, ollama-cloud, openai-codex, opencode-zen, openrouter, qwen-oauth, stepfun, upstage, vertex, xai, xiaomi, zai) | ❌ **Hermes has 4× more** |
| **Lazy plugin install** | ❌ (hard-coded + vendored) | ✅ `tools/lazy_deps.py` (allowlist + venv-scoping) | ❌ **Hermes-only** |
| **OAuth (PKCE)** | ✅ `packages/ai/src/oauth.ts` | ✅ per-provider | ✅ |
| **Multi-provider fallback** | ✅ `streamWithFallback` ordered + skip-tainted | ✅ multi-provider registry keyed on env vars | ✅ |
| **Auth/quota taint tracking** | ✅ `ProviderRegistry` (not retried in session) | ⚠️ partial (per-provider) | 🟡 |
| **Central key rotation** | ✅ `key-rotation.ts` (KeyRouter, OVERLOADED/RATE_LIMITED/UNAUTHORIZED regex) | ⚠️ per-provider only | 🟡 |
| **Tier-based model routing** | ✅ `model-routing.ts` (SMALL_MODEL_HINTS, BIG_MODEL_HINTS, resolveModelForPhase) | ❌ not centralized | ❌ **mya-only** |
| **Codex vs chat-completion split** | Single `OpenAIAdapter` | Separate `codex_responses_adapter.py` + `codex_runtime.py` | 🟡 |

**Recommendation**: mya should adopt **plugin providers with lazy install** (M) — closes the 30+ vs 8 provider gap.

---

## 3. Tools (web, browser, code, etc.)

| Feature | mya | Hermes | Marker |
|---|---|---|---|
| **Tool registry** | `packages/tools/src/registry.ts` (explicit imports) | `tools/registry.py` (AST-discovered self-registration) | 🟡 |
| **Permission gate** | `packages/tools/src/permission.ts` (7 modes) | Hermes 4-mode (allow/deny/ask/auto) | 🟡 |
| **Built-in tools** | read/write/edit/bash/glob/grep/ls/find + hashline edit | read/write/edit/bash/glob/grep/ls/find | ✅ |
| **Browser (Camofox)** | ✅ `packages/tools/src/web/browser/camofox-client.ts` + cloud + resolver | ✅ `tools/browser_camofox.py` + supervisor | ✅ |
| **Web search backends** | **8** (Brave/Tavily/Exa/SearXNG/DDG/Firecrawl/Parallel/X) | **8** (brave_free, ddgs, exa, firecrawl, parallel, searxng, tavily, xai) | ✅ parity |
| **Web fetch** | ✅ `packages/tools/src/web/fetch.ts` (DNS SSRF G1, blocklist G2, output compression) | ✅ `tools/web_tools.py` + `tools/url_safety.py` | ✅ |
| **Code exec** | ✅ `packages/tools/src/codeexec.ts` | ✅ `tools/code_execution_tool.py` | ✅ |
| **LSP client** | ✅ `packages/tools/src/lsp-client.ts` + lsp-cascade | ✅ `agent/lsp/` | ✅ |
| **Screen capture** | ✅ `screenCaptureTool`, `screenFindTool` (desktop) | ⚠️ Computer-use (broader: `tools/computer_use/`, `skills/computer-use/`) | 🟡 different scope |
| **Composio integration** | ✅ `composio.ts` (ComposioClient, registerComposioTools) | ❌ | ❌ **mya-only** |
| **MCP dashboard OAuth** | ❌ | ✅ `tools/mcp_dashboard_oauth.py` | ❌ **Hermes-only** |
| **OSV vulnerability check** | ❌ | ✅ `tools/osv_check.py` | ❌ **Hermes-only** |
| **Tirith URL safety** | ❌ (mya has DNS SSRF guard instead) | ✅ `tools/tirith_security.py` | 🟡 different impl |
| **Image generation** | ❌ | ✅ `plugins/image_gen/` + `tools/image_generation_tool.py` | ❌ **Hermes-only** |
| **Video generation** | ❌ | ✅ `plugins/video_gen/` + `tools/video_generation_tool.py` | ❌ **Hermes-only** |
| **Kanban** | ❌ | ✅ `tools/kanban_tools.py`, `plugins/kanban/`, `gateway/kanban_watchers.py` | ❌ **Hermes-only** |
| **Trace upload / trajectory compressor** | ❌ | ✅ `agent/trace_upload.py`, `trajectory_compressor.py` | ❌ **Hermes-only** |
| **Tool repair** | ✅ `packages/tools/src/repair.ts` | ❌ | ❌ **mya-only** |
| **Symbol extractor (tree-sitter)** | ✅ `packages/tools/src/symbol-extractor.ts` (R via natives) | ❌ | ❌ **mya-only** |
| **Composio OAuth dashboard** | ❌ | ✅ `tools/mcp_dashboard_oauth.py` | ❌ **Hermes-only** |

**Recommendation**: mya should adopt **AST-based tool discovery** (S) and **image/video gen tools** (L) and **OSV vuln check** (S).

---

## 4. Memory & Knowledge

| Feature | mya | Hermes | Marker |
|---|---|---|---|
| **Storage backend** | SQLite FTS5 (unified) | Per-backend (mem0=PG, openviking=custom, etc.) | 🟡 |
| **5-layer pipeline** | ✅ ingest/store/lifecycle/retrieve/persist | ⚠️ multiple backends via plugins | 🟡 |
| **14 memory domains** | ✅ archivist/conversations/diff/entities/goals/graph/queue/search/sources/store/sync/tools/tree | ❌ not domain-organized | ❌ **mya-only** |
| **Weibull decay** | ✅ `packages/memory/src/weibull.ts` | ❌ (mem0 has its own) | ❌ **mya-only** |
| **BrainStore (facts/takes/pages)** | ✅ `BrainStore` (SQLite) | ⚠️ Hindsight plugin | 🟡 |
| **DreamCycle curator** | ✅ (4h interval, runs in main session) | ✅ `agent/curator.py::maybe_run_curator()` (inactivity-triggered, on **auxiliary AIAgent** for cache preservation) | 🟡 mya breaks cache |
| **Learning graph** | ❌ | ✅ `agent/learning_graph.py` + `_mutations` + `_render` | ❌ **Hermes-only** |
| **22 backend plugins** | ❌ | ✅ mem0, openviking, byterover, supermemory, retaindb, honcho, holographic, query_rewrite | ❌ **Hermes-only** (huge gap) |
| **Vector search** | ✅ via ragfs-bridge | ✅ per-backend | ✅ |
| **Ragfs bridge** | ✅ `packages/memory/src/ragfs-bridge.ts` | ❌ | ❌ **mya-only** |
| **Conflict resolution** | ✅ `packages/memory/src/conflict.ts` | ❌ | ❌ **mya-only** |
| **Scope-derived namespaces** | ✅ `packages/memory/src/scope-derived.ts` | ❌ | ❌ **mya-only** |
| **Governance grounding** | ✅ `packages/memory/src/governance.ts` | ❌ | ❌ **mya-only** |
| **RRF (Reciprocal Rank Fusion)** | ✅ `packages/memory/src/rrf.ts` | ❌ | ❌ **mya-only** |
| **Auto-capture** | ✅ `packages/memory/src/auto-capture.ts` | ❌ | ❌ **mya-only** |
| **Migration tool** | ✅ `packages/memory/src/migrate.ts` | ❌ | ❌ **mya-only** |

**Recommendation**: mya should adopt **22 memory backends plugin system** (L) — biggest memory gap. Hermes should adopt **Weibull decay** (S) + **14 memory domains** (M).

---

## 5. Skills & Prompts

| Feature | mya | Hermes | Marker |
|---|---|---|---|
| **Progressive disclosure** | ✅ name+desc in prompt, body on invoke | ✅ same | ✅ |
| **Frontmatter parser** | ✅ `parseSkillMarkdown` | ✅ | ✅ |
| **Provenance enum** | ✅ 4-value (`SkillProvenance`) | ✅ | ✅ |
| **Curator** | ✅ `DreamCycle` (4h interval) | ✅ `maybe_run_curator()` (inactivity-triggered, on auxiliary AIAgent) | 🟡 |
| **Skill categories** | ~50+ in `packages/skills` | 22 categories (apple, autonomous-ai-agents, computer-use, creative, data-science, dogfood, email, github, hermes-desktop-plugins, index-cache, media, mlops, note-taking, productivity, research, smart-home, social-media, software-development, yuanbao) | 🟡 |
| **In-browser skill editor** | ❌ (SkillsPage lists only) | ✅ `components/SkillEditorDialog.tsx` (headless-friendly SKILL.md editor) | ❌ **Hermes-only** |
| **Compoio skill install** | ✅ via `composio.ts` | ❌ | ❌ **mya-only** |
| **Skill bundle discovery** | ✅ (manifest-based via `pkg`) | ✅ (lazy install) | ✅ |
| **Skill search index** | ✅ (curator.ts) | ✅ (index-cache category) | ✅ |

**Recommendation**: mya should add **in-browser skill editor** (M) — improves the no-CLI authoring experience.

---

## 6. Channels (Telegram, Discord, Slack, etc.)

| Feature | mya | Hermes | Marker |
|---|---|---|---|
| **Channel adapters** | 8 TS adapters in `packages/gateway/src/channels*.ts` | 20+ plugin platforms | ❌ Hermes has 2.5× |
| **Specific channels** | Telegram, Discord, Slack, WeChat, Gmail, Linq, Notion (TS); voice call, TTS (per FEATURE-CATALOG) | dingtalk, discord, email, feishu, google_chat, homeassistant, irc, line, matrix, mattermost, ntfy, photon, raft, simplex, slack, sms, teams, telegram, wecom, whatsapp, bluebubbles, msgraph, qqbot, signal, yuanbao | 🟡 |
| **Per-platform identity** | ⚠️ basic OAuth | ✅ native identity (`whatsapp_identity.py`) | ❌ |
| **Sticker cache** | ❌ | ✅ | ❌ |
| **Media routing** | ⚠️ generic | ✅ per-platform | 🟡 |
| **Rate-limit guards** | ❌ | ✅ per-platform | ❌ |
| **Channel as agent context** | ✅ `ChannelSessionRouter` | ✅ | ✅ |
| **Channel setup CLI** | ✅ `packages/gateway/src/channel-setup.ts` | ✅ | ✅ |
| **Channel MCP lifecycle** | ✅ `packages/gateway/src/mcp-lifecycle.ts` | ✅ via MCP plugins | ✅ |
| **Hooks** | ✅ `packages/channels/src/hooks.ts` | ❌ | ❌ **mya-only** |
| **Channels CLI** | ✅ `packages/print/src/channels-cli.ts` | ✅ | ✅ |

**Recommendation**: mya should adopt **per-platform identity + rate-limit + sticker cache** patterns (M) from Hermes. Both should converge on a plugin-channel model.

---

## 7. TUI

| Feature | mya (`@my-agent/tui`) | Hermes (`@hermes/ink` + `ui-tui/`) | Marker |
|---|---|---|---|
| **Architecture** | Hand-rolled classes (TUI, Container, Component); differential rendering; no React | React 19 + custom Ink fork + nanostores | 🟡 |
| **Component primitives** | 12 widgets, 6 utils, 25+ selectors in `coding-agent` | 17 named overlays (agents, approval, billing, clarify, etc.) | 🟡 |
| **Editor** | `Editor` (2254L) — paste-marker, undo, kill ring, autocomplete | `textInput.tsx` (1381L) — grapheme cache, OSC 52, multi-click | 🟡 both polished |
| **Markdown** | `Markdown` (779L) — basic, strict strikethrough | `markdown.tsx` (1066L) — **math, footnotes, diff, audio directive** | 🟢 Hermes richer |
| **Image** | `Image` (Kitty + iTerm2) | `petSprite.tsx` (truecolor half-block grids) | 🟡 |
| **Loader** | `Loader`, `CancellableLoader` | `thinking.tsx` (1162L) — subagent tree, sparkline, hotness bucket | 🟢 Hermes heavier |
| **Spinners** | hardcoded | `unicode-animations` (helix, breathe, orbit, dna, etc.) | 🟡 |
| **Keybindings** | `KeybindingsManager` + declaration merging | hotkey table; IDE-aware (VSCode/Cursor) | 🟡 |
| **Kitty protocol** | ✅ full (keyboard, image, OSC 11/4/10, hyperlinks) | ✅ + `forceTruecolor.ts` early import trick | 🟢 |
| **Status bar** | `FooterComponent` (246L) — token/cost/git | `appChromeStatusRule` + **ambient charms** for long tools | 🟢 Hermes unique |
| **Tab completion** | wired in interactive mode | `useCompletion.ts` (60ms debounce) | 🟡 |
| **Wheel scroll** | `wheelAccel.ts`, `precisionWheel.ts` | sticky-frame budget, scroll-anchor | 🟡 |
| **Voice / STT** | `voice-stt.ts` (gateway) | `voice.status` events, `voiceMode` slash command | 🟡 |
| **Recovery** | single process | `gatewayRecovery.ts` (3 attempts/60s respawn) | ❌ **Hermes-only** |
| **Content bundles** | none | `content/charms.ts`, `content/faces.ts`, `content/fortunes.ts`, `content/placeholders.ts`, `content/verbs.ts` | ❌ **Hermes-only** |
| **Test depth** | TUI classes unit tested | 75+ vitest files (textInput, viewport, completion, gatewayRecovery, …) | 🟢 Hermes deeper |
| **Pet sprites** | ❌ | ✅ `petSprite.tsx` + `petFlashStore` | ❌ **Hermes-only** |
| **Long-run tool charms** | ❌ | ✅ `useLongRunToolCharms.ts` (ambient activity) | ❌ **Hermes-only** |
| **Achievements** | ❌ | ✅ `plugins/hermes-achievements/` | ❌ **Hermes-only** |

**Recommendation**: mya should adopt **gateway recovery** (S) and **ambient charms** (S) for long-tool UX. Hermes should adopt **declaration-merged keybindings** (S) for extension surface.

---

## 8. Web Dashboard

| Feature | mya | Hermes | Marker |
|---|---|---|---|
| **Stack** | React 19 + react-router 7 + Tailwind 3 + lucide-react | React 19 + react-router 7 + Tailwind 4 + `@nous-research/ui` + Three.js + GSAP | 🟡 |
| **Pages** | **19** | **19** | ✅ parity |
| **Layout** | `App.tsx` (133L) — Sidebar + Header | `App.tsx` (1100L) — Sidebar + PluginSlot + ProfileSwitcher | 🟡 |
| **Component library** | Hand-rolled (Button, Card, Badge) | `@nous-research/ui` 0.18.2 — 50+ primitives | 🟢 Hermes richer |
| **Themes** | 4 (Dark, Midnight, Teal, …) | 5 builtin + backend-synced (palette + typography + layout per theme) | 🟢 |
| **i18n** | 2 langs (en, vi) | 17 langs | 🟢 Hermes |
| **Modal** | `lib/modal.tsx` (escape/scroll-lock/focus-trap) | `useModalBehavior` + Radix Dialog | ✅ |
| **Markdown** | `Markdown.tsx` (137L) — basic | `Markdown.tsx` (324L) — **streaming caret** | 🟡 |
| **Cron builder** | `ScheduleBuilder.tsx` (108L) — 5 modes | `ScheduleBuilder.tsx` (214L) — 4 modes + interval unit | 🟡 |
| **Skill editor** | ❌ (listing only) | ✅ `SkillEditorDialog.tsx` (156L) — in-browser SKILL.md | ❌ **Hermes-only** |
| **Model picker** | `ModelPickerDialog.tsx` (106L) | `ModelPickerDialog` + `ModelInfoCard` + `ReasoningPicker` + `ModelReloadConfirm` (4 components) | 🟡 |
| **Chat UI** | `ChatPage.tsx` (267L) — REST + WS streaming | `ChatPage.tsx` (1479L) — **embeds TUI via xterm.js + PTY** | 🟢 Hermes unique |
| **Console** | ❌ | ✅ `HermesConsoleModal.tsx` (474L) — xterm-based PTY to gateway | ❌ **Hermes-only** |
| **Plugin SDK** | ❌ | ✅ `web/src/plugins/` — slot registry (backdrop, header-banner, header-left, header-right, pre-main, post-main, overlay) | ❌ **Hermes-only** |
| **Profile management** | ❌ (no profile concept) | ✅ ProfilesPage + ProfileBuilderPage (5-step wizard) + ProfileSwitcher + ProfileScopeBanner + ProfileKeyedRoutes | ❌ **Hermes-only** |
| **Pairing UI** | RichInfoPage stub | PairingPage + 17 backend handlers | 🟢 |
| **Webhooks UI** | RichInfoPage stub | WebhooksPage | 🟢 |
| **Auth widget** | ❌ | ✅ AuthWidget + OAuth providers card + login modal | ❌ **Hermes-only** |
| **Push notifications** | PushPage + VAPID | ❌ (TUI/desktop show native) | 🟡 |
| **PWA** | `pwa-register.ts` + `push-subscription.ts` | ❌ (Electron/TUI is primary) | 🟡 |
| **Error boundary** | `ErrorBoundary.tsx` | per-page error states | 🟡 |
| **Command palette** | Cmd+K | cmdk + native in desktop | ✅ |
| **Tooltip warmup** | ❌ | ✅ 300ms "warm" suppression | ❌ **Hermes-only** |

**Recommendation**: mya should adopt **web plugin SDK + slot registry** (L), **profile management** (M), **in-browser skill editor** (M), **17-locale i18n** (M).

---

## 9. Cron / Scheduling

| Feature | mya | Hermes | Marker |
|---|---|---|---|
| **Scheduler** | `packages/cron/src/index.ts` (single-process atomic claim + TTL lease) | `cron/scheduler.py` (3638L, InProcessCronScheduler, 60s daemon thread, `flock` cross-process lock) | 🟡 |
| **At-most-once across crashes** | ⚠️ per-job TTL lease + atomic claim | ✅ pre-exec advance + claim + post-exec mark | 🟡 Hermes more correct |
| **Catch-up algorithm** | ⚠️ "if past due, run now" | ✅ fire-once + fast-forward with grace window (`MIN_GRACE=120, MAX_GRACE=7200`); fixes `#33315` infinite-defer | 🟡 |
| **One-shot grace** | ❌ | ✅ `ONESHOT_GRACE_SECONDS=120` | ❌ **Hermes-only** |
| **Drift prevention** | ✅ snapshot-drift (provider/model snapshot) | ✅ `compute_next_run(last_run_at)` | 🟡 |
| **Lifecycle guard** | ❌ | ✅ `cron/lifecycle_guard.py` (restart-loop detection) | ❌ **Hermes-only** |
| **Shell jobs** | ✅ `MYA_CRON_ALLOW_SHELL=1` | ✅ `tools/cronjob_tools.py` | ✅ |
| **Agent-callable scheduling** | ❌ (R2-4 file-layer gate by design) | ✅ `tools/cronjob_tools.py` (1137L, full CRUD from agent) | ❌ **Hermes-only** |
| **Per-job skills / context_from** | ✅ | ⚠️ limited | 🟡 |
| **Base URL exfil guard** | ✅ | ❌ | ❌ **mya-only** |
| **Snapshot drift guard** | ✅ (myA-only) | ❌ | ❌ **mya-only** |
| **Prompt scanner (Tier-1+2)** | ✅ | ❌ | ❌ **mya-only** |
| **Cron pages in web** | CronPage + ScheduleBuilder + AutomationBlueprints | CronPage + ScheduleBuilder + Blueprints | ✅ |
| **Cron observability** | ✅ `packages/print/src/cron-observability.ts` | ❌ | ❌ **mya-only** |
| **Cron integration tests** | ✅ | ✅ | ✅ |
| **Cron security tests** | ✅ `packages/cron/src/cron-security.test.ts` | ❌ | ❌ **mya-only** |
| **Cron role gate** | ✅ `packages/print/src/cron-role.ts` | ❌ | ❌ **mya-only** |

**Recommendation**: mya should adopt **pre-exec advance + post-exec mark ordering** (M), **catch-up with grace window** (S, fixes `#33315`), and **lifecycle_guard** (S).

---

## 10. Sync / Collaboration

| Feature | mya | Hermes | Marker |
|---|---|---|---|
| **HLC timestamps** | ✅ `packages/sync/src/index.ts` (cross-machine ordering) | ❌ (single-user) | ❌ **mya-only** |
| **LWW (Last-Writer-Wins)** | ✅ | ❌ | ❌ **mya-only** |
| **Push/pull state** | ✅ | ❌ | ❌ **mya-only** |
| **Collab room relay** | ✅ `packages/collab/src/relay.ts` (WS, bounded event replay) | ❌ | ❌ **mya-only** |
| **CollabPage in web** | ✅ | ❌ | ❌ **mya-only** |
| **Multi-user sessions** | ✅ via collab rooms | ❌ single-user | ❌ **mya-only** |
| **WireEnvelope (seq/replay)** | ✅ | ❌ | ❌ **mya-only** |

**Recommendation**: Hermes should adopt **HLC + LWW sync** + **CollabRelay** (L) — multi-user is a real product gap.

---

## 11. Security / Sandboxing

| Feature | mya | Hermes | Marker |
|---|---|---|---|
| **Permission gate** | 7 modes (allow/deny/ask/auto/…) | 4 modes (allow/deny/ask/auto) | 🟡 |
| **Tool permission review** | ✅ `permission-review.ts` | ❌ | ❌ **mya-only** |
| **Structural redaction (H2 two-pass)** | ✅ `makeSecretRedactor` in `packages/secrets/src/index.ts` (field-name before value-scan) | ❌ | ❌ **mya-only** |
| **Merkle hash-chain audit** | ✅ `packages/audit/src/index.ts` (tamper-evident; recovery FSM; project trust levels) | ❌ (only usage accounting, no tamper-evidence) | ❌ **mya-only** |
| **Audit recovery FSM** | ✅ `recovery-trust.test.ts` | ❌ | ❌ **mya-only** |
| **SecretRef discriminated union** | ✅ (env/file/exec/keyring) | ❌ | ❌ **mya-only** |
| **WebAuthn** | ✅ `packages/secrets/src/webauthn.ts` + `/auth/webauthn/*` | ❌ | ❌ **mya-only** |
| **Pairing** | ✅ `/pair/{request,accept,devices}` (8-char codes, 1h expiry, 5-attempt lockout) | ❌ | ❌ **mya-only** |
| **Sigstore verification** | ✅ `packages/signing/src/index.ts` + npm provenance | ❌ | ❌ **mya-only** |
| **ACP triple-gate permission relay** | ✅ `packages/acp/src/index.ts` (external agent + my gate + human approval) | ❌ | ❌ **mya-only** |
| **MCP dashboard OAuth** | ❌ | ✅ `tools/mcp_dashboard_oauth.py` | ❌ **Hermes-only** |
| **OSV vuln check** | ❌ | ✅ `tools/osv_check.py` | ❌ **Hermes-only** |
| **Tirith URL safety** | ❌ (mya has DNS SSRF guard) | ✅ `tools/tirith_security.py` | 🟡 different impl |
| **Security guidance plugin** | ❌ | ✅ `plugins/security-guidance/` | ❌ **Hermes-only** |
| **Eval egress guard** | ✅ (no-network fixture gate) | ❌ | ❌ **mya-only** |
| **Freshness warn (30d)** | ✅ | ❌ | ❌ **mya-only** |
| **3-tier eval harness** | ✅ (UNIT/INTEGRATION/CREDENTIALED) | ❌ | ❌ **mya-only** |
| **Drift grader** | ✅ `packages/prompts/src/drift.ts` + `packages/eval/src/drift.ts` | ❌ | ❌ **mya-only** |
| **Egress control (MCP)** | ✅ `mcp-lifecycle.ts` | ✅ | ✅ |

**Recommendation**: mya should adopt **OSV vuln check** (S) and **MCP dashboard OAuth** (S). Hermes should adopt **structural redaction** (S) and **Merkle audit** (S).

---

## 12. Voice / TTS

| Feature | mya | Hermes | Marker |
|---|---|---|---|
| **Local TTS** | ✅ `packages/tts/src/` (Apple Silicon MLX / Kokoro, model manager, auto-download, cache) | ✅ | ✅ |
| **TTS channel integration** | ✅ `crates/mya-channels/src/tts.rs` (per FEATURE-CATALOG; not in current `crates/`) | ✅ | ✅ |
| **Voice call** | ✅ voice-call.ts (per FEATURE-CATALOG) | ✅ | ✅ |
| **STT** | ✅ `voice-stt.ts` (gateway) | ✅ | ✅ |
| **Continuous voice mode** | ❌ | ✅ `voice_mode.py` + `transcription_tools.py` | ❌ **Hermes-only** |
| **`voiceMode` slash command** | ❌ | ✅ | ❌ **Hermes-only** |
| **Voice events in TUI** | ⚠️ basic | ✅ `voice.status`, `voice.transcript` events | 🟡 |
| **TTS model manager** | ✅ `packages/tts/src/model-manager.ts` | ❌ | ❌ **mya-only** |

**Recommendation**: mya should adopt **continuous voice mode** (L) — STT→agent pipeline.

---

## 13. Misc / Cross-cutting

| Feature | mya | Hermes | Marker |
|---|---|---|---|
| **x402 wallet (HTTP 402 micropayments)** | ✅ `packages/x402/src/index.ts` (ECDSA secp256k1 + paid_fetch tool) | ❌ | ❌ **mya-only** |
| **DAP (Debug Adapter Protocol)** | ✅ `packages/dap/` (client) + `packages/dap-server/` (server, launch/attach modes) | ❌ | ❌ **mya-only** |
| **JSON-RPC transports** | ✅ `packages/rpc/` (stdio + TCP) | ❌ (uses ACP) | ❌ **mya-only** |
| **ACP (Agent Client Protocol) bridge** | ✅ `packages/acp/src/index.ts` (triple-gate) | ❌ | ❌ **mya-only** |
| **Tauri deep-link + single-instance** | ✅ `crates/desktop-shell` (`myagent://` URI scheme) | ❌ (Electron) | ❌ **mya-only** |
| **CoW overlay isolation (FICLONE ioctl)** | ✅ `reflink_or_copy` in `crates/natives/src/lib.rs` | ❌ | ❌ **mya-only** |
| **Tree-sitter TS symbol extraction** | ✅ `parse_ts_symbols` in `crates/natives/src/lib.rs` | ❌ | ❌ **mya-only** |
| **Rhai script eval** | ✅ `eval_rhai` in `crates/natives/src/lib.rs` | ❌ | ❌ **mya-only** |
| **Log compression** | ✅ `compress_log` in natives | ❌ | ❌ **mya-only** |
| **Token approx** | ✅ `approx_tokens` in natives | ❌ | ❌ **mya-only** |
| **PWA support** | ✅ manifest + SW + push | ❌ (Electron/TUI) | 🟡 |
| **Workflow runner (vm + worker_thread + Rhai)** | ✅ `packages/workflows/src/` (vm sandbox + Rhai + per-call event sink) | ❌ | ❌ **mya-only** |
| **3 transport modes** | print/sdk/rpc/gateway | 1 (gateway) | 🟢 mya |
| **Streaming control plane (3-phase readiness)** | ✅ `/health/{live,ready,functional}` | ❌ (platform-driven) | ❌ **mya-only** |
| **Codegraph** | ✅ `packages/tools/src/codegraph.ts` | ❌ | ❌ **mya-only** |
| **Reference graph** | ✅ `packages/tools/src/reference-graph.ts` | ❌ | ❌ **mya-only** |
| **Path safety** | ✅ `packages/tools/src/path-safety.ts` | ❌ | ❌ **mya-only** |
| **Diagnostic / drift detection** | ✅ | ❌ | ❌ **mya-only** |
| **Spotify integration** | ❌ | ✅ `plugins/spotify/` | ❌ **Hermes-only** |
| **Google Meet** | ❌ | ✅ `plugins/google_meet/` | ❌ **Hermes-only** |
| **Disk cleanup** | ❌ | ✅ `plugins/disk-cleanup/` | ❌ **Hermes-only** |
| **Microsoft Graph OAuth** | ❌ | ✅ `tools/microsoft_graph_*` | ❌ **Hermes-only** |
| **Feishu/WeChat/Lark docs** | ❌ | ✅ `tools/feishu_*` | ❌ **Hermes-only** |
| **Daemon pool** | ❌ (AgentPool LRU+TTL only) | ✅ `tools/daemon_pool.py` (long-lived process supervisor) | ❌ **Hermes-only** |
| **Systemd / cgroup lifecycle** | ❌ | ✅ `cgroup_cleanup.py`, `systemd_notify.py`, `restart_loop_guard.py`, `scale_to_zero.py`, `shutdown_watchdog.py` | ❌ **Hermes-only** |
| **22 skill categories** | ~50+ (un-categorized) | 22 (apple, autonomous-ai-agents, computer-use, creative, data-science, dogfood, email, github, hermes-desktop-plugins, index-cache, media, mlops, note-taking, productivity, research, smart-home, social-media, software-development, yuanbao) | 🟡 |
| **Plugin manifest** | ✅ `agent-package.json` + 4 kinds | ✅ | ✅ |
| **Native sigstore gate** | ✅ §14b (ext verification) | ❌ | ❌ **mya-only** |
| **Tarball sigstore** | ✅ §23 | ❌ | ❌ **mya-only** |
| **NPM provenance** | ✅ best-effort | ❌ | ❌ **mya-only** |
| **Lazy install allowlist** | ❌ (mya uses static deps) | ✅ `tools/lazy_deps.py` | ❌ **Hermes-only** |
| **AST-discovered tool registry** | ❌ (explicit imports) | ✅ `tools/registry.py` | ❌ **Hermes-only** |
| **HTTP control plane** | ✅ full (`/sessions`, `/cron`, `/config`, `/tools`, `/models`, `/health/{live,ready,functional}`) | ❌ direct (platform-driven) | 🟢 mya moat |
| **In-process extension loader (jiti)** | ✅ `packages/pkg/src/index.ts` | ❌ | ❌ **mya-only** |

---

## 14. Summary Tallies

### mya-only capabilities (moat or accidental)
1. x402 wallet (HTTP 402 micropayments)
2. DAP server + client
3. Tier-based model routing
4. Structural redaction (H2 two-pass)
5. Weibull decay memory
6. 14 memory domains
7. BrainStore (SQLite unified memory)
8. ACP triple-gate permission relay
9. Composio integration
10. Eval egress guard + freshness warn
11. Cron snapshot-drift
12. 3 transport modes (print/sdk/rpc/gateway)
13. Codegraph + reference graph
14. Path safety + repair
15. Tamper-evident Merkle audit
16. Deep-link `myagent://`
17. Tauri deep-link + single-instance
18. CoW overlay (FICLONE ioctl)
19. Tree-sitter TS symbol extraction
20. Rhai script eval
21. HLC + LWW sync
22. Collab relay (multi-user)
23. Workflow runner (vm + worker_thread + Rhai)
24. JSON-RPC stdio + TCP
25. WebAuthn + pairing
26. Sigstore + NPM provenance
27. Adversarial review pattern (Skeptic/Pragmatist/Critic)
28. Streaming control plane (3-phase readiness)
29. In-process jiti extension loader
30. Push notifications (VAPID)

### Hermes-only capabilities (potential mya gaps)
1. 30+ plugin providers (vs mya's 8)
2. 20+ plugin channels (vs mya's 8)
3. 22 memory backends
4. 22 skill categories
5. Image generation
6. Video generation
7. Learning graph
8. Pets / Petdex / mascots
9. Kanban
10. Voice continuous mode (STT→agent)
11. OSV vulnerability check
12. Tirith URL safety
13. MCP dashboard OAuth
14. Agent-callable scheduling (`cronjob_tools.py`)
15. Cron one-shot grace
16. Cron lifecycle_guard
17. Cron pre-exec advance + post-exec mark ordering
18. Cron empirical catch-up grace
19. Profile system (multi-island)
20. Per-platform identity/cache/rate-limit
21. Plugin lazy install with allowlist
22. AST-discovered tool registry
23. Daemon pool
24. Systemd / cgroup lifecycle ops
25. 17-locale i18n
26. Theme presets (backend-synced)
27. Embedded xterm.js terminal in chat
28. HermesConsoleModal (xterm PTY)
29. Web plugin slot registry (30+ slots)
30. In-browser skill editor
31. Auth widget + OAuth providers card
32. Spotify / Google Meet / disk cleanup plugins
33. Microsoft Graph OAuth + Feishu/WeChat/Lark
34. Achievements system
35. Long-run tool charms (ambient activity)
36. Webhook pages
37. Pairing UI
38. `delegation.max_spawn_depth`
39. `IterationBudget` per-subagent
40. Cross-process cron lock
41. Plugin providers declarative dataclasses
42. Recovery FSM (gateway respawn 3 attempts/60s)
43. Tooltip warmup (300ms)
44. Pet sprites / truecolor half-block
45. Spanforce `^~~` strikethrough in markdown

### Both have, differently
- Providers: mya = 8 hard-coded, Hermes = 30+ lazy plugins
- Cron at-most-once: mya = claim+TTL only, Hermes = advance→claim→execute→mark
- Memory: mya = unified 5-layer SQLite, Hermes = 22 backends via plugins
- Subagents: mya = spawn/wait/abort, Hermes = blocked-tool frozenset + per-thread approval
- Skills curator: mya = DreamCycle in main (breaks cache), Hermes = on auxiliary (cache-preserving)
- Prompts: mya = 3-tier in assembler, Hermes = stable|context|volatile with threat-scan context files
- TUI: mya = hand-rolled, Hermes = Ink + nanostores
- Voice: mya = TTS only, Hermes = STT+continuous+TTS
- Desktop: Tauri vs Electron
- Audit: Merkle hash-chain vs trace upload
- Web stack: Tailwind 3 + hand-rolled vs Tailwind 4 + `@nous-research/ui`

---

## 15. Top Recommendations (priority order)

### mya should adopt from Hermes

| # | Feature | Effort | ROI | Notes |
|---|---|---|---|---|
| 1 | **Plugin providers with lazy install** | M | **HIGH** | Closes 30+ vs 8 provider gap; reuse `tools/lazy_deps.py` allowlist pattern |
| 2 | **`IterationBudget` per-subagent** | S (~50 LOC) | **HIGH** | Mirrors existing `BudgetConfig`; deepest single gap |
| 3 | **Cron pre-exec advance + post-exec mark ordering** | M | **HIGH** | Fixes mark-before-async-turn anti-pattern; mya has Phase 0A + D2 soft-fail already |
| 4 | **Cron catch-up with grace window** | S | **HIGH** | Port `_compute_grace_seconds`; fixes `#33315`-style infinite-defer |
| 5 | **ProfileSwitcher + per-profile remount + ProfileScopeBanner** | M | **HIGH** | Multi-island invariant; gateway endpoint already exists |
| 6 | **Web plugin manifest + slot registry (30+ slots)** | L | **HIGH** | Single biggest UX gap — mya React has zero plugin surface |
| 7 | **AST-based self-registering tool discovery** | S | MEDIUM | Hermes `tools/registry.py` pattern is cleaner |
| 8 | **Image / video generation tools** | L | MEDIUM | Significant capability gap |
| 9 | **Voice continuous mode (STT)** | L | MEDIUM | mya has TTS + voice call; missing continuous mode |
| 10 | **22 memory backends plugin system** | L | MEDIUM | Allow mem0/openviking/etc as pluggable backends |
| 11 | **17-locale i18n + theme presets** | M | MEDIUM | mya has stub `i18n.tsx`; low-hanging |
| 12 | **Embedded xterm.js terminal in ChatPage** | M | MEDIUM | "TUI-in-browser" parity with desktop TUI |
| 13 | **Learning graph** | M | LOW | BrainStore similar but no learning-graph projection |
| 14 | **Kanban** | L | LOW | Useful for cron+workflow orchestration |
| 15 | **Pets / mascot** | S | LOW | UX nicety |
| 16 | **`delegation.max_spawn_depth`** | S | LOW | mya is hardcoded one-level; needs re-thinking of `withTurnLock` per-agent |
| 17 | **Gateway recovery FSM** | S | LOW | 3-attempts/60s respawn budget |
| 18 | **Long-run tool charms (ambient activity)** | S | LOW | UX nicety for slow tools |
| 19 | **Cron lifecycle_guard** | S | LOW | Restart-loop detection |
| 20 | **OSV vuln check + Tirith URL safety** | S | LOW | Security stack additions |

### Hermes should adopt from mya

| # | Feature | Effort | ROI | Notes |
|---|---|---|---|---|
| 1 | **x402 wallet / paid_fetch tool** | M | HIGH | Frontier §20 micropayment pattern |
| 2 | **DAP (Debug Adapter Protocol) server + client** | M | HIGH | Agent debug + breakpoint on tool calls |
| 3 | **Structural redaction (H2 two-pass)** | S | HIGH | Field-name scrub BEFORE value-scan; catches split-secret cases |
| 4 | **Tier-based model routing** | M | HIGH | `model-routing.ts` — central cost optimization |
| 5 | **Weibull decay memory** | S | HIGH | Principled forgetting curve |
| 6 | **Memory domains** (graph/queue/sync/tree/diff/entities) | M | HIGH | Better separation of concerns than monolithic store |
| 7 | **3-tier eval harness + egress guard + freshness warn** | M | HIGH | `MYA_CREDENTIALED=*** opt-in + no-network fixture gate + 30d warn |
| 8 | **Merkle hash-chain audit log** | S | HIGH | Tamper-evident; recovery FSM |
| 9 | **ACP triple-gate permission relay** | M | HIGH | external-agent + my-gate + human approval |
| 10 | **Tauri deep-link + single-instance + CoW reflink** | M | MEDIUM | `myagent://` URI scheme + FICLONE ioctl |
| 11 | **HTTP control plane + 3-phase readiness** | M | MEDIUM | `/health/{live,ready,functional}`; clean observability |
| 12 | **HLC + LWW sync + CollabRelay** | L | MEDIUM | Hermes is single-user; multi-user collab rooms are a real product gap |
| 13 | **Workflow runner (vm + worker_thread + Rhai)** | M | MEDIUM | Hermes has skills/bundles but no embedded JS workflow runner |
| 14 | **WireEnvelope with seq/replay** | S | LOW | Generic envelope vs Hermes' per-platform renderers |
| 15 | **JSON-RPC stdio + TCP transports** | S | LOW | Hermes uses ACP server only; mya has stdio+TCP |
| 16 | **Composio integration** | M | MEDIUM | Mature tool ecosystem connector |
| 17 | **Adversarial review pattern** | S | MEDIUM | Skeptic/Pragmatist/Critic fan-out |
| 18 | **Codegraph + reference graph** | M | MEDIUM | Structural code understanding |
| 19 | **Auto-capture + RRF + scope-derived memory** | M | MEDIUM | Unified memory infrastructure patterns |
| 20 | **Push notifications (VAPID)** | M | LOW | Hermes relies on TUI/desktop; mya adds web push |

---

## 16. Risks / Open Questions

1. **FEATURE-CATALOG.md §6 Rust channels** (Gmail/Notion/Linq/WeChat) — not in `crates/`. Either aspirational or moved.
2. **Package count**: 27 (excl. vendored) vs 29/31 (incl. `pi-agent-src`/`pi-ai-src`). Writer declares choice in preamble.
3. **mya cron ordering**: Phase 0A + D2 fixes exist; the base ordering (mark succeeded before async turn) may still need a swap.
4. **vm.runInNewContext is NOT a security boundary** (mya `workflows/runner.ts:9-21`). Anyone porting workflows to Hermes must know this.
5. **Hermes `conversation_loop.py` is now 5,785 lines** (not 3,900 as 02_explore-core claimed). Affects any "extracted from `run_agent.py`" narrative.
6. **Cross-process cron lock** (`fcntl`/`msvcrt`): only relevant if mya moves to multi-gateway topology.
7. **`lifecycle_guard.py`** exists in `source/hermes-agent/cron/`.
8. **mya channels = 8 TS adapters** in `packages/gateway/src/channels*.ts`, not in a `packages/channels` folder.

---

## 17. Mutual Convergence Points

1. **Narrow waist + plugin edges** — both have a frozen/minimal core (`packages/core` vs `agent/conversation_loop.py`) with capability pushed to plugins.
2. **3-tier prompt assembly** — both use stable|context|volatile with cache-safe rebuild.
3. **Subagent isolation** — both gate tools (`DELEGATE_BLOCKED_TOOLS` vs `allowedTools`).
4. **At-most-once cron** — both claim before side effect.
5. **Threat-pattern prompt scanner** — both scan injected context.
6. **Lazy dependency surface** — both gate heavy deps behind allowlist (mya: WASM/sigstore; Hermes: `lazy_deps.py`).
7. **Tamper-evident append-only history** — mya via Merkle; Hermes via filesystem + SQL ledger.
8. **Provider profile as declarative dataclass** — both have `ProviderProfile`.
9. **Skill store with progressive disclosure** — both expose name+desc in prompt, body on invoke.
10. **Cursor-stable cache prefix** — both anchor on `nowWallclock` / single-shot context files.

---

## 18. Bottom Line

**mya is structurally richer** (HTTP control plane, 3 transports, 3 transport modes, 3-language infra via natives, tamper-evident audit, multi-user collab, ACP bridge, x402 wallet, DAP, 14 memory domains, Weibull decay, structural redaction, eval harness, workflow runner, JSON-RPC, sigstore, WebAuthn, push notifications). It is the **operations-grade agent** with full-stack observability and a stable core fork.

**Hermes is product-richer** (30+ plugin providers, 20+ plugin channels, 22 memory backends, 22 skill categories, image/video gen, learning graph, pets, kanban, voice continuous, profile system, web plugin slots, 17-locale i18n, embedded xterm TUI in chat, in-browser skill editor, Auth widget, gateway recovery, ambient charms). It is the **user-facing agent** with broad coverage and a polished daily-driver UX.

**Both are independent implementations of the same problem** (Narrow-waist agent + plugins + memory + skills + channels + cron + web/TUI/desktop surfaces) and convergence is high (~60% surface overlap). Each has clearly differentiators the other lacks. The recommendations in §15 are the highest-ROI cross-pollination opportunities.

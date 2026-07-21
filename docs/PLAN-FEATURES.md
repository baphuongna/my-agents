# mya Feature Adoption Plan — ALL Hermes-Only Features

> Generated: 2026-07-21
> Source: `docs/mya-vs-hermes-features.md` §14.2 (45 Hermes-only capabilities)
> Scope: **ALL 44 actionable items** (#17 cron ordering already done)
> Status: **PROPOSED**

## Overview

44 features to adopt from Hermes, grouped into 10 categories. Total estimate: **~12,000 LOC + ~3-4 weeks** full-time (or paced over months).

### Priority matrix

| Priority | Count | Description |
|---|---|---|
| **P0 — Critical gaps** | 6 | Core runtime + security (IterationBudget, OSV, Tirith, etc.) |
| **P1 — High value** | 11 | Providers, channels, profile system, voice (PTT), web UX |
| **P2 — Medium value** | 13 | Memory backends, skill editor, daemon pool |
| **P3 — Nice-to-have** | 12 | Pets, achievements, Spotify, tooltip warmup, etc. |
| **DEFERRED** | 2 | H6 web plugin slots (security), G1b continuous VAD (complexity) |

### Effort distribution

| Effort | Count | Total LOC |
|---|---|---|
| S (<100 LOC) | 18 | ~900 |
| M (100-500 LOC) | 16 | ~4,000 |
| L (500+ LOC) | 10 | ~7,000 |

---

## Group A — Agent Core & Runtime (5 items)

### A1. IterationBudget per-subagent — **P0, S**
**Gap**: Subagents loop until token budget exhausts; no turn cap.
**Files**: `packages/core/src/{budget.ts,types.ts,budget.test.ts}`, `packages/agent/src/{index.ts,subagent.test.ts}`
**LOC**: ~118
**Steps**:
1. Add `maxIterations`, `consumeIteration()`, `releaseIterations()` to `BudgetConfig`
2. Extend `RootState` with `iterationsUsed`/`iterationsCap`
3. In `runSubagentTurn`: `if (!budget.consumeIteration()) throw`
4. Default: parent=0 (unlimited), sub=50
**Tests**: cap hit → abort; refund on abort; unlimited always true
**Risks**: Low (backward compat — default unlimited)

### A2. `delegation.max_spawn_depth` — **P1, S**
**Gap**: Subagents hardcoded one-level; can't nest.
**Files**: `packages/agent/src/index.ts`, `packages/agent/src/subagent.test.ts`
**LOC**: ~60
**Steps**:
1. Add `maxSpawnDepth?: number` to `AgentConfig` (default 2)
2. Track depth in `SubagentHandle` (parent depth + 1)
3. In `spawnSubagent`: if `handle.depth >= config.maxSpawnDepth`, reject
4. Pass depth-aware subagent factory to subagent sessions
**Tests**: depth=1 → subagent can't spawn; depth=2 → one level of nesting
**Risks**: Medium — subagent sessions need access to spawn capability (currently they don't)

### A3. AST-discovered tool registry — **P2, S**
**Gap**: Tools are explicit imports; Hermes uses AST self-registration.
**Files**: `packages/tools/src/registry.ts`, `packages/tools/src/auto-discover.ts` (new)
**LOC**: ~80
**Steps**:
1. `autoDiscover(dir)`: scan `*.ts` for `@Tool` decorator or `registerTool()` calls
2. Use TypeScript compiler API or regex for `export const.*Tool` pattern
3. Register discovered tools in `ToolRegistry`
4. `MYA_TOOLS_DIR` env for custom tool dirs
**Tests**: fixture dir with 3 tools → all registered
**Risks**: Low — opt-in (`autoDiscover` called explicitly)

### A4. Daemon pool — **P2, M**
**Gap**: Long-lived process supervisor for persistent workers.
**Files**: `packages/agent/src/daemon-pool.ts` (new), `packages/gateway/src/index.ts`
**LOC**: ~250
**Steps**:
1. `DaemonPool` class: spawn N worker processes, keep alive, reuse
2. Worker spec: `{ cmd, args, env, warmPool: number }`
3. Health check + respawn on death
4. Use for: MCP servers, browser engines, codeexec sandboxes
**Tests**: pool warm-start; worker death → respawn; max pool size
**Risks**: Medium — process management complexity

### A5. Recovery FSM (gateway respawn) — **P1, S**
**Gap**: Gateway crash = manual restart; no auto-respawn.
**Files**: `packages/print/src/launcher.ts` (or new `packages/gateway/src/recovery.ts`)
**LOC**: ~70
**Steps**:
1. Watchdog: monitor gateway PID, heartbeat file
2. On crash: respawn within 3 attempts / 60s budget
3. Resume mid-session (reload session state)
4. `MYA_GATEWAY_AUTO_RESTART=1` env gate
**Tests**: kill gateway → respawn; 3 fails → give up
**Risks**: Low — opt-in, wrapper around existing serve

---

## Group B — Providers (3 items)

### B1. Plugin providers with lazy install — **P0, L**
**Gap**: 8 hard-coded providers vs Hermes 30+.
**Files**: `packages/ai/src/{plugin-provider.ts,lazy-install.ts,index.ts}`, `packages/ai/src/plugin-provider.test.ts`
**LOC**: ~510
**Steps**:
1. `PluginProviderManifest` interface (id, npmPackage, baseUrl, envVar, models, authScheme)
2. `scanPlugins(dir)`: read manifests from `~/.mya/plugins/providers/`
3. `lazyInstall(manifest, allowlist)`: `MYA_PLUGIN_ALLOWLIST` gate → npm install
4. `ProviderRegistry.registerPlugin(manifest)`
5. CLI: `mya providers list/install`
**Tests**: manifest parse, allowlist gate, mock install, e2e scan→register→use
**Risks**: Medium — npm install at runtime (security); mitigate with allowlist

### B2. MCP dashboard OAuth — **P1, S**
**Gap**: No OAuth flow for MCP server connections.
**Files**: `packages/gateway/src/mcp-oauth.ts` (new), `packages/gateway/src/index.ts`
**LOC**: ~90
**Steps**:
1. `GET /mcp/oauth/:server/start` → redirect to provider
2. `GET /mcp/oauth/callback` → exchange code → store token
3. Token store in `~/.mya/mcp-tokens.json`
4. MCP client uses stored token for authed servers
**Tests**: OAuth start→callback→token stored
**Risks**: Low — standard OAuth code

### B3. Plugin providers declarative dataclasses — **P1, S** (part of B1)
**Gap**: No declarative provider spec format.
**Note**: This is the manifest format from B1. Counted as part of B1.
**LOC**: included in B1

---

## Group C — Tools (6 items)

### C1. Image generation — **P1, L**
**Gap**: No image gen tool.
**Files**: `packages/tools/src/image-gen.ts` (new), `packages/tools/src/index.ts`
**LOC**: ~300
**Steps**:
1. `imageGenerate(prompt, opts)` tool
2. Backends: OpenAI DALL-E, Stability, Replicate (plugin pattern from B1)
3. Output: base64 PNG or file path
4. Permission gate: `image-gen` mode
**Tests**: mock backend → base64 output; permission denied
**Risks**: Low — wraps existing APIs

### C2. Video generation — **P2, L**
**Gap**: No video gen tool.
**Files**: `packages/tools/src/video-gen.ts` (new)
**LOC**: ~350
**Steps**:
1. `videoGenerate(prompt, opts)` tool
2. Backends: Runway, Pika, Replicate
3. Async polling (video gen takes minutes)
4. Output: URL or file path
**Tests**: mock backend → poll → URL
**Risks**: Medium — async polling complexity

### C3. Kanban — **P2, M**
**Gap**: No task board tool.
**Files**: `packages/tools/src/kanban.ts` (new), store in `~/.mya/kanban.json`
**LOC**: ~200
**Steps**:
1. `kanbanCreateBoard`, `kanbanAddTask`, `kanbanMoveTask`, `kanbanListTasks`
2. Boards: `{ id, name, columns: [{ id, name, tasks: [...] }] }`
3. CLI: `mya kanban list/move/add`
4. Web: KanbanPage (drag-drop columns)
**Tests**: CRUD operations
**Risks**: Low — simple JSON store

### C4. OSV vulnerability check — **P0, S**
**Gap**: No dependency vuln scanning.
**Files**: `packages/tools/src/osv-check.ts` (new), `packages/tools/src/index.ts`
**LOC**: ~60
**Steps**:
1. `osvCheck(packageName, version)` tool
2. Query `https://api.osv.dev/v1/query`
3. Return CVE list with severity
4. Batch mode: scan `package.json` / `Cargo.toml`
**Tests**: mock OSV API → CVE list
**Risks**: Low — HTTP wrapper

### C5. Tirith URL safety — **P0, S**
**Gap**: No URL safety checker (mya has DNS SSRF guard but not URL reputation).
**Files**: `packages/tools/src/url-safety.ts` (new)
**LOC**: ~50
**Steps**:
1. `checkUrlSafety(url)` tool
2. Check: Google Safe Browsing API, PhishTank, internal blocklist
3. Return: `{ safe: boolean, reasons: string[] }`
4. Wire into `web_fetch` as pre-check
**Tests**: known-safe URL → safe; known-bad → flagged
**Risks**: Low — needs Safe Browsing API key (optional)

### C6. Agent-callable scheduling tools — **P1, M**
**Gap**: Agent can't create cron jobs (mya blocks by design R2-4).
**Files**: `packages/cron/src/agent-tools.ts` (new), `packages/tools/src/index.ts`
**LOC**: ~180
**Steps**:
1. `cronCreate(schedule, prompt)`, `cronList()`, `cronDelete(id)`, `cronRun(id)`
2. Permission gate: `cron-manage` mode (explicit opt-in)
3. Scope: agent can only manage jobs IT created (prefix `agent-`)
4. Rate limit: max 10 agent-created jobs
**Tests**: create→list→delete; permission denied without mode
**Risks**: Medium — security (agent self-scheduling); mitigate with mode gate + prefix

---

## Group D — Memory (2 items)

### D1. 22 memory backends plugin system — **P1, L**
**Gap**: mya has unified SQLite; Hermes has 22 pluggable backends (mem0, openviking, etc.).
**Files**: `packages/memory/src/backends/` (new dir), `packages/memory/src/index.ts`
**LOC**: ~600
**Steps**:
1. `MemoryBackend` interface (existing) — standardize
2. Built-in adapters: mem0, openviking, byterover, supermemory, honcho
3. `MemoryBackendRegistry` — register by name
4. Config: `memory.backend = "mem0"` in config.toml
5. Fallback: if backend unavailable, fall back to SQLite
**Tests**: each backend mock; fallback on failure
**Risks**: High — each backend has different API; start with 3-4 popular ones

### D2. Learning graph — **P2, M**
**Gap**: No "what user learned" derived graph.
**Files**: `packages/memory/src/learning-graph.ts` (new)
**LOC**: ~250
**Steps**:
1. Derive graph from memory entities + conversations
2. Nodes: concepts; Edges: learned-from, related-to, built-on
3. `learningGraph(topic)` query → DOT/JSON graph
4. Web: graph visualization (d3-force or vis-network)
**Tests**: ingest facts → query graph
**Risks**: Medium — graph derivation quality

---

## Group E — Channels (3 items)

### E1. 20+ plugin channels — **P1, L**
**Gap**: 8 TS adapters vs Hermes 20+ plugin platforms.
**Files**: `packages/gateway/src/channels/` (restructure), `packages/channels/src/` (new plugin SDK)
**LOC**: ~800
**Steps**:
1. `ChannelPlugin` interface (send, receive, identity, rate-limit)
2. Built-in: telegram, discord, slack, email, matrix, signal, whatsapp, line
3. Plugin discovery (like B1 providers)
4. Per-channel identity store (separate credentials)
**Tests**: mock channel send/receive; plugin discovery
**Risks**: High — each platform has unique API; prioritize top 5

### E2. Per-platform identity/cache/rate-limit — **P1, M**
**Gap**: Channels share generic OAuth; no per-platform identity.
**Files**: `packages/gateway/src/channel-identity.ts` (new)
**LOC**: ~200
**Steps**:
1. `ChannelIdentity` store per platform (bot tokens, user tokens)
2. Sticker/media cache per platform
3. Rate-limit guard per platform (token bucket)
4. Wire into each channel adapter
**Tests**: identity isolation; rate-limit triggers
**Risks**: Medium

### E3. Microsoft Graph OAuth + Feishu/WeChat/Lark — **P2, M**
**Gap**: No MS Graph or Chinese platform integrations.
**Files**: `packages/gateway/src/channels/{msgraph,feishu,wechat,lark}.ts`
**LOC**: ~400 (4 adapters × ~100 each)
**Steps**:
1. MSGraph: OAuth + email/calendar/teams tools
2. Feishu/Lark: bot + doc APIs
3. WeChat: official account bot
**Tests**: mock OAuth + API calls
**Risks**: Medium — platform-specific quirks

---

## Group F — Cron (4 items, #17 already done)

### F1. Cron one-shot grace — **P1, S**
**Gap**: No grace for ghost one-shot jobs.
**Files**: `packages/cron/src/index.ts`, `packages/cron/src/cron.test.ts`
**LOC**: ~30
**Steps**:
1. `ONESHOT_GRACE_MS = 120_000` constant
2. On create/update one-shot: reject if `schedule < now - grace`
3. On sweep: skip one-shot jobs older than grace
**Tests**: ghost one-shot rejected; fresh one-shot fires
**Risks**: Low

### F2. Cron lifecycle_guard — **P1, S**
**Gap**: No restart-loop detection.
**Files**: `packages/cron/src/lifecycle-guard.ts` (new)
**LOC**: ~60
**Steps**:
1. Track restart count per job in window (e.g., 5 restarts in 60s)
2. If threshold exceeded: disable job + alert
3. `LifecycleGuard.check(jobId)` before fire
**Tests**: rapid restart → disabled
**Risks**: Low

### F3. Cron empirical catch-up grace — **P1, S** (part of grace window)
**Gap**: mya fires once + advances (infinite grace); Hermes uses finite grace.
**Files**: `packages/cron/src/index.ts`
**LOC**: ~40 (see PLAN-FEATURES Priority 4)
**Steps**:
1. Add `graceMs?: number` to `CronJob`
2. In `dueAndAdvance`: if `now - nextRunAt > graceMs`, skip + advance
3. Default: `Infinity` (backward compat)
**Tests**: stale job skipped; fresh fires
**Risks**: Low

### F4. Cross-process cron lock — **P2, M**
**Gap**: mya single-process; no `fcntl`/`msvcrt` cross-process lock.
**Files**: `packages/cron/src/cross-process-lock.ts` (new)
**LOC**: ~120
**Steps**:
1. `flock` wrapper (Unix) / `LockFileEx` (Windows)
2. Lock file: `~/.mya/cron.lock`
3. On sweep start: acquire lock; release on complete
4. If lock held by another process: skip sweep
**Tests**: two processes → only one sweeps
**Risks**: Low — only relevant for multi-gateway topology (future)

---

## Group G — Voice (1 item)

### G1. Voice mode — **P1, split into G1a (push-to-talk) + G1b (continuous, future)**

#### G1a. Push-to-talk voice mode — **P1, M**
**Decision**: Start with push-to-talk (simpler, no VAD complexity).
**Files**: `packages/gateway/src/voice-ptt.ts` (new), `packages/tts/src/stt.ts` (new)
**LOC**: ~200
**Steps**:
1. STT backends: Whisper (local), browser Web Speech API (web only)
2. `voicePttStart()` → record audio → `voicePttStop()` → transcribe
3. Agent loop: transcript → agent turn → TTS response → speak
4. CLI: hold-to-talk keybinding; Web: microphone button
5. No interruption handling (push-to-talk is turn-based)
**Tests**: mock STT → agent → mock TTS
**Risks**: Medium — audio capture API differs CLI vs web

#### G1b. Continuous VAD mode — **FUTURE, defer**
**Decision**: Defer continuous voice activity detection (barge-in, always-listening).
**LOC**: ~250 (additional, on top of G1a)
**Revisit**: After G1a is stable + user requests hands-free mode

---

## Group H — Web Dashboard (14 items)

### H1. Profile system (multi-island) — **P0, L**
**Gap**: Only stub `/profiles/active`.
**Files**: `packages/gateway/src/profiles.ts`, `packages/web/src/contexts/ProfileProvider.tsx`, `packages/web/src/components/{ProfileSwitcher,ProfileScopeBanner,ProfileKeyedRoutes}.tsx`, `packages/web/src/pages/{ProfilesPage,ProfileBuilderPage}.tsx`
**LOC**: ~1030
**Steps**:
1. Backend: `ProfileStore` (`~/.mya/profiles.json` + per-profile dirs)
2. Endpoints: `GET/POST /profiles/*`
3. Web: ProfileProvider context, ProfileSwitcher dropdown, ProfileKeyedRoutes remount
4. ProfileBuilderPage: 5-step wizard (identity, model, skills, MCP, review)
5. Migration: `~/.mya/` → `~/.mya/profiles/default/`
**Tests**: CRUD, switch remounts, backward compat
**Risks**: Medium — migration + state isolation

### H2. i18n — improve EN+VI quality only — **P2, S**
**Decision**: Skip 17-locale expansion. Keep EN + VI only, focus on **translation quality + coverage**.
**Files**: `packages/web/src/lib/i18n.tsx`
**LOC**: ~80 (audit + fill missing keys + improve VI translations)
**Steps**:
1. Audit all 19 pages for hardcoded strings (not using `t()`)
2. Extract to keys, add to both en + vi dictionaries
3. Improve existing VI translations (natural phrasing, not literal)
4. Verify LangToggle covers all visible text
**Tests**: no hardcoded strings remain; all keys in both dicts
**Risks**: Low
**Note**: 15 other locales (es, fr, de, ja, etc.) explicitly **skipped** per user decision

### H3. Theme presets (backend-synced) — **P2, M**
**Gap**: 5 static themes; no backend sync.
**Files**: `packages/web/src/lib/theme.tsx` (expand), `packages/gateway/src/index.ts`
**LOC**: ~200
**Steps**:
1. Theme presets: palette + typography + layout density
2. `GET/PUT /dashboard/theme` endpoint
3. Gateway sends theme in `ready` event
4. Per-theme font family (fonts.ts)
**Tests**: theme switch → backend sync → reload restores
**Risks**: Low

### H4. Embedded xterm.js terminal in chat — **P1, M**
**Gap**: Chat is plain textarea; no PTY.
**Files**: `packages/web/src/components/Terminal.tsx` (new), `packages/gateway/src/pty.ts` (new)
**LOC**: ~350
**Steps**:
1. Gateway: `WS /pty?token=...` → spawn `node dist/mya.js --tui` PTY
2. Web: xterm.js + addons (fit, web-links, search)
3. ChatPage: split view (chat | terminal)
4. Reconnect throttle on WS drop
**Tests**: PTY spawn → echo; reconnect
**Risks**: Medium — PTY process management + security

### H5. HermesConsoleModal (xterm PTY) — **P2, M** (part of H4)
**Gap**: No standalone console.
**Files**: `packages/web/src/components/ConsoleModal.tsx` (new)
**LOC**: ~150 (uses H4 PTY infrastructure)
**Steps**:
1. Modal wrapper around xterm.js
2. Cmd+Shift+C to open
3. Connects to same PTY pool
**Tests**: open → type → close

### H6. Web plugin slot registry — **DEFERRED** ❌
**Decision**: Skip per user — security risk too high for now (plugin code execution in browser).
**Rationale**: Needs careful sandbox design (iframe/vm). Defer until security model is proven.
**Revisit**: When B1 plugin providers (backend) security model is validated.

### H7. In-browser skill editor — **P1, M**
**Gap**: SkillsPage lists only; no create/edit.
**Files**: `packages/web/src/components/SkillEditorDialog.tsx` (new), `packages/gateway/src/index.ts`
**LOC**: ~200
**Steps**:
1. Editor: name, description, frontmatter fields, body (CodeMirror markdown)
2. `POST /skills/create`, `PUT /skills/:name`
3. Validation matches server-side `skill_manage`
4. Live preview (rendered markdown)
**Tests**: create → save → reload → edit
**Risks**: Low

### H8. Auth widget + OAuth providers card — **P1, M**
**Gap**: No OAuth UI.
**Files**: `packages/web/src/components/AuthWidget.tsx` (new)
**LOC**: ~180
**Steps**:
1. OAuth providers card (Google, GitHub, Anthropic, etc.)
2. Login modal (PKCE flow from `packages/ai/src/oauth.ts`)
3. Token status indicator
4. Revoke button
**Tests**: OAuth start → callback → status updates
**Risks**: Low — uses existing OAuth code

### H9. Webhook pages — **P2, S**
**Gap**: Webhooks stub only.
**Files**: `packages/web/src/pages/WebhooksPage.tsx` (new), `packages/gateway/src/index.ts`
**LOC**: ~120
**Steps**:
1. `GET/POST/DELETE /webhooks` endpoints
2. Webhook: `{ id, url, events: [], secret }`
3. WebhooksPage: list + create + test
4. Event delivery on cron/channel events
**Tests**: create → trigger event → POST delivered
**Risks**: Low

### H10. Pairing UI — **P2, M**
**Gap**: Backend exists (`/pair/*`), no web UI.
**Files**: `packages/web/src/pages/PairingPage.tsx` (new)
**LOC**: ~150
**Steps**:
1. Generate 8-char code
2. QR code for mobile pairing
3. Device list + revoke
4. Countdown timer (1h expiry)
**Tests**: generate → pair → device appears → revoke
**Risks**: Low

### H11. Tooltip warmup — **P3, S**
**Gap**: No tooltip debounce.
**Files**: `packages/web/src/components/ui/Tooltip.tsx` (new)
**LOC**: ~40
**Steps**:
1. `warmRef` state — 300ms warm after dismiss
2. Suppress fade-in during warm
**Tests**: rapid hover → no flicker
**Risks**: Low

### H12. Pet sprites / truecolor half-block — **P3, S**
**Gap**: No TUI mascot.
**Files**: `packages/tui/src/components/pet-sprite.ts` (new)
**LOC**: ~60
**Steps**:
1. Truecolor half-block grid renderer
2. Sprite frames (idle, happy, thinking)
3. `PetSprite` component in TUI status bar
**Tests**: render → ANSI output contains color codes
**Risks**: Low

### H13. Spanforce `^~~` strikethrough in markdown — **P3, S**
**Gap**: mya markdown uses `~~`; no `^~~` force variant.
**Files**: `packages/tui/src/components/markdown.ts`, `packages/web/src/components/Markdown.tsx`
**LOC**: ~20
**Steps**:
1. Add `^~~(.+?)^~~` regex to strikethrough tokenizer
2. Render as `<s>` with force class
**Tests**: `^~~text^~~` → strikethrough
**Risks**: Low

### H14. Long-run tool charms (ambient activity) — **P3, S**
**Gap**: No ambient status for slow tools.
**Files**: `packages/tui/src/components/charms.ts` (new), `packages/web/src/components/ToolCharms.tsx` (new)
**LOC**: ~50
**Steps**:
1. Verb map: `{ read: "reading the docs", bash: "running commands", ... }`
2. Fire ambient string after 8s of tool execution
3. Rotate every 5s
**Tests**: tool >8s → charm appears
**Risks**: Low

---

## Group I — System/OS (2 items)

### I1. Systemd / cgroup lifecycle ops — **P2, M**
**Gap**: No systemd notify, cgroup cleanup, scale-to-zero.
**Files**: `packages/gateway/src/systemd.ts` (new), `packages/gateway/src/cgroup.ts` (new)
**LOC**: ~200
**Steps**:
1. `sd_notify(READY=1)` on gateway start
2. Watchdog: `sd_notify(WATCHDOG=1)` every 30s
3. cgroup cleanup on exit (kill orphan subprocesses)
4. `scale_to_zero`: idle timeout → shutdown
**Tests**: sd_notify mock; cgroup cleanup
**Risks**: Medium — Linux-only; gate behind `MYA_SYSTEMD=1`

### I2. (Recovery FSM — see A5)

---

## Group J — Fun/UX (4 items)

### J1. Pets / Petdex — **P3, M**
**Gap**: No mascot system.
**Files**: `packages/tui/src/pets/` (new), `packages/web/src/pages/PetsPage.tsx`
**LOC**: ~300
**Steps**:
1. Pet data: `{ id, name, sprite, rarity, description }`
2. Petdex: collection (unlock by usage milestones)
3. TUI: pet sprite in status bar
4. CLI: `mya pets list/select`
**Tests**: unlock milestone → pet appears
**Risks**: Low — pure UX

### J2. Achievements system — **P3, M**
**Gap**: No gamification.
**Files**: `packages/audit/src/achievements.ts` (new)
**LOC**: ~200
**Steps**:
1. Achievement defs: `{ id, name, description, condition }`
2. Check conditions on audit events
3. Unlock → toast + store
4. Web: AchievementsPage
**Tests**: trigger condition → unlock
**Risks**: Low

### J3. Spotify integration — **P3, M**
**Gap**: No music control.
**Files**: `packages/gateway/src/channels/spotify.ts` (new)
**LOC**: ~150
**Steps**:
1. OAuth + Web Playback SDK
2. Tools: `spotifyPlay`, `spotifyPause`, `spotifySearch`
3. Now-playing in status bar
**Tests**: mock API → play/pause
**Risks**: Low — needs Spotify Premium

### J4. Google Meet / disk cleanup — **P3, S each**
**Gap**: No meet integration; no disk cleanup.
**Files**: `packages/gateway/src/channels/google-meet.ts`, `packages/tools/src/disk-cleanup.ts`
**LOC**: ~100 each
**Steps**:
1. Meet: join link, transcript capture
2. Disk cleanup: scan old logs/cache, suggest deletes
**Tests**: mock APIs
**Risks**: Low

---

## Implementation Sequencing

### Sprint 1: Security & Core (P0, ~1 week)
- A1 IterationBudget (S)
- C4 OSV vuln check (S)
- C5 Tirith URL safety (S)
- F1 One-shot grace (S)
- F2 Lifecycle guard (S)
- F3 Catch-up grace (S)
- A5 Recovery FSM (S)
**LOC**: ~530

### Sprint 2: Provider & Tool parity (P0-P1, ~1.5 weeks)
- B1 Plugin providers (L)
- B2 MCP OAuth (S)
- C1 Image gen (L)
- C6 Agent cron tools (M)
- A2 Spawn depth (S)
**LOC**: ~1140

### Sprint 3: Web foundation (P0-P1, ~1.5 weeks)
- H1 Profile system (L)
- H4 xterm terminal (M)
- H7 Skill editor (M)
- H8 Auth widget (M)
- H2 i18n EN+VI quality (S)
**LOC**: ~1960 (was ~2660; H6 deferred, H2 downsized)

### Sprint 4: Channels & Voice (P1, ~1.5 weeks)
- E1 Plugin channels (L)
- E2 Per-platform identity (M)
- G1a Voice push-to-talk (M)
- C3 Kanban (M)
**LOC**: ~1400 (was ~1650; G1 split, G1b deferred)

### Sprint 5: Memory & System (P1-P2, ~1.5 weeks)
- D1 Memory backends (L)
- D2 Learning graph (M)
- A4 Daemon pool (M)
- I1 Systemd/cgroup (M)
- F4 Cross-process lock (M)
**LOC**: ~1320

### Sprint 6: Polish (P2-P3, ~1 week)
- H3 Theme presets (M)
- H5 Console modal (M)
- H9 Webhooks (S)
- H10 Pairing UI (M)
- E3 MSGraph/Feishu/WeChat (M)
- C2 Video gen (L)
- A3 AST tool discovery (S)
**LOC**: ~1450

### Sprint 7: Fun/UX (P3, ~0.5 week)
- J1 Pets/Petdex (M)
- J2 Achievements (M)
- J3 Spotify (M)
- J4 Meet/disk-cleanup (S+S)
- H11 Tooltip warmup (S)
- H12 Pet sprites (S)
- H13 Strikethrough (S)
- H14 Tool charms (S)
**LOC**: ~1130

**Grand total: ~8,510 LOC over ~7 sprints (~7.5 weeks paced)**
*(reduced from ~9,880: H6 deferred ~500, G1 split ~250 saved, H2 downsized ~320)*

---

## Verification gates (each feature)

1. `npx vitest run --pool forks` → all pass (no regressions)
2. `npm run bundle` → succeeds
3. `npx tsc -b <pkg>` → type-check passes
4. New tests written + passing
5. `git commit` conventional message
6. Gateway restart: `setsid node dist/mya.js serve --port 3999 > /tmp/mya-gw.log 2>&1 &`
7. E2E smoke test

---

## Dependencies graph

```
B1 Plugin providers ─┬─→ C1 Image gen
                     ├─→ C2 Video gen
                     ├─→ E1 Plugin channels
                     └─→ D1 Memory backends

H4 xterm terminal ─→ H5 Console modal
H1 Profile system ─→ (all web features benefit from profile isolation)
B2 MCP OAuth ─→ MCP server connections
A1 IterationBudget ─→ A2 Spawn depth (subagent nesting needs iter cap)
```

---

## User decisions (2026-07-21)

1. ✅ **Scope**: ALL features (not filtered)
2. ⏸️ **Status**: NOT STARTED — user reviewing plan first
3. ✅ **i18n**: EN + VI only (skip 15 other locales); focus on translation quality
4. ❌ **H6 web plugin slots**: DEFERRED (security risk; revisit after backend plugin model proven)
5. ✅ **Voice G1a**: Push-to-talk first (simpler); G1b continuous VAD deferred
6. ✅ **Pets J1 + Achievements J2**: INCLUDED (pure UX, but user wants them)

**Updated grand total**: ~8,510 LOC over 7 sprints

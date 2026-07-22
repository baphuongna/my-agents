# mya Feature Adoption Plan — ALL Hermes-Only Features (v2, spec-aligned)

> Generated: 2026-07-21 · **Revised: v2 — aligned to AGENT-SPEC (`source/.learned/spec/`)**
> Source: `docs/mya-vs-hermes-features.md` §14.2 (45 Hermes-only capabilities)
> Scope: **40 actionable items** (2 deferred: H6, G1b; 1 dropped: A4; #17 cron already done)
> Review: `docs/PLAN-FEATURES-REVIEW.md` (15 findings, all applied)
> **✅ STATUS: COMPLETE** — all 40 features implemented + 13 P0 prerequisites
> Commits: `d3097f6` → `fcf9ef5` (2026-07-21)
> Verification: 1824/1824 tests pass, bundle succeeds
> Audits: 6-round deep codebase review (16 parallel explorers) + 3-round per-sprint code/security/cold-verify

## Spec compliance — how to read this plan

Every feature below is checked against the founding spec. Each entry carries:

| Tag | Meaning |
|---|---|
| **Spec ref** | Which § of AGENT-SPEC this aligns with |
| **Package home** | Where it lives (per §17 layering — core/interfaces vs package/impl) |
| **why-not-a-package** | Required justification IF touching `packages/core/` (inv #20) |
| **ComponentHealth** | Registration plan (inv #17 — boot fails if missing) |
| **RuntimeEvents** | Typed events emitted (inv #11 — no stdout scraping) |
| **Permission** | §07 5-mode + deny/ask rules (no custom modes) |

### Core invariants enforced (§18)

- **#1/#7/#8/#15**: prompt cache sacred — only tier boundaries mutate it
- **#10**: single `core.time` helper — no `Date.now()` outside it
- **#11/#17/#18**: typed events + ComponentHealth tri-state + no silent failures
- **#17**: boot fails on any missing ComponentHealth registration
- **#19**: transports depend on core inward only — gateway ≠ business logic
- **#20**: core additions need written justification

### Extension model (§17)

**4 kinds ONLY**: Extensions / Skills / Prompt-Templates / Themes. No "plugin" concept.
Packages are **npm-resolved + pinned lockfile** — discovered at boot via `jiti`, NOT fetched at runtime.

---

### Priority matrix

| Priority | Count | Description |
|---|---|---|
| **P0 — Critical gaps** | 6 | Core runtime + security |
| **P1 — High value** | 11 | Providers, channels, profile system, voice (PTT), web UX |
| **P2 — Medium value** | 12 | Memory backends (scoped), skill editor, tool discovery |
| **P3 — Nice-to-have** | 11 | Pets, achievements, Spotify, polish |
| **DEFERRED** | 3 | H6 web extension slots, G1b continuous VAD, A4 daemon pool |

---

## Group A — Agent Core & Runtime

### A1. IterationBudget per-subagent — **P0, S**
**Spec ref**: §21 Cross-cutting (BudgetConfig is SOLE budget definition, tree-accounted)
**Package home**: `packages/core/` — budget is already core (`types.ts:448`)
**why-not-a-package**: Budget is a cross-cutting core concern (§21); `BudgetConfig` interface already lives in core types. Iteration budget is a new dimension on the SAME tree, not a separate system.
**ComponentHealth**: N/A (budget is internal accounting, not a component)
**RuntimeEvents**: `RuntimeEvent{kind:"budget";tri:"warn"|"exhausted";iterationsUsed;iterationsCap}`
**LOC**: ~120
**Steps**:
1. Extend `BudgetConfig` (types.ts:448) with `maxIterations?: number`, `iterationsUsed: number`
2. Add `consumeIteration(): boolean` — atomic, decrements `iterationsUsed`, returns false at cap
3. Integrate into existing `makeBudget()` (budget.ts:42) — iteration counter shares the same node
4. In agent loop (`packages/agent/src/index.ts`): call `budget.consumeIteration()` before each turn continuation
5. `deriveChild()` propagates iteration cap to children (child cap = min(parent remaining, requested))
6. Default: `maxIterations = 0` (unlimited — backward compat)
**Tests**: cap hit → `BudgetExhausted` event + graceful abort; refund on abort (N/A — iterations aren't pre-charged like tokens); unlimited always true
**Risks**: Low — extends existing tree, default unlimited preserves backward compat

### A2. `delegation.max_spawn_depth` — **P1, S**
**Spec ref**: §10 Subagents + §21 (`MAX_TREE_NODES = 64` already in types.ts:492)
**Package home**: `packages/agent/` (subagent runner)
**why-not-a-package**: N/A (not in core)
**ComponentHealth**: N/A
**RuntimeEvents**: `RuntimeEvent{kind:"subagent";action:"spawn_rejected";reason:"max_depth"}`
**LOC**: ~60
**Pre-check**: Verify `MAX_DEPTH` doesn't already exist (spec mentions `MAX_DEPTH` + `MAX_TREE_NODES`). If depth tracking exists, extend it; don't duplicate.
**Steps**:
1. Check existing `MAX_DEPTH` constant in types.ts — if present, expose as configurable
2. Add `maxSpawnDepth?: number` to `AgentConfig` (default 2)
3. Track depth in `SubagentHandle` (parent depth + 1)
4. In `spawnSubagent`: if `handle.depth >= config.maxSpawnDepth`, reject + emit event
**Tests**: depth=1 → subagent can't spawn; depth=2 → one nesting level
**Risks**: Low — check existing implementation first

### A3. AST-discovered tool registry — **P2, S**
**Spec ref**: §07 "Self-registering tool registry with AST/import discovery + `check_fn`/`is_available(config)` gate"
**Rust-gate note**: §02 says AST parsing → Rust for hot loops. BUT tool discovery is **boot-time** (once, few dozen files), NOT a hot inner loop over 100k files. TS is within the Rust-gate exception. If tool count exceeds ~1000 and scan latency is measurable, move to `crates/ast` (tree-sitter).
**Package home**: `packages/tools/` (tool registry)
**ComponentHealth**: each discovered tool registers `ComponentHealth` via `is_available(config)` gate
**RuntimeEvents**: `RuntimeEvent{kind:"tool_registered";name;available}`
**LOC**: ~80
**Steps**:
1. `autoDiscover(dir)`: scan `*.ts` for `registerTool()` calls or `@Tool`-decorated exports
2. Use lightweight regex/import-scan (not full TS compiler API — boot-time, not analysis)
3. Register discovered tools in `ToolRegistry` with `is_available()` gate
4. `MYA_TOOLS_DIR` env for custom tool dirs
**Tests**: fixture dir with 3 tools → all registered + ComponentHealth emitted
**Risks**: Low — opt-in

### A4. Daemon pool — **DEFERRED** ❌
**Decision**: Defer per architectural review (PLAN-FEATURES-REVIEW.md M2).
**Rationale**: No spec home (§03 architecture map has no process-pool concept). Invariant #12 ("keep long-lived handles in the runtime struct") already covers handle reuse. The MCP `PluginLifecycle` (§12.1, 11-phase FSM) covers server health/restart.
**Revisit**: Only when a concrete perf need is measured (e.g., MCP server cold-start latency > 2s).

### A5. Recovery FSM (gateway respawn) — **P1, S**
**Spec ref**: §14b Crash Resilience + §13 ComponentHealth tri-state
**Package home**: `packages/print/src/launcher.ts` (launcher is the supervisor)
**ComponentHealth**: watchdog registers as `ComponentHealth{gateway}` — emits `Healthy|Degraded|Failed`
**RuntimeEvents**: `RuntimeEvent{kind:"health";component:"gateway";tri:"healthy"|"degraded"|"failed"}`
**LOC**: ~70
**Steps**:
1. Watchdog: monitor gateway PID + heartbeat file (written via `core.time`, not `Date.now()`)
2. On crash: respawn within 3 attempts / 60s budget
3. Resume mid-session (reload session state from `session-manager.ts`)
4. `MYA_GATEWAY_AUTO_RESTART=1` env gate
**Tests**: kill gateway → respawn + health event; 3 fails → give up + Failed state
**Risks**: Low — opt-in wrapper

---

## Group B — Providers

### B1. Provider packages (discovery, not runtime install) — **P0, L**
**Spec ref**: §06 ProviderProfile + §17 Extension Model
**Package home**: `packages/ai/` (ProviderProfile registry + ProviderRegistry already here)
**CRITICAL FIX (review C2/C3)**: ~~Runtime npm install~~ → **boot-time discovery**. ~~"Plugin"~~ → **provider packages** (§17 extension kind = "extensions").
**ComponentHealth**: each provider registers `ComponentHealth` (Healthy|Degraded|Failed per §06 R27-22 pattern)
**RuntimeEvents**: `RuntimeEvent{kind:"provider_registered";id;healthy}`
**LOC**: ~400 (reduced from ~510 — no install logic)
**Steps**:
1. Define `ProviderPackageManifest` extending §17 `PackageManifest` (name, version, apiVersion, provides.providers[], permissions.egress[])
2. `scanProviders()`: at boot, scan `node_modules/@mya/provider-*` + `~/.mya/providers/*.json` for manifests
3. Load via `jiti` (like pi extensions) — packages are **pre-installed** via `npm install -g @mya/provider-foo`
4. `ProviderRegistry.register(profile)` — uses existing registry (`packages/ai/src/registry.ts`)
5. CLI: `mya providers list` (shows discovered + health); docs show `npm install` instructions
6. **NO runtime `npm install`** — user installs manually, mya discovers at boot
**Tests**: manifest parse, boot discovery, register → use, health event on registration
**Risks**: Low — follows §17 lifecycle exactly (install → verify apiVersion → register → activate)

### B2. MCP dashboard OAuth — **P1, S**
**Spec ref**: §06.1 OAuth/PKCE + §12.1 MCP lifecycle
**Package home**: `packages/gateway/src/mcp-oauth.ts` (gateway = transport, proxying OAuth is transport-appropriate)
**ComponentHealth**: OAuth flow registers as ComponentHealth for each MCP server
**LOC**: ~90
**Steps**:
1. `GET /mcp/oauth/:server/start` → redirect to provider (PKCE from §06.1)
2. `GET /mcp/oauth/callback` → exchange code → store token via `SecretRef{from:"keyring"}` (§14.2)
3. MCP client uses stored token for authed servers
**Tests**: OAuth start→callback→token stored
**Risks**: Low — standard OAuth, uses existing PKCE code

### B3. Provider declarative spec — **P1** (part of B1)
**Note**: The manifest format from B1. Included in B1 LOC.

---

## Group C — Tools

### C1. Image generation — **P1, L**
**Spec ref**: §07 Tool System + §17 (extension kind = "extensions")
**Package home**: `packages/tools/src/image-gen.ts`
**Permission**: `required_mode: WorkspaceWrite` (generates files); deny rule if no API key configured
**ComponentHealth**: `is_available(config)` → false if no backend API key; registers ComponentHealth
**RuntimeEvents**: `RuntimeEvent{kind:"tool_call";tool:"image_generate"}`
**LOC**: ~300
**Steps**:
1. `imageGenerate(prompt, opts)` tool — satisfies `Tool` interface
2. Backends: OpenAI DALL-E, Stability, Replicate — each a provider package (B1 pattern)
3. Output: base64 PNG or file path (content-addressed per §07)
4. Permission: WorkspaceWrite required (writes generated files)
**Tests**: mock backend → base64 output; permission denied in ReadOnly
**Risks**: Low

### C2. Video generation — **P2, L**
**Spec ref**: §07 + §17
**Package home**: `packages/tools/src/video-gen.ts`
**Permission**: `required_mode: WorkspaceWrite`
**ComponentHealth**: backend availability gate
**LOC**: ~350
**Steps**:
1. `videoGenerate(prompt, opts)` tool
2. Backends: Runway, Pika, Replicate (provider packages)
3. Async polling (video gen takes minutes) — emit progress events
4. Output: URL or file path
**Tests**: mock backend → poll → URL
**Risks**: Medium — async polling; emit `RuntimeEvent{kind:"tool_progress"}`

### C3. Kanban — **P2, M**
**Spec ref**: §07 + §07 R31 (path-safety resolver)
**Package home**: `packages/tools/src/kanban.ts`
**Permission**: `required_mode: WorkspaceWrite`
**Path-safety (S7 fix)**: Board/task names sanitized via `resolve_inside_workspace` equivalent before writing to `~/.mya/kanban.json` — prevent traversal via crafted names
**ComponentHealth**: storage availability
**LOC**: ~220 (added ~20 for path-safety)
**Steps**:
1. `kanbanCreateBoard`, `kanbanAddTask`, `kanbanMoveTask`, `kanbanListTasks`
2. Boards: `{ id, name, columns: [{ id, name, tasks: [...] }] }`
3. **Sanitize all names** (reject `../`, null bytes, path separators)
4. Store in `~/.mya/kanban.json` with atomic write (proper-lockfile)
5. CLI: `mya kanban list/move/add`; Web: KanbanPage
**Tests**: CRUD + path-traversal attempt rejected
**Risks**: Low

### C4. OSV vulnerability check — **P0, S**
**Spec ref**: §07 + §16 Supply Chain
**Package home**: `packages/tools/src/osv-check.ts`
**Permission**: `required_mode: ReadOnly` (read-only HTTP query)
**ComponentHealth**: `is_available()` → true always (public API)
**RuntimeEvents**: `RuntimeEvent{kind:"tool_call";tool:"osv_check"}`
**LOC**: ~60
**Steps**:
1. `osvCheck(packageName, version)` tool — query `https://api.osv.dev/v1/query`
2. Return CVE list with severity
3. Batch mode: scan `package.json` / `Cargo.toml`
**Tests**: mock OSV API → CVE list
**Risks**: Low

### C5. Tirith URL safety — **P0, S**
**Spec ref**: §07 + §14 Security (defense-in-depth)
**Package home**: `packages/tools/src/url-safety.ts`
**Permission**: `required_mode: ReadOnly`
**ComponentHealth**: backend availability (Safe Browsing API key optional)
**LOC**: ~50
**Steps**:
1. `checkUrlSafety(url)` tool
2. Check: Google Safe Browsing API (if key), PhishTank, internal blocklist
3. Return `{ safe: boolean, reasons: string[] }`
4. Wire into `web_fetch` as pre-check (complements existing DNS SSRF guard)
**Tests**: known-safe → safe; known-bad → flagged
**Risks**: Low

### C6. Agent-callable scheduling tools — **P1, M**
**Spec ref**: §07 (5-mode permission) + §12.3 Cron
**Package home**: `packages/cron/src/agent-tools.ts`
**CRITICAL FIX (review M4)**: ~~"cron-manage" mode~~ → **§07 5-mode + ask rule**. No custom modes.
**Permission**: `required_mode: WorkspaceWrite` + **ask rule** `cron_create(subject:*)` → always prompt (inviolable, inv #13)
**ComponentHealth**: N/A (delegates to cron scheduler)
**RuntimeEvents**: `RuntimeEvent{kind:"cron";action:"agent_create"|"agent_delete";jobId}`
**Time helper (S6)**: all schedule math via `core.time`, not `Date.now()`
**LOC**: ~180
**Steps**:
1. `cronCreate(schedule, prompt)`, `cronList()`, `cronDelete(id)`, `cronRun(id)`
2. Permission: WorkspaceWrite required + ask rule (always prompt for cron creation)
3. Scope: agent can only manage jobs IT created (prefix `agent-`)
4. Rate limit: max 10 agent-created jobs (enforced in tool, not permission mode)
**Tests**: create→list→delete; ask rule prompts even in Allow mode (inv #13)
**Risks**: Medium — agent self-scheduling; mitigated by ask rule + prefix scope

---

## Group D — Memory

### D1. Memory backend packages (scoped to 3-4) — **P1, L**
**Spec ref**: §08 Memory + §17 (backends are packages) + §23 Open Q #3 (still open)
**Package home**: Each backend = separate package satisfying `MemoryBackend` interface
**CRITICAL FIX (review C1)**: ~~OpenViking~~ → **REMOVED** (AGPL, inv #4). If ragfs unified-context concept inspires a backend, it's clean-room only with SPDX notice.
**CRITICAL FIX (review M5)**: ~~22 backends~~ → **3-4 priority backends**. 22 is an aspiration list, not a single deliverable.
**ComponentHealth**: each backend registers ComponentHealth (§08 — Healthy|Degraded|Failed)
**RuntimeEvents**: `RuntimeEvent{kind:"health";component:"memory:<backend>";tri}`
**LOC**: ~1000 (4 backends × ~250 each, scoped from ~~600~~)
**Backends to implement**:
1. **SQLite** ✓ (already done — `packages/memory/src/sqlite-*.ts`)
2. **Markdown** — human-editable, file-based (spec §23 Open Q #3 default)
3. **Vector/embedding** — semantic search (spec §23 Open Q #3 default)
4. **mem0** — remote backend (one external integration as proof-of-concept)
**Steps**:
1. Standardize `MemoryBackend` interface (already exists — audit for completeness)
2. Create `packages/memory-backend-markdown/`, `packages/memory-backend-vector/`, `packages/memory-backend-mem0/`
3. `MemoryBackendRegistry` — register by name; config: `memory.backend = "markdown"`
4. Fallback: if backend unavailable → SQLite (emit Degraded health)
**Aspiration list (NOT in scope)**: byterover, supermemory, honcho, ragfs-style (clean-room)
**Tests**: each backend mock; fallback on failure; ComponentHealth events
**Risks**: Medium — 4 backends manageable; each is a package

### D2. Learning graph — **P2, M**
**Spec ref**: §08 Memory
**Package home**: `packages/memory/src/learning-graph.ts`
**ComponentHealth**: graph engine availability
**LOC**: ~250
**Steps**:
1. Derive graph from memory entities + conversations
2. Nodes: concepts; Edges: learned-from, related-to, built-on
3. `learningGraph(topic)` query → DOT/JSON
4. Web: graph visualization
**Tests**: ingest facts → query graph
**Risks**: Medium — derivation quality

---

## Group E — Channels

### E1. Channel adapter packages (scoped to 5-6) — **P1, L**
**Spec ref**: §12 Channels & Gateway (ChannelRegistry with link-time registration)
**Package home**: Each channel = package satisfying `ChannelAdapter` interface (§12)
**CRITICAL FIX (review C3)**: ~~"plugin channels"~~ → **channel adapter packages** (§17 extension kind)
**CRITICAL FIX (review M5)**: ~~20+ channels~~ → **5-6 priority channels**
**Injection scanner (S4 fix)**: ALL inbound messages pass through `scanInject(scope="context")` BEFORE entering history (§12 R27-15)
**ComponentHealth**: each channel registers ComponentHealth (§12.1 PluginLifecycle pattern)
**RuntimeEvents**: `RuntimeEvent{kind:"channel";action:"message_received"|"send"|"health";platform}`
**LOC**: ~900 (6 channels × ~150 each, scoped from ~~800~~)
**Channels to implement**:
1. Telegram ✓ (exists — `crates/mya-channels/src/telegram.rs`)
2. Discord
3. Slack
4. Email (IMAP/SMTP)
5. Matrix
6. Signal OR WhatsApp
**Steps**:
1. Standardize `ChannelAdapter` interface (send, receive, identity, rate-limit)
2. Create `packages/channel-<platform>/` for each
3. `ChannelRegistry` link-time registration (§12)
4. Per-channel identity store (separate credentials — see E2)
5. **Every inbound message → `scanInject` before history**
**Aspiration list (NOT in scope)**: line, wechat, feishu, lark, msgraph (see E3)
**Tests**: mock channel send/receive; injection scan blocks malicious payload
**Risks**: Medium — 6 channels manageable

### E2. Per-platform identity/cache/rate-limit — **P1, M**
**Spec ref**: §12 (per-channel access control via resolver closure, never cached)
**Injection scanner (S4)**: identity tokens never logged; scanInject on all messages
**ComponentHealth**: identity store availability
**LOC**: ~200
**Steps**:
1. `ChannelIdentity` store per platform (bot tokens, user tokens) via `SecretRef{from:"keyring"}` (§14.2)
2. Sticker/media cache per platform
3. Rate-limit guard per platform (token bucket)
4. **Never cache allowlists in handles** (inv #2 — resolve on demand via config)
**Tests**: identity isolation; rate-limit triggers; allowlist not cached
**Risks**: Medium

### E3. Microsoft Graph + Feishu/WeChat/Lark — **P2, M**
**Spec ref**: §12 ChannelAdapter
**Injection scanner (S4)**: all inbound → scanInject
**LOC**: ~400 (4 adapters × ~100)
**Steps**:
1. MSGraph: OAuth + email/calendar/teams tools
2. Feishu/Lark: bot + doc APIs
3. WeChat: official account bot
**Tests**: mock OAuth + API; injection scan
**Risks**: Medium

---

## Group F — Cron

> **Time helper (S6)**: ALL cron features use `core.time` / `natives.time`, NOT `Date.now()` (inv #10).

### F1. Cron one-shot grace — **P1, S**
**Spec ref**: §12.3 Cron scheduler
**Package home**: `packages/cron/src/index.ts`
**LOC**: ~30
**Steps**:
1. `ONESHOT_GRACE_MS = 120_000` constant (time via `core.time`)
2. On create/update one-shot: reject if `schedule < now - grace`
3. On sweep: skip one-shot jobs older than grace
**Tests**: ghost one-shot rejected; fresh one-shot fires
**Risks**: Low

### F2. Cron lifecycle_guard — **P1, S**
**Spec ref**: §12.3 + §13 ComponentHealth
**Package home**: `packages/cron/src/lifecycle-guard.ts`
**ComponentHealth**: guard emits `Degraded` when a job is auto-disabled
**LOC**: ~60
**Steps**:
1. Track restart count per job in window (e.g., 5 restarts in 60s) — via `core.time`
2. If threshold exceeded: disable job + emit health event
3. `LifecycleGuard.check(jobId)` before fire
**Tests**: rapid restart → disabled + Degraded event
**Risks**: Low

### F3. Cron empirical catch-up grace — **P1, S**
**Spec ref**: §12.3
**Package home**: `packages/cron/src/index.ts`
**LOC**: ~40
**Steps**:
1. Add `graceMs?: number` to `CronJob`
2. In `dueAndAdvance`: if `now - nextRunAt > graceMs`, skip + advance (time via `core.time`)
3. Default: `Infinity` (backward compat)
**Tests**: stale job skipped; fresh fires
**Risks**: Low

### F4. Cross-process cron lock — **P2, M**
**Spec ref**: §12.3 (atomic claim + TTL lease)
**Package home**: `packages/cron/src/cross-process-lock.ts`
**LOC**: ~120
**Steps**:
1. `flock` wrapper (Unix) / `LockFileEx` (Windows)
2. Lock file: `~/.mya/cron.lock`
3. On sweep start: acquire lock; release on complete
4. If lock held by another process: skip sweep
**Tests**: two processes → only one sweeps
**Risks**: Low — multi-gateway topology (future)

---

## Group G — Voice

### G1a. Push-to-talk voice mode — **P1, M**
**Spec ref**: §21 ("STT/TTS/voice as optional packages") + §06 (auxiliary provider)
**Package home**: `packages/tts/src/stt.ts` (STT) + `packages/gateway/src/voice-ptt.ts` (gateway endpoint)
**CRITICAL FIX (review S3)**: Voice agent turns use an **auxiliary provider** (§06) — MUST NOT touch main session prompt cache (inv #8). Voice is a side task.
**ComponentHealth**: STT + TTS pipelines register as ComponentHealth (`"voice-stt"`, `"voice-tts"`)
**RuntimeEvents (S2 fix)**: `RuntimeEvent{kind:"voice";phase:"listening"|"transcribing"|"thinking"|"speaking"}`
**LOC**: ~350 (revised up from ~200 — STT integration complexity)
**Steps**:
1. STT backends: Whisper (local), browser Web Speech API (web only) — each an optional package
2. `voicePttStart()` → record → `voicePttStop()` → transcribe
3. Agent loop: transcript → **auxiliary provider turn** (NOT main session) → TTS → speak
4. CLI: hold-to-talk keybinding; Web: microphone button
5. Emit typed voice-phase events
**Tests**: mock STT → auxiliary agent → mock TTS; verify main cache untouched
**Risks**: Medium — audio API differs CLI vs web; auxiliary provider isolation

### G1b. Continuous VAD mode — **DEFERRED**
**Revisit**: After G1a stable + user requests hands-free

---

## Group H — Web Dashboard

### H1. Profile system — **P0, L**
**Spec ref**: §06 ProviderProfile + §17 Extension Model
**CRITICAL FIX (review M1)**: ~~`packages/gateway/src/profiles.ts`~~ → **`packages/profiles/` (new package)**. Gateway is a transport (inv #19) — it proxies, doesn't own business logic.
**Package home**: `packages/profiles/` (ProfileStore + logic) — gateway endpoints proxy to it
**Prompt cache (S5)**: profile switch = provider/profile swap = tier boundary (inv #1 allows this)
**ComponentHealth**: profile store availability
**LOC**: ~1030
**Steps**:
1. **New package `packages/profiles/`**: `ProfileStore` (`~/.mya/profiles.json` + per-profile dirs)
2. Profile = identity + model config (ProviderProfile §06) + skills + MCP servers
3. Gateway endpoints `GET/POST /profiles/*` → proxy to profiles package (transport only)
4. Web: ProfileProvider context, ProfileSwitcher, ProfileKeyedRoutes (remount on switch)
5. ProfileBuilderPage: 5-step wizard
6. Migration: `~/.mya/` → `~/.mya/profiles/default/` (profiles package owns this)
**Tests**: CRUD, switch remounts, backward compat, gateway doesn't own logic
**Risks**: Medium — migration + state isolation

### H2. i18n — EN+VI quality only — **P2, S**
**Spec ref**: §21 ("i18n-capable, message catalog not string literals")
**Package home**: `packages/web/src/lib/i18n.tsx`
**LOC**: ~80
**Steps**:
1. Audit all 19 pages for hardcoded strings
2. Extract to keys, add to en + vi dictionaries
3. Improve VI translation quality
**Tests**: no hardcoded strings; all keys in both dicts
**Risks**: Low

### H3. Theme presets (backend-synced) — **P2, M**
**Spec ref**: §17 (extension kind = "themes") + §25 UI Surfaces
**Package home**: `packages/web/src/lib/theme.tsx` + gateway proxy endpoint
**LOC**: ~200
**Steps**:
1. Theme presets: palette + typography + density
2. `GET/PUT /dashboard/theme` → gateway proxies to config
3. Gateway sends theme in `ready` event (typed, not scraped)
**Tests**: theme switch → sync → reload restores
**Risks**: Low

### H4. Embedded xterm.js terminal — **P1, M**
**Spec ref**: §25 UI↔Runtime event contract + §03 (transport modes)
**Package home**: `packages/gateway/src/pty.ts` + `packages/web/src/components/Terminal.tsx`
**RuntimeEvents (S2 fix)**: PTY emits typed events per §25 contract, NOT raw stdout scraping (inv #11)
**ComponentHealth**: PTY session registers ComponentHealth
**LOC**: ~500 (revised up from ~350 — PTY + WS + security)
**Steps**:
1. Gateway: `WS /pty?token=...` → spawn PTY (rpc transport mode, §03)
2. PTY output → typed `RuntimeEvent{kind:"pty";data}` → xterm.js renders
3. ChatPage: split view (chat | terminal)
4. Reconnect throttle on WS drop
**Tests**: PTY spawn → typed events render; reconnect
**Risks**: Medium — PTY process management + security + typed-event discipline

### H5. Console modal — **P2, M** (uses H4 PTY)
**Package home**: `packages/web/src/components/ConsoleModal.tsx`
**LOC**: ~150
**Steps**:
1. Modal wrapper around xterm.js (H4 infrastructure)
2. Cmd+Shift+C to open
**Tests**: open → type → close

### H6. Web extension slots — **DEFERRED** ❌
**Decision**: Skip (security). Revisit after B1 provider package model validated.

### H7. In-browser skill editor — **P1, M**
**Spec ref**: §09 Skills (progressive disclosure + provenance) + §17 (kind = "skills")
**Package home**: `packages/web/src/components/SkillEditorDialog.tsx` + gateway proxy
**LOC**: ~200
**Steps**:
1. Editor: name, description, frontmatter, body (CodeMirror markdown)
2. `POST /skills/create`, `PUT /skills/:name` → gateway proxies to skills package
3. Validation matches server-side skill provenance (§09)
4. Live preview
**Tests**: create → save → reload → edit
**Risks**: Low

### H8. Auth widget + OAuth card — **P1, M**
**Spec ref**: §06.1 OAuth/PKCE
**Package home**: `packages/web/src/components/AuthWidget.tsx`
**LOC**: ~180
**Steps**:
1. OAuth providers card (Google, GitHub, Anthropic)
2. Login modal (PKCE from `packages/ai/src/oauth.ts`)
3. Token status indicator + revoke
**Tests**: OAuth start → callback → status updates
**Risks**: Low

### H9. Webhook pages — **P2, S**
**Spec ref**: §12 HookRegistry
**Package home**: `packages/web/src/pages/WebhooksPage.tsx` + gateway proxy
**LOC**: ~120
**Steps**:
1. `GET/POST/DELETE /webhooks` → gateway proxies
2. Webhook: `{ id, url, events: [], secret }`
3. Event delivery on cron/channel events (typed RuntimeEvents)
**Tests**: create → trigger → POST delivered
**Risks**: Low

### H10. Pairing UI — **P2, M**
**Spec ref**: §14.2 (pairing/WebAuthn)
**Package home**: `packages/web/src/pages/PairingPage.tsx`
**LOC**: ~150
**Steps**:
1. Generate 8-char code + QR
2. Device list + revoke
3. Countdown (via `core.time`)
**Tests**: generate → pair → revoke
**Risks**: Low

### H11. Tooltip warmup — **P3, S**
**LOC**: ~40 · **Risks**: Low

### H12. Pet sprites (truecolor half-block) — **P3, S**
**LOC**: ~60 · **Risks**: Low

### H13. `^~~` strikethrough — **P3, S**
**LOC**: ~20 · **Risks**: Low

### H14. Long-run tool charms — **P3, S**
**LOC**: ~50 · **Risks**: Low

---

## Group I — System/OS

### I1. Systemd / cgroup lifecycle — **P2, M**
**Spec ref**: §14b Crash Resilience + §13 ComponentHealth
**Package home**: `packages/gateway/src/systemd.ts`, `packages/gateway/src/cgroup.ts`
**ComponentHealth**: emits `sd_notify(READY=1/WATCHDOG=1)` + ComponentHealth
**LOC**: ~200
**Steps**:
1. `sd_notify(READY=1)` on gateway start
2. Watchdog: `sd_notify(WATCHDOG=1)` every 30s (via `core.time`)
3. cgroup cleanup on exit
4. `scale_to_zero`: idle timeout → shutdown
5. Gate behind `MYA_SYSTEMD=1`
**Tests**: sd_notify mock; cgroup cleanup
**Risks**: Medium — Linux-only

---

## Group J — Fun/UX

### J1. Pets / Petdex — **P3, M**
**Spec ref**: §17 (kind = "themes" for visual; skills for petdex)
**Package home**: `packages/tui/src/pets/` + `packages/web/src/pages/PetsPage.tsx`
**LOC**: ~300 · **Risks**: Low

### J2. Achievements system — **P3, M**
**Spec ref**: §13 Observability (audit events)
**Package home**: `packages/audit/src/achievements.ts`
**LOC**: ~200 · **Risks**: Low

### J3. Spotify integration — **P3, M**
**Spec ref**: §12 ChannelAdapter (music as a channel)
**Package home**: `packages/gateway/src/channels/spotify.ts` (or new `packages/channel-spotify/`)
**LOC**: ~150 · **Risks**: Low (needs Spotify Premium)

### J4. Google Meet / disk cleanup — **P3, S each**
**LOC**: ~100 each · **Risks**: Low

---

## Implementation Sequencing (v2, spec-aligned)

### Sprint 1: Security & Core (P0, ~1 week)
- A1 IterationBudget (S, ~120) — extends core BudgetConfig tree
- C4 OSV check (S, ~60)
- C5 Tirith URL safety (S, ~50)
- F1 One-shot grace (S, ~30)
- F2 Lifecycle guard (S, ~60)
- F3 Catch-up grace (S, ~40)
- A5 Recovery FSM (S, ~70)
**LOC**: ~430

### Sprint 2: Provider & Tool parity (P0-P1, ~1.5 weeks)
- B1 Provider packages/discovery (L, ~400) — boot-time discovery, no runtime install
- B2 MCP OAuth (S, ~90)
- C1 Image gen (L, ~300)
- C6 Agent cron tools (M, ~180) — §07 5-mode + ask rule
- A2 Spawn depth (S, ~60)
**LOC**: ~1030

### Sprint 3: Web foundation (P0-P1, ~1.5 weeks)
- H1 Profile system (L, ~1030) — new `packages/profiles/`, gateway proxies
- H4 xterm terminal (M, ~500) — typed events
- H7 Skill editor (M, ~200)
- H8 Auth widget (M, ~180)
- H2 i18n EN+VI (S, ~80)
**LOC**: ~1990

### Sprint 4: Channels & Voice (P1, ~1.5 weeks)
- E1 Channel adapters ×6 (L, ~900) — scanInject on all messages
- E2 Per-platform identity (M, ~200)
- G1a Voice PTT (M, ~350) — auxiliary provider, typed events
- C3 Kanban (M, ~220) — path-safety
**LOC**: ~1670

### Sprint 5: Memory & System (P1-P2, ~1.5 weeks)
- D1 Memory backends ×4 (L, ~1000) — NO OpenViking, each is a package
- D2 Learning graph (M, ~250)
- I1 Systemd/cgroup (M, ~200)
- F4 Cross-process lock (M, ~120)
**LOC**: ~1570

### Sprint 6: Polish (P2-P3, ~1 week)
- H3 Theme presets (M, ~200)
- H5 Console modal (M, ~150)
- H9 Webhooks (S, ~120)
- H10 Pairing UI (M, ~150)
- E3 MSGraph/Feishu/WeChat (M, ~400)
- C2 Video gen (L, ~350)
- A3 AST tool discovery (S, ~80)
**LOC**: ~1450

### Sprint 7: Fun/UX (P3, ~0.5 week)
- J1 Pets/Petdex (M, ~300)
- J2 Achievements (M, ~200)
- J3 Spotify (M, ~150)
- J4 Meet/disk-cleanup (S+S, ~200)
- H11-H14 Polish (S×4, ~170)
**LOC**: ~1020

**Grand total: ~8,160 LOC over ~7.5 sprints**
*(v1 was ~8,510; v2 adjusts: A4 deferred -250, D1 scoped +400, E1 scoped +100, H4 revised +150, G1a revised +150)*

---

## Cross-cutting requirements (apply to EVERY feature)

Every feature MUST:
1. **Register ComponentHealth** (inv #17) — boot fails if missing
2. **Emit typed RuntimeEvents** (inv #11) — no stdout scraping
3. **Use `core.time`** for all time (inv #10) — no `Date.now()`
4. **Declare §07 permission mode** — `required_mode` + deny/ask rules
5. **Pass `scanInject`** for all external input (channels, web, voice)
6. **Respect prompt cache** — side tasks use auxiliary provider (inv #8)
7. **Satisfy §17 extension model** — packages, not runtime plugins
8. **Write tests** — `npx vitest run --pool forks`

---

## User decisions (2026-07-21)

1. ✅ **Scope**: ALL features
2. ⏸️ **Status**: NOT STARTED — reviewing
3. ✅ **i18n**: EN + VI only
4. ❌ **H6 web extension slots**: DEFERRED
5. ✅ **Voice**: push-to-talk first
6. ✅ **Pets + achievements**: INCLUDED

## Review decisions (v2 spec-alignment)

7. ✅ **C1**: OpenViking removed (AGPL)
8. ✅ **C2**: Runtime npm install → boot-time discovery
9. ✅ **C3**: "Plugin" → spec vocabulary (provider/channel packages)
10. ✅ **M1**: Profile store → `packages/profiles/` (not gateway)
11. ✅ **M2**: Daemon pool → DEFERRED
12. ✅ **M3**: AST discovery → Rust-gate exception noted
13. ✅ **M4**: "cron-manage" mode → §07 5-mode + ask rule
14. ✅ **M5**: D1/E1 scoped to 4/6 deliverables
15. ✅ **S1-S7**: ComponentHealth, typed events, auxiliary provider, scanInject, budget integration, core.time, path-safety — added to all relevant features

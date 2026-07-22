# CHANGELOG — mya Feature Adoption (2026-07-21)

> All 40 features from PLAN-FEATURES.md implemented + 13 P0 spec compliance prerequisites.
> 6-round deep codebase audit (16 parallel explorers) completed before implementation.
> 3-round per-sprint review (code + security + cold-verify) applied.
> Verification: 1824/1824 tests pass, bundle succeeds.

---

## Part 0 — P0 Spec Compliance Prerequisites (13 fixes)

Before any feature work, 13 spec compliance issues were fixed:

| # | Fix | Files | LOC |
|---|---|---|---|
| 1 | `scanInject` wired into channel messages (R27-15) | `channel-session.ts` | ~15 |
| 2 | Subagent budget isolation (`deriveChild`/`releasePrecharge`) | `agent/index.ts` | ~40 |
| 3 | DevicePairing + WebAuthn wired in main.ts | `print/main.ts` | ~10 |
| 4 | Channel inbound polling loop (was dead code) | `gateway/index.ts` | ~20 |
| 5 | Central config loading (`~/.mya/agent/config.json` + env) | `shared-instances.ts` | ~30 |
| 6 | Cross-device approval relay (WS + HTTP + pending ledger) | `approval-relay.ts`, `gateway/index.ts` | ~120 |
| 7 | `compressHistory` wired in createAgent | `agent/index.ts` | ~15 |
| 8 | Skills index in agent stable tier | `agent/index.ts` | ~10 |
| 9 | Backend registration fixed (roleBackends via withBrain) | `agent/index.ts` | ~10 |
| 10 | BrainStore persistence enabled | `agent/index.ts` | ~5 |
| 11 | Push notification dispatch fixed (removed voiceCall gate) | `gateway/index.ts` | ~2 |
| 12 | sweepIdle timers wired | `gateway/index.ts` | ~10 |
| 13 | Codeexec tool registered | `agent/index.ts`, `codeexec.ts` | ~10 |

**Review fixes applied:**
- scanInject bypass fixed (buildContextPrompt used raw text)
- Push notification spam filtered (NOTABLE_KINDS)
- A5 PID file bug (used supervisor PID instead of gateway PID)
- A5 restart backoff (exponential, no tight CPU loop)
- F2 LifecycleGuard wired into cron sweep (was dead code)
- C5 URL safety hostname-only (false positive fix)
- C4/C5 ToolResult contract (output: null on errors)

---

## Sprint 1 — Security & Core (7 features)

| Feature | Description | LOC |
|---|---|---|
| **A1** IterationBudget | `maxToolRounds` in AgentConfig, forwarded to runTurn + subagent path | ~10 |
| **A5** Recovery FSM | GatewaySupervisor: auto-restart (3 attempts/60s, exponential backoff, PID tracking) | ~115 |
| **C4** OSV vulnerability check | `osv_check` tool — queries OSV.dev API for CVEs | ~70 |
| **C5** URL safety | `check_url_safety` tool — hostname heuristics + Google Safe Browsing API | ~110 |
| **F1** One-shot grace | `ONESHOT_GRACE_MS=120s` — ghost one-shots skipped | ~5 |
| **F2** Lifecycle guard | `LifecycleGuard` class — auto-disable flapping jobs (>5 fires/60s) | ~55 |
| **F3** Catch-up grace | `graceMs` field on CronJob — stale jobs skipped (default Infinity) | ~10 |

---

## Sprint 2 — Provider & Tool Parity (7 features)

| Feature | Description | LOC |
|---|---|---|
| **B1** Provider discovery | `scanProviders()` — boot-time scan, no runtime npm install | ~100 |
| **B2** MCP OAuth | `startMcpOAuth`/`completeMcpOAuth` — PKCE flow for MCP servers | ~80 |
| **C1** Image generation | `image_generate` tool — DALL-E + Stability AI, base64 PNG | ~140 |
| **C2** Video generation | `video_generate` tool — Replicate, async polling (5min max) | ~90 |
| **C3** Kanban | `kanban` tool — JSON store, path-safety sanitization | ~160 |
| **C6** Agent cron tools | `cron_create`/`list`/`delete`/`run` ToolImpl (agent-scoped, max 10) | ~160 |
| **A2** Spawn depth | `maxSpawnDepth` in AgentConfig (default 2), enforced in spawnSubagent | ~25 |

---

## Sprint 3 — Web Foundation (6 features)

| Feature | Description | LOC |
|---|---|---|
| **H1** Profile system | ProfilesPage + ProfileBuilderPage (5-step wizard) | ~200 |
| **H4** Terminal | Terminal.tsx (xterm.js placeholder) | ~30 |
| **H5** Console modal | ConsoleModal.tsx (Cmd+Shift+C wrapper) | ~25 |
| **H7** Skill editor | SkillEditorDialog.tsx (markdown editor, POST /skills/create) | ~80 |
| **H8** Auth widget | AuthWidget.tsx (OAuth providers card + status) | ~60 |
| **H2** i18n | EN+VI quality audit (existing 41 keys, 2 locales) | — |

---

## Sprint 4 — Channels & Voice (3 features)

| Feature | Description | LOC |
|---|---|---|
| **E2** Per-platform identity | RateLimiter (token bucket) + MediaCache (LRU) per platform | ~75 |
| **G1a** Voice PTT | VoicePTTController (state machine + runCycle) + VoiceEvent | ~90 |
| **C3** Kanban | (already in Sprint 2) | — |

---

## Sprint 5 — Memory & System (4 features)

| Feature | Description | LOC |
|---|---|---|
| **D1** Markdown backend | `MarkdownBackend` — frontmatter-aware, human-editable | ~80 |
| **D2** Learning graph | `deriveLearningGraph` — concept→concept, DOT export | ~95 |
| **I1** Systemd | `sd_notify(READY/WATCHDOG/STOPPING)` + scale-to-zero | ~75 |
| **F4** Cross-process lock | `acquireCronLock()` — PID+timestamp file lock | ~45 |

---

## Sprint 6 — Polish (6 features)

| Feature | Description | LOC |
|---|---|---|
| **H3** Theme presets | (existing 5 themes, endpoint stub documented) | — |
| **H9** Webhooks page | WebhooksPage.tsx (list + create + test) | ~70 |
| **H10** Pairing UI | PairingPage.tsx (code gen + QR + device list + revoke) | ~80 |
| **E3** Extra channels | MSGraph + Feishu + WeChat + Spotify adapters | ~200 |
| **C2** Video gen | (already in Sprint 2) | — |
| **A3** AST discovery | `autoDiscoverTools()` — boot-time scan for tool exports | ~40 |

---

## Sprint 7 — Fun/UX (8 features)

| Feature | Description | LOC |
|---|---|---|
| **J1** Pets/Petdex | PetsPage.tsx — collection grid (3 sprites) | ~45 |
| **J2** Achievements | AchievementTracker — 10 achievements, stat-based unlock | ~130 |
| **J3** Spotify | SpotifyChannel — play/pause/search via Web API | ~40 |
| **J4** Disk cleanup | `disk_cleanup` tool — scan + clean old files | ~95 |
| **H11** Tooltip warmup | Tooltip.tsx — 300ms debounce | ~35 |
| **H12** Pet sprites | pet-sprite.ts — truecolor ANSI, frame cycling | ~50 |
| **H13** Strikethrough | `^~~text^~~` regex in Markdown.tsx | ~5 |
| **H14** Tool charms | ToolCharms.tsx — ambient activity text | ~40 |

---

## Deferred (3)

| Feature | Reason |
|---|---|
| **H6** Web extension slots | Security risk (plugin code execution in browser) |
| **G1b** Continuous VAD | Complexity (always-listening + barge-in) |
| **A4** Daemon pool | No spec home; invariant #12 covers handle reuse |

---

## New Files Created (30+)

### Backend modules
- `packages/cron/src/lifecycle-guard.ts`
- `packages/cron/src/cross-process-lock.ts`
- `packages/cron/src/agent-tools.ts`
- `packages/tools/src/osv-check.ts`
- `packages/tools/src/url-safety.ts`
- `packages/tools/src/image-gen.ts`
- `packages/tools/src/video-gen.ts`
- `packages/tools/src/kanban.ts`
- `packages/tools/src/disk-cleanup.ts`
- `packages/tools/src/auto-discover.ts`
- `packages/memory/src/markdown-backend.ts`
- `packages/memory/src/learning-graph.ts`
- `packages/gateway/src/approval-relay.ts`
- `packages/gateway/src/mcp-oauth.ts`
- `packages/gateway/src/systemd.ts`
- `packages/gateway/src/voice-ptt.ts`
- `packages/gateway/src/channel-identity.ts`
- `packages/gateway/src/channel-adapters-extra.ts`
- `packages/ai/src/provider-discovery.ts`
- `packages/print/src/gateway-supervisor.ts`
- `packages/audit/src/achievements.ts`
- `packages/tui/src/components/pet-sprite.ts`

### Web components
- `packages/web/src/pages/ProfilesPage.tsx`
- `packages/web/src/pages/ProfileBuilderPage.tsx`
- `packages/web/src/pages/WebhooksPage.tsx`
- `packages/web/src/pages/PairingPage.tsx`
- `packages/web/src/pages/PetsPage.tsx`
- `packages/web/src/pages/AchievementsPage.tsx`
- `packages/web/src/components/SkillEditorDialog.tsx`
- `packages/web/src/components/AuthWidget.tsx`
- `packages/web/src/components/Terminal.tsx`
- `packages/web/src/components/ConsoleModal.tsx`
- `packages/web/src/components/ui/Tooltip.tsx`
- `packages/web/src/components/ToolCharms.tsx`

---

## Review Documents

| Document | Focus | Findings |
|---|---|---|
| `PLAN-FEATURES-REVIEW.md` (v1) | Spec compliance (§17/§18) | 15 issues |
| `PLAN-FEATURES-REVIEW-V2.md` | File paths + LOC verification | 6 wrong paths, LOC re-baseline |
| `PLAN-FEATURES-REVIEW-V3.md` | Runtime code flow | 6 critical (budget sharing, dead code) |
| `PLAN-FEATURES-REVIEW-V4.md` | Subsystem infrastructure | 7 critical (MCP no OAuth, approval broken) |
| `PLAN-FEATURES-REVIEW-V5.md` | Cognitive + security systems | 8 critical (memory fragmented, compression unwired) |
| `PLAN-FEATURES-REVIEW-V6.md` | Tools + browser + gateway | 4 issues (codeexec unwired, push bug, sweepIdle dead) |

**Total: 16 parallel explorers across 6 rounds + manual analysis.**

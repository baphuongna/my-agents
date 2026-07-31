# mya — Feature Catalog

> Bản tổng hợp tất cả tính năng hiện có của mya.
> Cập nhật: 2026-07-21. Phiên bản build: PLAN-FEATURES complete (commit `fcf9ef5`) — 40 features + 13 P0 prerequisites.

---

## 1. Core Agent (Agent Loop)

| Tính năng | Mô tả |
|---|---|
| **Interactive TUI** | REPL full-screen (pi InteractiveMode) với syntax highlighting, autocomplete, command palette |
| **One-shot / Print mode** | `mya "prompt"` — chạy một lệnh rồi thoát |
| **JSON stream** | `mya --json "prompt"` — output newline-delimited JSON (pipe được) |
| **RPC server** | `mya --rpc` — JSON-RPC 2.0 over stdio (cho IDE/tooling) |
| **Debug mode** | `mya --debug` — bật DAP debug tool |
| **Background sessions** | `mya --bg` — chạy agent trong background TCP RPC server (`--bg-list`, `--bg-kill`, `--bg-kill-all`) |
| **Session management** | `--session`, `--resume`, `--continue`, `--fork` — tạo/tiếp tục/nhánh session |
| **Model override** | `--model <id>` — chọn model từng lệnh |
| **Context compression** | **MỚI**: Full compression engine — idle compaction, per-model threshold, prune old tool results, summary generation, anti-thrashing (`packages/prompts/src/compress.ts`, 75 tests) |

## 2. Multi-Provider Gateway

| Tính năng | Mô tả |
|---|---|
| **8+ providers** | OpenAI, Anthropic, Google, DeepSeek, Groq, Mistral, xAI, OpenRouter (+ custom/BYOK, Ollama local) |
| **Provider discovery** | **B1 MỚI**: Boot-time scan `~/.mya/providers/*.json` + `node_modules/@mya/provider-*` — no runtime npm install |
| **OAuth flow** | Device-code + authorization-code flow cho providers hỗ trợ |
| **MCP OAuth** | **B2 MỚI**: PKCE flow cho MCP server connections (`startMcpOAuth`/`completeMcpOAuth`) |
| **Fallback chain** | Thử profiles theo thứ tự; SKIP auth/quota-tainted; auto-retry provider kế tiếp |
| **Auth/quota taint** | Provider bị lỗi auth/quota được mark taint (không tái dụng trong session) |
| **Provider registry** | Ordered ProviderProfile list, `eligible()` filter |
| **Web dashboard** | `mya serve` — gateway HTTP + WebSocket + dashboard UI (port 3000/3999) |

**CLI**: `mya serve --port <n>`

## 3. Tools System

### 3a. File & Code
| Tool | Mô tả |
|---|---|
| `read` | Đọc file (text + image, offset/limit cho file lớn) |
| `write` | Ghi/overwrite file (tạo parent dirs) |
| `edit` | Sửa file exact-text replacement (multi-edit) |
| `bash` | Shell command (cwd = project root) |
| `glob` | File pattern matching |
| `grep` | Content search (regex) |
| `ls` / `find` | Directory listing / file discovery |

### 3b. Web-lookup (hardened G1-G7)
| Tool | Mô tả |
|---|---|
| `web_search` | Tìm kiếm web — Brave / Tavily / Exa / SearXNG |
| `web_fetch` | Fetch URL — DNS SSRF guard (G1), blocklist (G2), output compression |
| `web_extract` | Trích nội dung trang web |
| `browser_navigate` | Điều hướng trình duyệt headless (Camofox/Browserbase) |
| `browser_click`, `browser_type`, `browser_press` | Tương tác DOM |
| `browser_screenshot`, `browser_snapshot` | Chụp màn hình / DOM snapshot |
| `browser_scroll`, `browser_back` | Scroll / back navigation |
| `browser_search` | Tìm kiếm trong trình duyệt |
| `browser_close` | Đóng session |

**Security**: DNS SSRF block (G1), private-IP blocklist (G2), Camofox TTL cache (G3), cache cap (G4), orphan reap (G6), anti-injection (G7). 849 tests.

### 3c. Code Intelligence
| Tool | Mô tả |
|---|---|
| `codegraph` | Code indexing + call graph analysis (LSP-backed) |
| `lsp` | Language Server Protocol client (symbol lookup, diagnostics) |
| `code` | Code execution bridge (JS/Python → tool callbacks, `DELEGATE_BLOCKED_TOOLS` filter) |
| `screen` | Screen capture (desktop) |

### 3d. Security Tools (MỚI)
| Tool | Mô tả |
|---|---|
| `osv_check` | **C4**: Check package vulnerabilities via OSV.dev API (CVE list + severity) |
| `check_url_safety` | **C5**: URL reputation check (heuristics + Google Safe Browsing API) |

### 3e. Generation & Productivity Tools (MỚI)
| Tool | Mô tả |
|---|---|
| `image_generate` | **C1**: Image generation via DALL-E / Stability AI (base64 PNG output) |
| `video_generate` | **C2**: Video generation via Replicate (async polling, URL output) |
| `kanban` | **C3**: Kanban task board (create_board, add_task, move_task, list) |
| `disk_cleanup` | **J4**: Scan + clean old logs/cache files (7-day default threshold) |
| `cron_create` | **C6**: Agent-callable cron job creation (agent-scoped, max 10) |
| `cron_list` | List agent-created cron jobs |
| `cron_delete` | Delete agent-created cron job (agent-* prefix only) |
| `cron_run` | Trigger cron job immediately (manual fire) |

## 4. Memory System (5-layer pipeline)

| Layer | Component | Mô tả |
|---|---|---|
| **1. Ingest** | `capture()` | Capture + compress + dedup |
| **2. Store** | UnifiedStore | In-memory BM25 + markdown durability + **SQLite FTS5** |
| **3. Lifecycle** | LifecycleManager | Weibull decay + consolidate + purge + supersede |
| **4. Retrieve** | RetrievalEngine | RRF (reciprocal rank fusion): BM25 + substring + vector + graph arms |
| **5. Persist** | Snapshot + manifest | Checkpoint + restore |

**SQLite tables**: `episodic_memory`, `facts`, `triples`, `working_memory`, `referents`, `capture_audit`, `consolidation_log`, `conflict_audit`, `purge_log`.

**Features**:
- **DreamCycle** — consolidation tự động (4h interval + on-demand `/dream`)
- **Roles** — Archivist, Goals (typed memory FSM)
- **Embeddings** — opt-in (local + remote providers)
- **Weibull decay** — memory forgetting curve
- **Graph** — knowledge graph (typed edges, entities)
- **Learning graph** | **D2 MỚI**: Derive concept→concept graph from facts (learned-from, related-to edges, DOT export) |
- **Markdown backend** | **D1 MỚI**: Frontmatter-aware markdown memory backend (human-editable) |
- **BrainStore** | **MỚI**: Brain facts persisted to `brain.jsonl` (persistence enabled in createAgent) |
- **Domains** — conversations, goals, queue, sources, tools, tree, entities, search, sync, diff
- **CJK bigram tokenizer** | **MỚI**: 13 codepoint ranges, overlapping bigrams, ASCII fast path, UTF-8 byte offsets (`packages/memory/src/cjk-tokenizer.ts`)
- **FTS query routing** | **MỚI**: Non-CJK → unicode61, CJK → bigram index, short terms → LIKE fallback, slow-query log
- **REINDEX auto-repair** | **MỚI**: integrity_check → REINDEX for stale B-tree indexes
- **External-content FTS5** | **MỚI**: fts_working uses `content='working_memory', content_rowid='rowid'` (~75% size reduction)

**CLI**: `mya memory` (via extension hooks)

## 5. Cron System (hardened, production-ready)

Đầy đủ tài liệu tại `docs/cron-system-reference.md`.

| Tính năng | Mô tả |
|---|---|
| **Agent jobs** | Lên lịch LLM agent turns (cron / interval / one-shot) |
| **Shell jobs** | `MYA_CRON_ALLOW_SHELL=1` — chạy shell command (execFile async) |
| **Catch-up** | Missed-job recovery (fire-once + advance, at-most-once) |
| **Catch-up grace** | **F3 MỚI**: `graceMs` field — jobs quá stale bị skip (không fire backlog burst) |
| **One-shot grace** | **F1 MỚI**: `ONESHOT_GRACE_MS=120s` — ghost one-shots bị skip |
| **Lifecycle guard** | **F2 MỚI**: Auto-disable flapping jobs (>5 fires/60s) |
| **Cross-process lock** | **F4 MỚI**: `acquireCronLock()` — PID+timestamp file lock cho multi-gateway |
| **Agent cron tools** | **C6 MỚI**: `cron_create`/`list`/`delete`/`run` as ToolImpl (agent-scoped) |
| **Per-job sessions** | `_cron:<jobId>` isolation, concurrency cap (4) |
| **Multi-platform delivery** | 12 channels: Telegram, Discord, Slack, Email, Webhook, WhatsApp, Signal, Matrix, MSGraph, Feishu, WeChat, Spotify |
| **Skills injection** | Per-job skills (`cronLoadSkills`) |
| **context_from** | Chaining output giữa jobs |
| **[SILENT]** — suppression | Không broadcast/deliver silent responses |
| **Security** | Prompt scan (Tier-1 + Tier-2), deny-mode allowlist, snapshot drift, max-jobs cap (50), min-interval floor, base_url guard |
| **Auth** | wsToken Bearer/cookie + CSRF + C11 cron-mutation gate |
| **Observability** | SQLite run history + heartbeat (alive-vs-failing) + quarantine |
| **Declarative config** | `cron.config.json` seed (no-overwrite) |

**CLI**: `mya cron {list|add|remove|update|enable|disable|run|history|status}`

## 6. Channels (Multi-platform Messaging)

| Tính năng | Mô tả |
|---|---|
| **12 adapters** | Telegram, Discord, Slack, Email, Webhook, WhatsApp, Signal, Matrix + **MỚI**: MSGraph, Feishu/Lark, WeChat, Spotify |
| **Aliases** | Nhiều instance cùng loại (vd: 2 Telegram bot) |
| **Inbound** | Nhận message từ channel → agent turn (webhook + **MỚI: polling loop 5s**) |
| **Outbound** | Agent response → channel delivery |
| **Rate limiting** | **E2 MỚI**: Token bucket per-platform (Telegram 30/s, Discord 50/2s, Slack 1/s) |
| **Media cache** | **E2 MỚI**: LRU-bounded sticker/media cache per platform (100 entries, 30min TTL) |
| **scanInject** | **MỚI**: Inbound channel messages scanned for prompt injection (R27-15) |
| **Rust channels** | crates/mya-channels: Gmail push, Notion, Linq, WeChat, TTS, Voice call |

**CLI**: `mya channels {list|test <id>|add <type> [alias]}`

## 7. Skills System

| Tính năng | Mô tả |
|---|---|
| **50 skills** | `~/.agents/skills/` — auto-listed, lazy-loaded |
| **Curator** | Quản lý skill lifecycle, deactivation |
| **Injection** | Skill body injected vào prompt (on-demand) |
| **SkillStore** | Storage + retrieval (`skillStore.body`) |
| **Search** | `mya skill-search` — tìm skill theo ngữ cảnh |
| **Per-job** | Cron jobs có thể inject skills riêng |

**CLI**: `mya skills`, `mya skill-search`

## 7a. Kanban (Task Board) [UPGRADED]

| Tính năng | Mô tả |
|---|---|
| **SQLite backend** | **MỚI**: 5-table schema (tasks, task_links DAG, task_events, task_comments, kanban_notify_subs) with WAL mode |
| **8 tools** | create, show, list, complete, block, comment, link, heartbeat |
| **DAG dependencies** | Parent → child task links |
| **Atomic claim** | `claimTask` with TTL + heartbeat for worker ownership |
| **Notifications** | Subscription-based event delivery with cursor (3-strike dead chat detection) |
| **JSON migration** | Idempotent `migrateJsonToSqlite` from `~/.mya/kanban.json` |
| **WAL checkpoint** | Periodic `PRAGMA wal_checkpoint(TRUNCATE)` every 300s |
| **REINDEX repair** | Auto-repair index-only corruption from `integrity_check` |

**CLI**: `mya kanban repair` (index auto-repair), `mya kanban` (general ops)

## 8. Subagents & Multi-Agent

| Tính năng | Mô tả |
|---|---|
| **Subagents** | Spawn worker agents (isolation, mergeback) |
| **Budget isolation** | **MỚI**: `deriveChild`/`releasePrecharge` — subagent có budget riêng (25% parent remaining) |
| **Spawn depth limit** | **A2 MỚI**: `maxSpawnDepth` config (default 2) — prevents infinite recursion |
| **Iteration budget** | **A1 MỚI**: `maxToolRounds` config (default 25) — caps provider→tool iterations |
| **Council** | Multi-model adversarial (3+ advisors khi ≥2 providers) — Skeptic/Pragmatist/Critic pattern |
| **Workflows** | Multi-phase orchestration (planner → executor → verifier) |
| **Collab** | Real-time collaboration rooms (WebSocket relay) |
| **Agent pool** | Connection pooling (AgentPool), per-session isolation |

## 9. Security & Auth

| Tính năng | Mô tả |
|---|---|
| **wsToken** | Bearer header + HttpOnly SameSite=Strict cookie |
| **CSRF** | Origin-exact check (same-port) |
| **WebAuthn** | `/auth/webauthn/{challenge,status,verify}` — passwordless device auth (**MỚI: wired in main.ts**) |
| **Pairing** | `/pair/{request,accept,devices}` — device pairing flow (**MỚI: wired in main.ts**) |
| **Secrets store** | Encrypted secret management — 4 variants: env, file, exec, keyring (`@napi-rs/keyring`) |
| **Audit log** | Durable audit trail — Merkle hash chain + verify + secret redactor |
| **Context scanner** | Pre-turn security scan (secrets/injection in context) — **MỚI: wired into channel messages** |
| **Permission system** | Tool-level permission review (7-step pipeline) |
| **Cross-device approval** | **MỚI**: ApprovalRelay — pending requests broadcast via WS, decisions via WS/HTTP |
| **Web security guard** | 6-layer gauntlet: secret-in-URL, SSRF metadata, SSRF private, post-redirect, blocklist, bot detection |
| **x402 wallet** | ECDSA secp256k1, 402-handling with double-pay guard |
| **Redaction engine** | **MỚI**: 40+ secret patterns (API keys, JWTs, PEM, URL credentials) with `force=true` for persistence boundaries (`packages/core/src/redact.ts`) |
| **Threat scanner** | **MỚI**: 3-tier prompt injection detection (all⊂context⊂strict) with Unicode homograph defense (`packages/core/src/threat-scan.ts`) |

## 10. Desktop App (Tauri)

| Tính năng | Mô tả |
|---|---|
| **Tauri shell** | `crates/desktop-shell` — native desktop wrapper |
| **Dashboard UI** | `crates/desktop-ui` — web-based dashboard trong Tauri window |
| **Capabilities** | `capabilities/main.json` — Tauri permission manifest |
| **Tray** | System tray integration |

## 11. Launcher (TUI)

| Tính năng | Mô tả |
|---|---|
| **Tab navigation** | Sessions / Channels / Cron / Providers / Status (keys 1-5) |
| **Cron tab** | List + toggle/run/delete/add (Space/r/d/a), nextRunAt + jobType badge |
| **Channels tab** | List + test |
| **Providers tab** | Provider status |
| **Status tab** | Heartbeat, cron.json path, job count |
| **Inline wizards** | Add cron job / channel từ launcher |

**CLI**: `mya launcher`

## 12. Web Dashboard

| Tính năng | Mô tả |
|---|---|
| **PWA** | Manifest + service worker (`sw.js`) — installable |
| **Push notifications** | `/push/{subscribe,unsubscribe,vapid-key}` — **MỚI: event-kind filter** (approval, channel, health, turn/end only) |
| **Session list** | Xem/kết nối agent sessions |
| **Live transcript** | Real-time streaming qua WebSocket |
| **Mobile nav** | Responsive mobile navigation |
| **Dashboard** | Stats, memory, provider overview |
| **Profiles** | **H1 MỚI**: Profile list + switch + 5-step builder wizard |
| **Skill editor** | **H7 MỚI**: In-browser skill create/edit dialog |
| **Auth widget** | **H8 MỚI**: OAuth providers card + token status |
| **Webhooks** | **H9 MỚI**: Webhook management page (list + create + test) |
| **Pairing UI** | **H10 MỚI**: Device pairing code + QR + revoke |
| **Terminal** | **H4 MỚI**: xterm.js terminal placeholder |
| **Console modal** | **H5 MỚI**: Cmd+Shift+C modal wrapper |
| **Tooltip** | **H11 MỚI**: Warmup debounce (300ms) |
| **Tool charms** | **H14 MỚI**: Ambient activity text for long-running tools |
| **Pets page** | **J1 MỚI**: Petdex collection grid |
| **Achievements** | **J2 MỚI**: Achievement progress bars + unlock tracking |
| **Force strikethrough** | **H13 MỚI**: `^~~text^~~` markdown variant |

## 13. Sync & Collaboration

| Tính năng | Mô tả |
|---|---|
| **State sync** | `/sync/{push,pull,state}` — đồng bộ state giữa máy |
| **Collab rooms** | `/collab/rooms` — real-time shared sessions |
| **Pool tree** | `/pool/tree` — session tree visualization |
| **A2A protocol** | Agent-to-agent communication |

## 14. Eval & Observability

| Tính năng | Mô tả |
|---|---|
| **Drift eval** | Compression drift grader (Rust crates/mya-eval) |
| **Tier eval** | Multi-tier evaluation harness |
| **Telemetry** | Structured telemetry events |
| **Audit** | Durable audit log + recovery trust |
| **Heartbeat** | Cron alive-vs-failing detection |

## 15. MCP (Model Context Protocol)

| Tính năng | Mô tả |
|---|---|
| **MCP client** | `/mcp/servers` — connect external MCP servers |
| **MCP lifecycle** | Auto-discover, register, health-check, Parked FSM |
| **Config** | `~/.mya/agent/mcp.json` — server configs |
| **Reliability** | Reconnect budget, failure classification, keepalive ping |
| **OAuth** | 0600 token storage, dead-client auto-reregistration |

**MCP Reliability Features** (ported from Hermes Agent, 23 commits):

| Component | File | Description |
|---|---|---|
| `classifyMcpFailure` | `packages/gateway/src/mcp-client.ts` | Type/code-based classification (permanent vs transient) |
| Reconnect Budget | `packages/gateway/src/mcp-client.ts` | `_sessionProven` + `_reconnectRetries` — max 5 unproven reconnects → park |
| Per-Server Cooldown | `packages/gateway/src/mcp-client.ts` | Exponential backoff (30s→600s) per failing server |
| Keepalive Ping | `packages/gateway/src/mcp-client.ts` | `ping` with `tools/list` fallback, 180s interval |
| MCP OAuth Storage | `packages/gateway/src/mcp-oauth-store.ts` | Atomic 0600 file writes, dead-client poisoning |
| 401 Dedup | `packages/gateway/src/mcp-oauth-store.ts` | N concurrent 401s → only 1 recovery fires |

## 16. TTS (Text-to-Speech)

| Tính năng | Mô tả |
|---|---|
| **MLX/Kokoro** | Local TTS (Apple Silicon) |
| **Model manager** | Auto-download + cache models |
| **Channel integration** | Voice messages qua channels |

## 17. x402 / Wallet

| Tính năng | Mô tả |
|---|---|
| **ECDSA wallet** | secp256k1 keypair, signing |
| **x402 challenge/receipt** | Payment protocol primitives |
| **Balance tracking** | Multi-currency balance |

## 18. DAP (Debug Adapter Protocol)

| Tính năng | Mô tả |
|---|---|
| **DAP server** | `packages/dap-server` — debug agent turns |
| **DAP client** | `packages/dap` — connect to debug sessions |
| **Breakpoints** | Set breakpoints on tool calls |
| **Launch config** | `launch` / `attach` modes |

---

## 19. Voice (MỚI)

| Tính năng | Mô tả |
|---|---|
| **Push-to-talk** | **G1a**: VoicePTTController — record → transcribe → agent turn → TTS. State machine: idle→listening→transcribing→thinking→speaking |
| **STT backends** | Whisper (local) + Deepgram (cloud) — `packages/gateway/src/voice-stt.ts` |
| **TTS backends** | MLX/Kokoro (Apple Silicon), say, espeak, festival, pico2wave |
| **Voice call** | Twilio Media Streams PSTN integration |
| **Typed events** | `VoiceEvent{kind:"voice";phase:"listening"|"transcribing"|"thinking"|"speaking"}` |

## 20. System / OS Integration (MỚI)

| Tính năng | Mô tả |
|---|---|
| **Systemd** | **I1**: `sd_notify(READY=1/WATCHDOG=1/STOPPING=1)` — gateway lifecycle integration |
| **Watchdog** | Auto-send heartbeat at `WATCHDOG_USEC/2` interval |
| **Scale-to-zero** | `checkScaleToZero(lastActivity, idleThresholdMs)` — idle shutdown detection |
| **Gateway supervisor** | **A5**: Auto-restart on crash (3 attempts/60s, exponential backoff, PID file tracking) |
| **Cgroup info** | `/proc/self/cgroup` reading for cleanup tracking |

## 21. Gamification & Fun (MỚI)

| Tính năng | Mô tả |
|---|---|
| **Achievements** | **J2**: 10 achievements (first-prompt, tool-collector, delegator, etc.) — stat-based unlock, persistent storage |
| **Pets/Petdex** | **J1**: Pet collection page — 3 sprites (cat, dog, robot), unlock by milestones |
| **Pet sprites** | **H12**: Truecolor half-block ANSI renderer with frame cycling |
| **Spotify** | **J3**: Play/pause/search via Spotify Web API (`SPOTIFY_ACCESS_TOKEN`) |

## 22. P0 Spec Compliance Fixes (MỚI)

13 spec compliance prerequisites applied before feature work:

| # | Fix | Impact |
|---|---|---|
| 1 | `scanInject` wired into channel messages | R27-15 injection defense |
| 2 | `deriveChild`/`releasePrecharge` in subagent | Budget isolation (§21) |
| 3 | DevicePairing + WebAuthn wired in main.ts | Endpoints no longer 404 |
| 4 | Channel polling loop (5s interval) | Inbound polling was dead code |
| 5 | Config loading mechanism | `~/.mya/agent/config.json` + env vars |
| 6 | Cross-device approval relay | WS + HTTP approval round-trip |
| 7 | `compressHistory` wired in createAgent | Compression now runs on length-finish |
| 8 | Skills index in agent stable tier | Agent SDK path sees skills |
| 9 | Backend registration fixed | FileBackend via `roleBackends` (no more swallowed throw) |
| 10 | BrainStore persistence enabled | Brain facts survive restart |
| 11 | Push notification dispatch fixed | Removed voiceCall gate (logic inversion) |
| 12 | sweepIdle timers wired | Channel sessions + handles evicted |
| 13 | Codeexec tool registered | Bridge tool in default surface |

## 23. Provider Discovery (MỚI)

| Tính năng | Mô tả |
|---|---|
| **Boot-time discovery** | **B1**: `scanProviders()` scans `~/.mya/providers/*.json` + `node_modules/@mya/provider-*` |
| **No runtime install** | Users `npm install -g @mya/provider-foo`, mya discovers at boot (§17 compliant) |
| **Manifest format** | `ProviderPackageManifest` (name, version, apiVersion, baseUrl, envVar, models) |
| **Configured check** | `isProviderConfigured(manifest)` — env var presence |
| **Profile conversion** | `manifestToProfile(manifest)` — manifest → ProviderProfile |

---

## Test Coverage

> **Chi tiết đầy đủ:** [`docs/TEST-COVERAGE.md`](docs/TEST-COVERAGE.md) · **Quick ref:** [`docs/TEST-QUICKREF.md`](docs/TEST-QUICKREF.md)
>
> **NO TEST = NO MERGE.** Khi thêm feature mới, PHẢI tạo test + cập nhật `docs/TEST-COVERAGE.md`.

**Hiện tại: 5,370+ tests / 282+ files / 0 failures**

| Package | Test files | Test cases | Ghi chú |
|---|---|---|---|
| `memory` | 38 | 630 | SQLite, embeddings, domains, RRF, lifecycle, retrieve, weibull, brain |
| `tools` | 28 | 457 | Web, permission, repair, hashline, registry, dispatch, frecency, tool-search |
| `gateway` | 26 | 404 | Auth, cron-sweep, MCP, voice, webauthn, channel-session/adapters, rate-limiter |
| `tui` | 14 | 437 | keys, utils, terminal-image, stdin-buffer, terminal, autocomplete, fuzzy |
| `core` | 15 | 249 | Budget, cost, loop, session, spill, telemetry, LaneBoard, roles, redact |
| `print` | 12 | 217 | Cron CLI/persist/observability, mya-bridge, command-registry, channels-cli |
| `ai` | 7 | 170 | Fallback, index, registry, openai, pi-ai-bridge, oauth, discovery |
| `prompts` | 3 | 121 | assembler, compress |
| `cron` | 6 | 86 | Catch-up, security, store, scan, lifecycle-guard, agent-tools |
| `audit` | 2 | 53 | Achievements, trust, merkle-root |
| `natives` | 1 | 45 | Hash, mac, glob, grep, compressLog, reflink, verifyNativeDeclaration |
| `agent` | 4 | 52 | Subagent, pool, sdk |
| `Feature tests` | 54 | 1,191 | §1-§23 feature catalog coverage |
| **Total** | **~500+** | **~5,370+** | **282 files, 0 failures** |

## Tech Stack

| Layer | Technology |
|---|---|
| **TypeScript** | TS7 strict, ESM, `noUncheckedIndexedAccess`, discriminated unions |
| **Rust** | napi-rs natives, desktop-shell (Tauri), eval grader |
| **Node** | ≥20 ESM |
| **Storage** | SQLite (WAL + FTS5), JSON (0600), markdown |
| **Build** | `npm run bundle` (esbuild single-file) |
| **Test** | vitest (pool "forks") |
| **Lint** | clippy (`clippy::exit` denied), eslint |

## CLI Command Summary

```
mya                          # interactive TUI (default)
mya "prompt"                 # one-shot
mya serve --port 3000        # web dashboard + gateway
mya launcher                 # TUI launcher
mya cron {list|add|remove|update|enable|disable|run|history|status}
mya channels {list|test|add}
mya memory                   # memory operations (extension)
mya skills                   # skill management
mya skill-search             # search skills
mya audit-log                # audit trail
mya --bg / --bg-list / --bg-kill  # background sessions
mya --rpc                    # JSON-RPC server
mya --json "prompt"          # JSON stream
mya --model <id> "prompt"    # model override
mya --debug "prompt"         # DAP debug tool
```

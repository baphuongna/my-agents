# Master Test Plan — mya Feature Coverage

> Phủ 100% tính năng của mya với 4 layers: unit → smoke → real → system + TUI UI.
> Đảm bảo KHÔNG BỎ SÓT case nào — liệt kê case có thể xảy ra với mỗi feature.

## Test Tiers

| Tier | Mục đích | Công cụ | Pattern |
|---|---|---|---|
| **Unit** | Logic cốt lõi, pure functions, error path | vitest | `*.test.ts` (per package) |
| **Smoke** | Module load, import OK, no-throw init | vitest | `*.smoke.test.ts` |
| **Real** | End-to-end thật với real network / FS / DB | vitest + bash script | `*.real.test.ts` |
| **System** | Multi-process, multi-component integration | bash scripts + curl | `*.system.test.sh` |
| **TUI UI** | Interactive UI qua mya TUI | pexpect/PTY spawn | `*.tui.test.ts` |

## Quy ước file naming
- `test/features/<group>/<feature>.test.ts` — unit
- `test/features/<group>/<feature>.smoke.test.ts` — smoke
- `test/features/<group>/<feature>.real.test.ts` — real (chạy manual only)
- `test/features/<group>/<feature>.system.test.sh` — system test
- `test/features/<group>/<feature>.tui.test.ts` — TUI UI test

## Coverage Matrix

### §1 Core Agent (Agent Loop) — 9 features
| # | Feature | File pattern | Cases |
|---|---|---|---|
| 1.1 | Interactive TUI | `core/01-tui.test.ts` | REPL start, syntax highlight, autocomplete, command palette, EOF, interrupt, history |
| 1.2 | Print mode | `core/02-print.test.ts` | --json NDJSON, error piping, exit codes, model override, empty prompt |
| 1.3 | JSON stream | `core/03-json-stream.test.ts` | Newline-delimited format, partial chunks, pipeable, malformed output |
| 1.4 | RPC server | `core/04-rpc.test.ts` | JSON-RPC 2.0 request/response, method not found, invalid JSON, concurrent |
| 1.5 | Debug mode | `core/05-dap-launch.test.ts` | --debug flag, DAP server start, breakpoints |
| 1.6 | Background sessions | `core/06-bg.test.ts` | --bg spawn, --bg-list, --bg-kill, --bg-kill-all, socket leak (DAP known bug) |
| 1.7 | Session management | `core/07-session.test.ts` | create, --resume, --continue, --fork, branch ID conflict |
| 1.8 | Model override | `core/08-model-override.test.ts` | --model id, --model full-id, missing model, fallback |
| 1.9 | **Context compression** | `core/09-compress.ts` | ✅ Priority #1 - DONE BELOW |

### §2 Multi-Provider Gateway — 8 features
| # | Feature | File pattern | Cases |
|---|---|---|---|
| 2.1 | 8+ providers | `gateway/01-providers.test.ts` | OpenAI/Anthropic/Google/DeepSeek/Groq/Mistral/xAI/OpenRouter load, BYOK custom, Ollama local |
| 2.2 | Provider discovery | `gateway/02-discovery.test.ts` | scanProviders, ~/.mya/providers/*.json, node_modules/@mya/provider-*, isProviderConfigured |
| 2.3 | OAuth flow | `gateway/03-oauth.test.ts` | Device-code, authorization-code, refresh, expired, missing client_id |
| 2.4 | MCP OAuth | `gateway/04-mcp-oauth.test.ts` | PKCE generation, code_verifier, callback, token exchange |
| 2.5 | Fallback chain | `gateway/05-fallback.test.ts` | Order, SKIP auth-tainted, SKIP quota-tainted, max attempts |
| 2.6 | Auth/quota taint | `gateway/06-taint.test.ts` | Mark taint on 401/429, no-reuse in session, TTL |
| 2.7 | Provider registry | `gateway/07-registry.test.ts` | Ordered, eligible(), priority, profile lifecycle |
| 2.8 | Web dashboard | `gateway/08-serve.test.ts` | `mya serve --port`, HTTP routes, WS connect, CORS |

### §3 Tools System — 32 tools
| # | Feature | File pattern | Cases |
|---|---|---|---|
| 3a.1-7 | read/write/edit/bash/glob/grep/ls | `tools/file/` (7 files) | Basic, large file, offset/limit, multi-edit, mkdir -p, encoding |
| 3b.1-9 | web_search/fetch/extract/browser_* | `tools/web/` (existing 849 tests) | SSRF G1-G7, Camofox |
| 3c.1-4 | codegraph/lsp/code/screen | `tools/code/` (4 files) | LSP symbol, code callback, screen capture |
| 3d.1-2 | osv_check, check_url_safety | `tools/security/` (2 files) | CVE API, Google Safe Browsing |
| 3e.1-7 | image_gen/video_gen/kanban/disk_cleanup/cron_* | `tools/generation/` (7 files) | DALL-E, Replicate polling, kanban CRUD, cron agent tools |

### §4 Memory System — 5+ features
- ingest, store, lifecycle, retrieve, persist (5 layers)
- Plus: dream_cycle, roles, embeddings, weibull, graph, learning_graph, markdown_backend, brain_store, domains (9)
- Plus Hermes: CJK tokenizer, FTS query routing, REINDEX, external-content (4)
= **18 features**

### §5 Cron System — 14 features
agent jobs, shell jobs, catch-up, grace, lifecycle guard, lock, tools, per-job sessions, delivery, skills, context_from, silent, security, observability, declarative config = **15 features**

### §6 Channels — 12 adapters + extras
Telegram, Discord, Slack, Email, Webhook, WhatsApp, Signal, Matrix, MSGraph, Feishu, WeChat, Spotify + aliases + inbound + outbound + rate limit + media cache + scanInject = **18 features**

### §7 Skills — 6 features
50 skills, curator, injection, store, search, per-job

### §7a Kanban (Upgraded) — 8 features
SQLite, 8 tools, DAG, atomic claim, notifications, JSON migration, WAL checkpoint, REINDEX

### §8 Subagents — 7 features
subagents, budget, maxSpawnDepth, maxToolRounds, council, workflows, collab, pool

### §9 Security & Auth — 13 features
wsToken, CSRF, WebAuthn, pairing, secrets, audit, scanner, permission, approval-relay, web guard, x402, redact, threat-scan

### §10 Desktop App — 4 features
Tauri shell, dashboard UI, capabilities, tray

### §11 Launcher (TUI) — 6 features
Tab nav, cron tab, channels tab, providers tab, status tab, inline wizards

### §12 Web Dashboard — 18 features
PWA, push, sessions, transcript, mobile, dashboard, profiles, skill editor, auth widget, webhooks, pairing UI, terminal, console, tooltip, charms, pets, achievements, strikethrough

### §13 Sync & Collab — 4 features
State sync, collab rooms, pool tree, A2A

### §14 Eval & Observability — 5 features
Drift eval, tier eval, telemetry, audit, heartbeat

### §15 MCP — 6 features
Client, lifecycle, config, reliability, OAuth, classification

### §16 TTS — 3 features
MLX/Kokoro, model manager, channels

### §17 x402 — 3 features
ECDSA wallet, x402 protocol, balance

### §18 DAP — 4 features
DAP server, client, breakpoints, launch

### §19 Voice — 5 features
PTT, STT backends, TTS backends, voice call, typed events

### §20 System / OS — 5 features
Systemd, watchdog, scale-to-zero, supervisor, cgroup

### §21 Gamification — 4 features
Achievements, pets/petdex, sprites, Spotify

### §22 P0 Spec Compliance — 13 fixes

### §23 Provider Discovery — 5 features

---

**Total: ~150 features → ~150 test files → với smoke/real/system/TUI → ~750 test cases planned**

## Implementation Status

| # | Group | Unit | Smoke | Real | System | TUI | Status |
|---|-------|------|-------|------|--------|-----|--------|
| 1 | Core Agent | ✅ | 🔨 | 🔨 | 🔨 | 🔨 | Started |
| 2 | Providers | | | | | | Planned |
| 3 | Tools | | | | | | Planned |
| ... | ... | ... | ... | ... | ... | ... | ... |

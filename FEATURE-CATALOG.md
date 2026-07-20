# mya — Feature Catalog

> Bản tổng hợp tất cả tính năng hiện có của mya.
> Cập nhật: 2026-07-20. Phiên bản build: cron hardening complete (commit `9c35bd9`).

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

## 2. Multi-Provider Gateway

| Tính năng | Mô tả |
|---|---|
| **8 providers** | OpenAI, Anthropic, Google, DeepSeek, Groq, Mistral, xAI, OpenRouter (+ custom/BYOK, Ollama local) |
| **OAuth flow** | Device-code + authorization-code flow cho providers hỗ trợ |
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
| `codeexec` | Code execution sandbox |
| `screen` | Screen capture (desktop) |

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
- **Domains** — conversations, goals, queue, sources, tools, tree, entities, search, sync, diff

**CLI**: `mya memory` (via extension hooks)

## 5. Cron System (hardened, production-ready)

Đầy đủ tài liệu tại `docs/cron-system-reference.md`.

| Tính năng | Mô tả |
|---|---|
| **Agent jobs** | Lên lịch LLM agent turns (cron / interval / one-shot) |
| **Shell jobs** | `MYA_CRON_ALLOW_SHELL=1` — chạy shell command (execFile async) |
| **Catch-up** | Missed-job recovery (fire-once + advance, at-most-once) |
| **Per-job sessions** | `_cron:<jobId>` isolation, concurrency cap (4) |
| **Multi-platform delivery** | 8 channels: Telegram, Discord, Slack, Email, Webhook, WhatsApp, Signal, Matrix |
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
| **8 adapters** | Telegram, Discord, Slack, Email, Webhook, WhatsApp, Signal, Matrix |
| **Aliases** | Nhiều instance cùng loại (vd: 2 Telegram bot) |
| **Inbound** | Nhận message từ channel → agent turn |
| **Outbound** | Agent response → channel delivery |
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

## 8. Subagents & Multi-Agent

| Tính năng | Mô tả |
|---|---|
| **Subagents** | Spawn worker agents (isolation, mergeback) |
| **Council** | Multi-model adversarial (3+ advisors khi ≥2 providers) — Skeptic/Pragmatist/Critic pattern |
| **Workflows** | Multi-phase orchestration (planner → executor → verifier) |
| **Collab** | Real-time collaboration rooms (WebSocket relay) |
| **Agent pool** | Connection pooling (AgentPool), per-session isolation |

## 9. Security & Auth

| Tính năng | Mô tả |
|---|---|
| **wsToken** | Bearer header + HttpOnly SameSite=Strict cookie |
| **CSRF** | Origin-exact check (same-port) |
| **WebAuthn** | `/auth/webauthn/{challenge,status,verify}` — passwordless device auth |
| **Pairing** | `/pair/{request,accept,devices}` — device pairing flow |
| **Secrets store** | Encrypted secret management (`~/.mya/agent/secrets`) |
| **Audit log** | Durable audit trail (`mya audit-log`) |
| **Context scanner** | Pre-turn security scan (secrets/injection in context) |
| **Permission system** | Tool-level permission review (7-tier) |

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
| **Push notifications** | `/push/{subscribe,unsubscribe,vapid-key}` |
| **Session list** | Xem/kết nối agent sessions |
| **Live transcript** | Real-time streaming qua WebSocket |
| **Mobile nav** | Responsive mobile navigation |
| **Dashboard** | Stats, memory, provider overview |

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
| **MCP lifecycle** | Auto-discover, register, health-check |
| **Config** | `~/.mya/agent/mcp.json` — server configs |

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

## Test Coverage

| Package | Test files | Ghi chú |
|---|---|---|
| `tools` | 41 | Web (849 tests), permission, repair |
| `memory` | 21 | SQLite, embeddings, domains, RRF |
| `print` | 13 | Cron integration, observability, role |
| `gateway` | 12 | Auth, cron-sweep, MCP, voice, webauthn |
| `cron` | 5 | Catch-up, security, store, scan |
| `core` | 6 | Budget, cost, loop, session, spill, telemetry |
| `web` | 4 | Build, dashboard |
| `eval` | 2 | Egress, tier |
| `ai` | 3 | Fallback, index, registry |
| `skills` | 1 | Curator |
| **Total** | **~108** test files |

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

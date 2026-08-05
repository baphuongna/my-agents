# mya — Tài liệu Kiến trúc Chi tiết

> Cập nhật: 2026-08-05 · Commit `d0efe085e` · 30 packages · ~83k LOC TS + ~1.2k LOC Rust · 6810 tests

---

## 1. mya là gì?

**mya** là một **unified coding/autonomous agent** — một trợ lý AI có thể:
- Đọc, viết, sửa code (TypeScript 7 + Rust)
- Chạy lệnh shell, tìm file, grep code
- Duy trì bộ nhớ dài hạn (5-layer memory pipeline)
- Làm việc qua nhiều giao diện: TUI terminal, web dashboard, API, cron, channels
- Quản lý nhiều agent song song (subagent spawning, role-based)
- Thanh toán micropayment (x402), audit Merkle log, memory graph

**Không phải** chatbot thuần. mya là một **hệ thống agent hoàn chỉnh** với tool execution, memory pipeline, permission gate, audit log, và multi-transport delivery.

---

## 2. Stack Kỹ thuật

| Layer | Công nghệ |
|---|---|
| Ngôn ngữ | TypeScript 7.0.2 (strict + `noUncheckedIndexedAccess`) + Rust (napi-rs) |
| Module | ESM (`import ... from "./x.js"`) |
| Runtime | Node.js ≥20 |
| Build | `tsc -b` (project references) + esbuild (bundle) |
| Test | Vitest (`pool: forks`) — 6810 tests / 520 files |
| Native | Rust cdylib qua napi-rs: BLAKE3 hash, glob/grep, tree-sitter AST, Rhai scripting |
| Desktop | Tauri 2 (Rust shell wrapping web SPA) |
| Lint | Custom lint scripts: invariant #10 (no `Date.now()` ngoài core.time), deps, core-size |
| CI | GitHub Actions: ubuntu-latest — build + bundle + lint + typecheck + test + eval + clippy + cargo-deny |

---

## 3. Kiến trúc Tổng thể

```
┌─────────────────────────────────────────────────────────────────────┐
│                         TRANSPORT LAYER                             │
│  TUI (pi InteractiveMode)  ·  Web Dashboard (React 19)             │
│  CLI one-shot (--print)   ·  JSON-RPC (--rpc)                       │
│  Gateway HTTP/WS (serve)  ·  Cron  ·  Channels (WA/Matrix/Signal)   │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │   createAgent()     │  ← packages/agent
                    │   (assembly point)  │
                    └──────────┬──────────┘
                               │
          ┌────────────────────┼────────────────────┐
          │                    │                     │
   ┌──────▼──────┐    ┌────────▼────────┐   ┌───────▼───────┐
   │  runTurn()  │    │   Memory        │   │   Tools (26)  │
   │  (FSM loop) │    │   Brain+RRF     │   │   dispatch    │
   │  core/loop  │    │   DreamCycle    │   │   permission  │
   └──────┬──────┘    │   14 domains    │   │   repair      │
          │           └─────────────────┘   └───────────────┘
   ┌──────▼──────┐
   │  Provider   │  ← packages/ai
   │  Registry   │
   │  Fallback   │
   │  38 models  │
   └─────────────┘
```

### Hai đường agent:

| Đường | Khi nào | Cách hoạt động |
|---|---|---|
| **Print mode** | `mya "prompt"` / `mya --print` | `createAgent()` → `agent.run()` → `runTurn()` trực tiếp |
| **Serve mode** | `mya serve` (gateway) | `RuntimePool` + `PiInProcessRuntime` → pi session → `runTurn()` |

Cả hai đều dùng cùng `runTurn()` FSM và cùng tool/memory/provider infrastructure.

---

## 4. 30 Packages — Chi tiết

### Tier 1: Core Engine (3 packages)

#### `@my-agent/core` (3,365 LOC)
**Frozen minimal core** — SSOT types, turn loop, budget, session, time.
- `loop.ts` — `runTurn()` FSM: bounded retry (3 attempts), tool-exec loop (25 rounds default), budget gate, idle-compaction, telemetry spans
- `types.ts` — discriminated unions: `ToolResult`, `RuntimeEvent`, `ProviderProfile`
- `time.ts` — `nowWallclock()` — **duy nhất** nguồn wallclock (invariant #10)
- `iteration-budget.ts` — per-subagent tool round cap (Hermes delegation.max_iterations)
- `runtime-spi.ts` — Service Provider Interface cho runtime abstraction
- `canonical-json.ts` — byte-faithful JSON serialization
- `session.ts`, `budget.ts`, `roles.ts`, `redact.ts`, `threat-scan.ts`

#### `@my-agent/agent` (Assembly point)
`createAgent()` — hội tụ mọi thứ:
```
createAgent({
  model, memory, tools, audit, skills, hooks,
  maxToolRounds, maxSpawnDepth, maxSubagentToolRounds,
  hindsight, dapConnect, checkIdleOnTurnStart
})
→ { prompt, run, spawnSubagent, ... }
```
- `run(text, sink)` → `runLive()` → `startTurn()` → `runTurn({stream, tools, memory, ...})`
- `spawnSubagent(goal, role)` → role-subagent spawning (via gateway pool)
- 30+ call sites: `main.ts`, `cli.ts`, `bg-runner.ts`, `mya-native.ts`, tests

#### `@my-agent/ai` (Provider abstraction)
- `ProviderRegistry` — ordered profiles, taint system (auth/quota/rate_limited/network/unhealthy), cooldown expiry
- `OpenAIAdapter` — real `fetch()` SSE streaming, error classification
- `streamWithFallback` — tries profiles in order, taints failures, returns first OK or `AllProvidersDegraded`
- `KeyRouter` — API key rotation
- `SmartRouterImpl` — keyword + cost scoring → model routing
- OAuth PKCE cho provider authentication
- 38 providers auto-detected: OpenAI, Anthropic, Google, MiniMax, DeepSeek, Qwen, Ollama, v.v.

### Tier 2: Action Layer (2 packages)

#### `@my-agent/tools` (16,444 LOC — lớn nhất)
**26 tool implementations** — khả năng hành động của agent:

| Nhóm | Tools | Chi tiết |
|---|---|---|
| **Filesystem** | `read`, `write`, `edit`, `replace` | Hashline anchoring, exact-text replace |
| **Shell** | `bash` | Real `spawn("/bin/bash")`, secret-env filtering, timeout/kill |
| **Search** | `glob`, `grep`, `ls`, `find` | Rust native (`nativeGlob`/`nativeGrep`) + JS fallback |
| **Code Intelligence** | `codegraph`, `symbol-extractor`, LSP | Tree-sitter AST (Rust), import graph, reference graph |
| **Web** | `fetch`, `browser` (8 tools), `search` (6 providers) | SSRF guard (per-hop DNS), Brave/DDG/Exa/Firecrawl/SearXNG/Tavily |
| **Security** | `osv-check`, `url-safety`, `path-safety` | OSV API, Google Safe Browsing, symlink-escape checks |
| **Screen** | `screenCapture`, `screenFind` | Platform capture + OCR (tesseract.js) |
| **Kanban** | `kanban`, `kanban-sqlite` | JSON + SQLite DAG (7-table schema) |
| **Media** | `image-gen`, `video-gen` | DALL-E/Stability/Replicate (ghi file) |

Cơ chế:
- `dispatch.ts` — `runTool()`: alias resolution → permission check → human approval → `impl.run()` → audit log
- `runToolBatch()` — parallel/sequential split, repair malformed calls, DegradedResult
- `permission.ts` — deny → mode-rank → human approval (trust boundary)
- `repair.ts` — auto-fix malformed tool calls

#### `@my-agent/memory` (9,182 LOC)
**5-layer memory pipeline**: INGEST → STORE → LIFECYCLE → RETRIEVE → PERSIST

| Component | Vai trò |
|---|---|
| **Brain** | Fact/take/page store — 10+ phases: record, consolidate (≥3 facts/bucket, ≥0.85 cosine), purge (soft-delete 72h recovery), backlinks, embed, lint |
| **RRF** (Reciprocal Rank Fusion) | 4-arm fusion: BM25 + substring + vector (char-n-gram TF-IDF) + graph (BFS hop-distance), k=60 |
| **DreamCycle** | Background consolidation (4h default) — facts → takes via LLM hoặc zero-LLM digest |
| **TypedGraph** | Knowledge graph — entities + relations, BFS query, backlinks ingestion |
| **MemoryTree** | 3-tier: L0 (events, 24h TTL) → L1 (takes) → L2 (pages, cosine ≥0.85) |
| **SQLite Store** | WAL mode, FTS5, reentrant transactions (SQLITE_BUSY retry), 0o600 perms |
| **Embeddings** | fastembed/ONNX trong worker_thread — 3 models (bge-small-en/zh, MiniLM) |
| **14 Domains** | archivist, tree, diff, goals, sync, graph, conversations, search, sources, entities, store, tools, queue, types |

### Tier 3: Delivery Layer (3 packages)

#### `@my-agent/print` (10,917 LOC)
**CLI + TUI entry point** — `bin: { mya, my-agent }`

| Mode | Lệnh | Mô tả |
|---|---|---|
| Interactive TUI | `mya` | pi InteractiveMode — full terminal UI |
| One-shot | `mya "prompt"` / `mya --print "prompt"` | Tạo agent → run → exit |
| JSON stream | `mya --json "prompt"` | Newline-delimited JSON output |
| RPC server | `mya --rpc` | JSON-RPC 2.0 over stdio |
| Web server | `mya serve [--port N]` | Gateway HTTP/WS + web dashboard |
| Launcher | `mya launcher` | Session picker TUI |
| Agents panel | `mya agents` | Subagent tree view |
| Cron CLI | `mya cron {list\|add\|remove\|...}` | Cron job management |
| Channels CLI | `mya channels {list\|test\|add}` | Channel management |
| Background | `mya --bg [--bg-id ID]` | Background session (TCP RPC) |

Key files:
- `main.ts` — mode dispatch, RuntimePool wiring (serve path)
- `pi-main.ts` — `runPiInteractive()` — lazy loads pi, injects mya-bridge extension
- `mya-bridge.ts` — bridge giữa pi và mya: roles, skills, audit, memory, cron, channels, status reporting
- `runtimes/` — RuntimePool, PiInProcessRuntime, SmartRouter, CostTracker, MemoryEnricher
- `view/` — backends: herdr, tmux, cmux, zellij, screen, standalone, run
- `skill-search/` — on-demand skill discovery (thay vì inject-all)

#### `@my-agent/gateway` (2,264 LOC)
**HTTP + WebSocket server** — raw `http.createServer` (không Express):
- 62 HTTP routes + 2 WebSocket endpoints (`/events`, `/api/console`)
- Auth: wsToken via Bearer + HttpOnly SameSite=Strict cookie, Origin/CSRF enforcement
- Wiring: RuntimePool callbacks (acquire/kill/prompt/tree), cron sweep, channel polling
- Readiness probes (`/health/live`, `/ready`, `/functional`)
- Web Push (VAPID RFC 8291/7519), WebAuthn, device pairing
- Cron sweep timer (default deny mode — read-only tools only)

#### `@my-agent/web` (13,760 LOC)
**React 19 SPA dashboard** — 39 pages:
- ChatPage (WebSocket streaming), Sessions, Status, Cron, Channels, Config
- Models, Skills, Tools, MCP, Memory, Analytics, Events, Logs, Files
- Collab, Sync, Pairing, Push, Webhooks, Achievements, Pets
- API client: cookie auth, 15s timeout, profile-scoping
- i18n: 9 ngôn ngữ
- PWA: service worker, push notifications
- xterm.js terminal (live `/api/console` WS)

### Tier 4: Infrastructure (10 packages)

| Package | LOC | Mô tả |
|---|---|---|
| `@my-agent/audit` | — | **Merkle append-only audit log** — SHA-256 hash-chain, checkpoint mỗi 100 records, verify, trust scoring, achievements/gamification |
| `@my-agent/cron` | — | **Cron scheduler** — atomic CAS claim, TTL lease, sweep crashed workers, lifecycle guard (flapping detection), grace windows, catchup |
| `@my-agent/channels` | — | **Multi-platform adapters** — WhatsApp, Matrix, Signal. BaseChannelAdapter lifecycle, ack/retry exponential backoff. Cần host inject transport (Baileys/matrix-bot-sdk) |
| `@my-agent/collab` | — | **Collaboration relay** — in-memory event bus, per-room authz (owner RW / guest RO / guest-approval), snapshot ring buffer |
| `@my-agent/sync` | — | **Multi-agent shared-state** — Hybrid Logical Clocks (HLC), last-writer-wins, server-authoritative push/pull |
| `@my-agent/rpc` | — | **JSON-RPC 2.0** over stdio — methods: prompt/cancel/status/heartbeat, streaming turn events |
| `@my-agent/prompts` | 2,066 | **3-tier prompt system** — assemblePrompt (memoized), injection scanner, DriftGrader, compressors (window/summarize/native/ranked) |
| `@my-agent/secrets` | 1,099 | **Secret lifecycle** — SecretRef (env/file/exec/keyring), in-process SecretStore, redactor, DevicePairing + WebAuthn |
| `@my-agent/skills` | 467 | **Skill store + curator** — SkillStore CRUD, curator logic (stale detection, pruning) |
| `@my-agent/eval` | 547 | **Parity harness** — UNIT/INTEGRATION/CREDENTIALED tiers, egress guard, drift grading |

### Tier 5: Specialized (7 packages)

| Package | LOC | Mô tả |
|---|---|---|
| `@my-agent/intercom` | 6,575 | **IDE bridge** — VS Code extension, broker auto-spawn, overlay UI (compose/inline-message/session-list), format-context, reply-tracker |
| `@my-agent/x402` | 695 | **Micropayments** — ECDSA secp256k1, HTTP 402 Payment-Required, X402Client (fetch + auto-402), `paidFetch` tool |
| `@my-agent/tts` | 749 | **Text-to-speech** — macOS (`say`/MLX), Linux (espeak/festival/pico2wave), fail-open |
| `@my-agent/dap` | — | **Debug Adapter Protocol** — stdio/TCP JSON-RPC, launch/attach, breakpoints, stack/scopes/variables, `makeDebugTool` |
| `@my-agent/dap-server` | 207 | Minimal DAP server (testing) |
| `@my-agent/desktop` | 162 | **Tauri 2 contracts** — deep-link `myagent://`, typed IPC, updater sigstore |
| `@my-agent/workflows` | 505 | **Sandboxed workflow runner** — Node `vm` sandbox, Rhai scripting (Rust) |

### Tier 6: Native + Build (3 packages)

| Package | Mô tả |
|---|---|
| `@my-agent/natives` | **Rust bridge** — BLAKE3 hash, glob/grep (walkdir + globset + regex), tree-sitter AST, Rhai eval, wallclock. JS fallback khi `.node` vắng |
| `@my-agent/pkg` | **Extension host** — extensions/skills/prompt-templates/themes, install→verify(apiVersion+signature)→register→activate |
| `@my-agent/signing` | **Package provenance** — sigstore sign/verify tarball digests |

---

## 5. Rust Engine

Hai crate dưới `crates/`:

### `my-agent-natives` (napi-rs cdylib, ~520 LOC)
| Function | Gate justification | Chi tiết |
|---|---|---|
| `hash_content` | Trust boundary | BLAKE3 hash |
| `blake3_mac` | Trust boundary | x402 signing MAC |
| `glob` / `grep` | Hot inner loop (>100k files) | walkdir + globset + regex |
| `now_wallclock` / `now_monotonic` | Determinism | Platform parity |
| `parse_ts_symbols` | Hot inner loop | tree-sitter AST symbol extraction |
| `eval_rhai` | Determinism | Rhai scripting engine |

Mỗi entry wrapped trong `catch_unwind` — panic không bao giờ kill process. Binary: `natives.linux-x64-gnu.node` (70 MB).

### `my-agent-desktop-shell` (Tauri 2, ~540 LOC)
- Tray icon, window management
- `myagent://` deep-link scheme
- Single-instance guard
- Sidecar lifecycle cho `mya serve` (spawn/readiness-poll/shutdown)

---

## 6. Luồng Hoạt động Chi tiết

### 6.1. User gửi prompt → Agent phản hồi

```
User: "fix the bug in auth.ts"
  │
  ▼
Transport (TUI/CLI/Gateway/Web)
  │
  ├─[print mode]──► createAgent() → agent.run("fix the bug in auth.ts")
  │                                        │
  └─[serve mode]──► RuntimePool.acquire() → PiInProcessRuntime → piSession.prompt()
                         │
                         ▼
                    runTurn({                    ◄── core/loop.ts
                      stream: streamWithFallback(),
                      tools: ToolRegistry,
                      memory: MemoryManager,
                      budget, maxToolRounds: 25
                    })
                         │
           ┌─────────────┼─────────────┐
           ▼             ▼              ▼
     Provider       Tool execution   Memory
     (LLM call)     (read/edit/bash) (record/recall)
           │             │              │
           └─────────────┼──────────────┘
                         │
                    Agent response
                    (text + tool results)
```

### 6.2. Tool execution flow

```
LLM output: { tool: "edit", input: { file: "auth.ts", oldText: "...", newText: "..." } }
  │
  ▼
dispatch.runTool()
  ├─ 1. Alias resolution
  ├─ 2. Permission check (mode-rank → human approval?)
  ├─ 3. impl.run(args) → ToolResult { ok, output }
  ├─ 4. Audit log (Merkle append)
  └─ 5. Return to LLM for next turn
```

### 6.3. Memory pipeline

```
Agent turn:
  ├─ INGEST: autoCapture() extracts facts from user prompt + assistant response
  ├─ STORE: Brain.recordFact() — content-cap guard (4096 chars, 10k cap)
  ├─ LIFECYCLE: 
  │    ├─ L0 (events, 24h TTL)
  │    ├─ L0→L1: Brain.consolidate() (≥3 facts, ≥0.85 cosine → take)
  │    └─ L1→L2: MemoryTree.compile() (cosine clustering → page)
  ├─ RETRIEVE: 
  │    ├─ SearchDomain.recall() → RRF (BM25 + substring + vector + graph)
  │    └─ 14 domains fan-out
  └─ PERSIST: SQLite (WAL, FTS5) hoặc JSONL fallback

Background:
  └─ DreamCycle (4h): facts → takes (LLM or zero-LLM digest)
```

### 6.4. Subagent spawning (role-based)

```
Parent agent: "refactor the auth module"
  │
  ▼
spawnSubagent(role="coder", task="refactor auth")
  │
  ├─ 1. Gateway: POST /pool/acquire {role, task, parentSessionId} → childSid
  ├─ 2. View backend: herdrBackend.open({command: ["mya", "--gateway-session", childSid, ...]})
  ├─ 3. Herdr pane: split → run → subagent boots
  ├─ 4. Subagent: pi InteractiveMode + mya-bridge
  │    ├─ session_start → auto-inject task as first prompt
  │    ├─ turn_start → reportSubagentStatus("working")
  │    ├─ LLM call → tool execution → response
  │    └─ agent_settled → reportSubagentStatus("done")
  └─ 5. Parent: /pool/tree shows child status progression
```

---

## 7. Bảo mật

| Layer | Cơ chế |
|---|---|
| **Permission gate** | `requiredMode`: `AutoApprove` / `Prompt` / `WorkspaceWrite` / `DangerFullAccess` — deny → mode-rank → human approval |
| **Audit log** | Merkle SHA-256 hash-chain — mọi tool call + result + approval + repair đều ghi lại, tamper-evident |
| **Secret management** | SecretRef discriminated union (env/file/exec/keyring), redactor, fail-closed resolution |
| **SSRF guard** | Per-hop DNS resolution, private-IP blocking, TOCTOU-aware metadata floor |
| **Path safety** | Lexical write resolver + canonical read resolver (symlink-escape checks). *Lưu ý: containment disabled cho pi-core parity — permission gate là control duy nhất* |
| **Gateway auth** | wsToken (Bearer + HttpOnly SameSite=Strict cookie), Origin/CSWSH enforcement, loopback-only bind |
| **Cron safety** | Default deny mode (read-only tools only), runtime-flip via `POST /cron/approval-mode` |
| **Package provenance** | sigstore sign/verify, npm provenance attestation |

---

## 8. Trạng thái Hiện tại

### Tests
```
Test Files:  520 passed (520)
Tests:       6810 passed | 8 skipped (6818)
Failures:    0
```

### CI
```
GitHub Actions (ubuntu-latest):
  ✓ Build (tsc -b)
  ✓ Bundle (esbuild)
  ✓ Lint (invariant #10, deps, core-size)
  ✓ Typecheck (30 packages)
  ✓ Test (6810 tests)
  ✓ Eval
  ✓ Clippy
  ✓ Cargo deny
```

### Đã verify E2E
- ✅ Gateway: health, readiness, status (38 providers, 4 roles, 50 cron jobs)
- ✅ Session lifecycle: create, acquire, prompt, kill
- ✅ Subagent spawning: acquire → spawn → "done" (3s direct, 22s via herdr pane)
- ✅ MCP integration: 4 servers, 39 tools discovered
- ✅ Memory: DreamCycle running, facts/takes/pages, SQLite persistence
- ✅ Models: 38 models available (OpenAI, Anthropic, Google, MiniMax, DeepSeek, Qwen, Ollama...)
- ✅ herdr pane E2E: split → run → subagent → status report

### Known design choices (không phải bugs)
1. **Channels cần injected transports** — WhatsApp/Matrix adapter logic real, nhưng host inject Baileys/matrix-bot-sdk (DI pattern)
2. **Dual memory paths** — Brain+Domains (active) và SqliteMemoryManager (complete, migration dần)
3. **Path containment disabled** — pi-core parity, permission gate là control duy nhất
4. **Gateway 2264 LOC** — further split rủi ro cao, để nguyên

---

## 9. Hệ sinh thái xung quanh

### `source/` (~40 vendored projects — reference only)
pi, pi-ai, pi-agent-core, pi-coding-agent, pi-tui, pi-intercom, herdr (Rust terminal multiplexer), hermes-agent, mem0, harness, mya-v1, v.v.

### `docs/` (~50 markdown files)
Architecture, analysis, design specs, port plans, memory deep-dives, test coverage, security audits, SSSF/contrabass analysis.

### Skills (~20 markdown skills)
loop-review, mya-testing, pi-fork-sync, code-optimizer, lint, review, security-review, tdd, test, verify-before-complete, v.v.

---

## 10. Tóm tắt

**mya** là một hệ thống autonomous agent production-grade với:
- **30 packages** TypeScript + **2 Rust crates**, ~83k LOC source + ~84k LOC tests
- **6810 tests** pass, **0 failures**
- **26 tools** thực (không stub)
- **5-layer memory** pipeline với RRF, DreamCycle, TypedGraph, SQLite
- **38 LLM providers** auto-detected
- **6 transport modes**: TUI, CLI, JSON-RPC, Gateway HTTP/WS, Web Dashboard, Background
- **Multi-agent**: role-based subagent spawning qua herdr panes
- **Bảo mật**: Merkle audit, permission gate, SSRF guard, secret management
- **CI xanh** trên ubuntu-latest (build + lint + test + clippy + cargo-deny)

> **Không phải prototype. Đây là hệ thống hoàn chỉnh, tested, production-ready.**

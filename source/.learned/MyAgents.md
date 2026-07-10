# MyAgents — Learnings for mya

> Studied 2026-07-08. Source: `/home/bom/source/my-agent/source/MyAgents` (TS + Rust desktop agent workbench, 1,285+ files, Apache-2.0).

## TL;DR (what it is, stack, why it matters)

**MyAgents** is a **Tauri v2 desktop AI Agent workbench** built on **Claude Agent SDK 0.3.201** (Node.js Sidecar per Session). It is **not a generic agent runtime**; it is a **product** that ships a Chrome-style multi-Tab workspace, file tree, embedded terminal/browser, thought-to-task state machine, multi-runtime support (builtin SDK + Claude Code CLI + Codex CLI + Gemini CLI), MCP (STDIO/HTTP/SSE), Skills, IM Bots (Telegram, Dingtalk, OpenClaw plugin bridge), cron, and a Mac/Windows native shell.

| Layer | Tech |
|---|---|
| Shell | Tauri v2 (Rust) |
| Frontend | React 19 + TS + Vite + TailwindCSS 4 |
| Backend | Node.js v24 bundle + Claude Agent SDK 0.3.201 (multi-instance Sidecar) |
| Transport | Rust HTTP/SSE Proxy (`reqwest` via `local_http`) + Node→Rust axum `management_api` reverse channel |
| Runtime | Claude Agent SDK + Claude Code CLI + Codex CLI + Gemini CLI (lab feature) |

**Why it matters for mya:**
1. The most **mature, multi-runtime, owner-based Sidecar model** — directly relevant to mya's Tool/Channel/Provider traits.
2. **"Pit-of-success" wrapper pattern** (helper modules that make the wrong call *uncompilable* via `clippy::disallowed_methods` + ESLint `no-restricted-imports` + `depcruise`) is novel and high-ROI.
3. **Pre-warm + persistent session with `while(true)` yield** is the closest production-quality analogue to mya's `RuntimeAdapter`/agent-loop ambitions.
4. **Workspace-file dual model** (lexical write / canonical read) is a clean answer to mya's sandbox/Merkle-audit concerns.

## Architecture overview (cite paths)

### Two-tier process topology
- **Tauri Rust** (`src-tauri/src/`): window, app state, IPC commands, Sidecar lifecycle, cron, workspace files, IM Bot adapters, proxy, updater, search.
- **Node.js Sidecar per Session** (`src/server/`): one Claude Agent SDK instance per Session; serves HTTP+SSE on a per-Tab port (base `31415`).

### Sidecar Owner model (`src-tauri/src/sidecar.rs` facade + `sidecar/*` modules)
- One Sidecar ⟺ one Session. Four `SidecarOwner` variants share it (`Tab`, `CronTask`, `BackgroundCompletion`, `Agent`). All owners release → Sidecar stops.
- `manager.rs` owns the `ManagedSidecars: HashMap<sessionId, SessionSidecar>` and port allocation.
- `session_lifecycle.rs` owns `ensure_session_sidecar` / `release` / `upgrade` / `activation`.
- `instances.rs` spawns global/tab sidecars, monitors them, wakes on turn.
- `spawn.rs` finds the bundled Node binary, normalizes Windows `\\?\` paths, and classifies immediate-exit / node-not-found diagnostics.
- `health.rs` does TCP health + readiness + reusable sidecar HTTP health check.

### Persistent session pattern (`src/server/builtin-session/lifecycle.ts`, `src/server/agent-session.ts`)
- `messageGenerator()` uses `while(true)` to keep SDK subprocess alive for the Session lifetime.
- Two abort paths: `abortPersistentSession()` (immediate interrupt) vs `scheduleDeferredRestart('mcp' | 'agents')` (debounced soft restart at next pre-warm).
- Sidecar config fingerprint (`mcpConfigFingerprint`) guards against TOCTOU between "check" and "ensure" (the cause of #300/#301 abort-loop).
- Pre-warm 500ms-debounced; Model changes don't trigger, MCP/Agents do.
- Wakeup via `wakeGenerator()` injects user messages into the persistent session.

### Multi-runtime via session-engine facade (`src/server/session-engine/`)
- `selector.ts` owns the **single** `shouldUseExternalRuntime()` decision point.
- `builtin-adapter.ts` delegates to `agent-session.ts`; `external-adapter.ts` delegates to `external-session.ts`.
- `route-contracts.ts` is a **testable high-risk route → engine method** map so route modules only shape payload/response.
- The facade files are not allowed to re-acquire mutable state — enforced by `runtime-boundary.unit.test.ts`.
- Pure policy layer in `src/server/session-core/` (turn-result policy, MCP authority/fingerprint, queue admission) — no SDK/SSE/FS side-effects.

### Communication patterns (`specs/ARCHITECTURE.md`)
- **Renderer→Rust→Node proxy** is mandatory for all WebView HTTP/SSE (bypasses CORS, lets Rust `.no_proxy()`).
- **SSE events** are namespaced `sse:${tabId}:${eventName}`. Whitelist in `SseConnection.ts::JSON_EVENTS` or events are silently dropped.
- **Last-value cache** for `chat:status` on reconnect.
- **session-scoped event guards** prevent historic session-stale events from being painted onto the current Tab during session birth/switch.
- **Management API** (`src-tauri/src/management_api.rs`): Rust axum server on loopback exposes `/api/cron/*` (9), `/api/task/*` (13), `/api/thought/*` (2), `/api/im/*`, `/api/im-bridge/*`, `/api/plugin/*` (3), `/api/agent/runtime-status`. Port injected to Sidecars via `MYAGENTS_MANAGEMENT_PORT` env.

### Workspace file IO (`src-tauri/src/workspace_files/`)
- **All workspace file ops go through Rust** (`cmd_workspace_*`); Sidecar never reads/writes files directly.
- **Dual-resolution chokepoint** (`path_safety.rs`):
  - `resolve_inside_workspace` (lexical, for writes): rejects `..` escape and absolute/driveletter components; doesn't require the file to exist.
  - `resolve_existing_inside_workspace` (canonicalize + prefix-check, for reads): defeats the "malicious repo with `evil_link → /etc/passwd` symlink" attack on read-only commands.
  - Both consult a shared `system_blacklist_check` (home/tmp prefix + credential blacklist).

## Notable patterns & techniques (Pattern → Why → How mya adopts)

1. **Pit-of-success wrappers** (`local_http::builder()`, `process_cmd::new()`, `proxy_config::apply_to_subprocess()`, `system_binary::find()`, `normalize_external_path()`, `tauri::async_runtime::spawn`). The wrong call becomes *uncompilable*: `clippy::disallowed_methods` / `clippy::disallowed-macros` list them as banned, with `#[allow(clippy::disallowed_methods)]` allowed only at the canonical helper's source. The companion `depcruise` config blocks cross-layer imports in TS/JS. → **mya could adopt this for `reqwest::Client::new()` (system proxy kills localhost), `std::process::Command::new()` (Windows console flash), `tokio::spawn` outside Tauri runtime (panics-across-FFI unwind on macOS), bare `which::which()` (PATH-missing-on-launch), and bare `serde_json` round-trips. Add `clippy.toml::disallowed_methods` with a single helper per concern. Quantified payoff documented per pit (`Pit-of-Success 红线总表`). mya's AGENTS.md already lists "forbidden patterns" — converting them to lint-enforced is the next step.**

2. **Sidecar Owner model with reference counting** (`src-tauri/src/sidecar/manager.rs`). Four `SidecarOwner` variants compete for Sidecar resources; only when the last owner releases does the process stop. → **mya doesn't currently model "who currently owns a Session" — `AgentHandle` could mirror this with a `Vec<Owner>` ref-count, especially useful when cron/IM/Bot share session state. Makes graceful teardown and overlap prevention *free* instead of racing.**

3. **Persistent session with `while(true)` yield** (`lifecycle.ts`). One SDK subprocess lives the Session lifetime; abort is a signal flag that interrupts and wakes the generator. Config changes route through `scheduleDeferredRestart` or `abortPersistentSession`; never mix. → **mya's agent-loop could borrow this to keep session "alive" across turns, eliminating cold-start cost on every tool call. The `wakeGenerator()` injection maps cleanly to mya's `SessionBackend`.**

4. **Pre-warm with debounced soft restart** (`schedulePreWarm` 500ms debounce + `scheduleDeferredRestart`). MCP/Agents config flip merges, delays actual restart to the next pre-warm window. → **mya currently has no equivalent. A small `deferred-restart.rs` latch could merge bursty config changes from CLI/cron/UI into one restart, eliminating the abort-loop pattern MyAgents calls out as #300/#301.**

5. **Dual resolution for workspace file safety** (`path_safety.rs` lexical write / canonical read + system blacklist). Mirrors mya's sandbox vision but splits responsibilities by mutation type. → **mya has `path_safety` already (good!) but should ensure the dual lexical/canonical distinction survives. Adopt MyAgents' pattern of *one* chokepoint module + multiple thin command-level entry points.**

6. **Token-based watcher handles** (`watcher.rs`). `WatchHandle { token, event_key }` survives workspace rename/recreate where the previous "re-derive key from path" stop logic leaked entries. `eventKey = siphash(workspace_path)`, deterministic per workspace; `token` is process-local monotonic. → **mya currently uses `path-based keys` in several places (gateway, audit logs, watcher). Convert to opaque issued-token semantics + a separate deterministic correlation key for telemetry. Prevents cross-restart token collision by prepending a per-process nonce.**

7. **Dependency-inversion `turn-hooks.ts` leaf slot** to break cycles between `agent-session` ↔ `session-title-service` ↔ `title-generator`. The runtime path depends on a *tiny* leaf (`firePostTurnTitleHook`); the service registers itself once at boot via `setPostTurnTitleHook`. → **mya's `Agent`/`Tool`/`Memory` modules may hit similar cycles. A small `slot`/`registry` pattern with set-once / fire-injection works broadly.**

8. **`management_api.rs` Node→Rust axum reverse channel on loopback**. Notifies Rust cron/IM of Node-side decisions without round-tripping through the renderer. → **mya's `mya-gateway` and `mya-runtime` already share HTTP; a tiny internal `mya-sidecar-control` axum for "Sidecar lifecycle events, plugin callbacks, runtime status" lets the runtime contract-test these routes in isolation. Use it as the basis for sandbox lifecycle.**

9. **`canSpawn` / `killWithEscalation` cross-platform pattern** (`spawn.rs::kill_process`). Unix: `SIGTERM` + `waitpid(WNOHANG)` polling thread → escalate to `SIGKILL` on the entire process group. Windows: `taskkill /T /F` (synchronous, no polling needed). → **mya's `process_cmd` could grow a `kill_with_escalation(child, timeout)` helper to replace bare `child.kill()` paths in `mya-tools/src/shell.rs` and `mya-hardware/src/serial.rs`. Solves both "process ignores SIGTERM" hangs and "child terminates SDK subprocess indirectly" leaks.**

10. **Test classification + no-egress guard** (`vitest.config.ts` four pools: `unit` / `dom` / `integration` / `credentialed`; `scripts/check-test-classification.mjs` enforces naming + non-overlapping include + network egress banning on non-credentialed projects). → **mya's eval/test harness (`mya-eval`) is already deterministic-replay — a similar `credentialed` vs `non-credentialed` split would protect CI from providers-required flakes; the `no-egress` guard is small to implement and high-ROI.**

11. **`maybeSpill` + `/refs/:id` + SSE priority queue** for payloads >256 KB (avoids OOM / UI freeze / slow-client-stalls-sidecar). → **mya's media attachment pipeline already does the right thing for binary; this same pattern applied to *text* payloads over 256 KB (long tool outputs, retrieval chunks, file dumps) prevents the same failure mode in `mya-runtime`'s SSE handler.**

## Top ideas worth adopting (prioritized)

1. **Promote mya's "forbidden patterns" to lint-enforced pit-of-success wrappers** (`local_http`, `process_cmd`, `proxy_config`, `system_binary`, `normalize_external_path` analogues). Single highest-ROI change: convert AGENTS.md prose into `clippy.toml::disallowed_methods` + ESLint `no-restricted-imports` + `depcruise` boundaries.
2. **Pre-warm + persistent session + Owner refcount for mya's agent loop** (`mya-runtime`). Replace per-turn cold-start with one long-lived agent process per session; introduce a `SessionOwner` set (Tab/Cron/Bot/Heartbeat) to make teardown concurrency-safe.
3. **Dual lexical/canonical workspace path resolver** as the *single* chokepoint before any sandbox/audit decision. Consolidate under one module and split readers/writers.
4. **Token-based watcher handles** for `mya-channels` media pipeline + `mya-runtime` file-watcher; replaces fragile path-key cleanup.
5. **Test classification (unit/dom/integration/credentialed) + no-egress guard** for `mya-eval`.

## Gotchas / anti-patterns

- **`messageGenerator()` for-ever with raw `shouldAbortSession = true`** → permanent deadlock; must use `abortPersistentSession()` (sets flag + wakes generator Promise gate + interrupts subprocess). mya should NOT mimic `while(true)` without an equivalent wake-or-abort contract.
- **Synced config fingerprint mismatch between concurrent creators** (Rust `ensure_session_sidecar` vs frontend `/api/mcp/set`) → silent 30s restart loop. Document the source of truth per scenario.
- **Bare `reqwest::Client::new()` anywhere near `127.0.0.1`** → 502 under common system-proxy configs (Clash/V2Ray). Ship `.no_proxy()` wrappers.
- **macOS `tokio::spawn` outside `tauri::async_runtime::spawn`** → startup-abort if a panic crosses an FFI boundary.
- **Per-task parse failures shouldn't bring down the whole cron store** → use a *raw value* → *per-entry* fallback parse path so a single corrupt entry only loses itself.
- **`watch_stop` keyed on a path string** while the path can be renamed/recreated between start/stop → entry leak. Use opaque issued tokens + a separate deterministic correlation key.
- **Sync `#[tauri::command] pub fn` doing >1-frame work** → macOS WKWebView UI thread freezes for the whole duration.
- **Cross-runtime silent empty turns** (`num_turns: 0`, false success marker on sessions that were never created). Gate on real turn success, not `waitForSessionIdle`.
- **Last-value SSE cache replay leaking across sessions** — guard with `sessionId` on snapshot-bearing events; whitelist via `JSON_EVENTS` or events are silently dropped.

## Key reference files
- **Architecture**: `specs/ARCHITECTURE.md` (核心抽象 / 通信模式 / 资源管理 / 模块地图).
- **Pit-of-success spec**: `specs/tech_docs/pit_of_success.md`.
- **Helper modules**: `src-tauri/src/{local_http,process_cmd,proxy_config,system_binary}.rs`.
- **Sidecar lifecycle**: `src-tauri/src/sidecar.rs` + `src-tauri/src/sidecar/{manager,session_lifecycle,instances,spawn,health,cleanup,shutdown,proxy,runtime_identity}.rs`.
- **Persistent session**: `src/server/builtin-session/lifecycle.ts`; facade `src/server/agent-session.ts`; engine `src/server/session-engine/*`; pure policy `src/server/session-core/*`.
- **External runtimes**: `src/server/runtimes/{factory,claude-code,codex,gemini,external-session}.ts`.
- **Workspace safety**: `src-tauri/src/workspace_files/{path_safety,watcher}.rs`.
- **Cron**: `src-tauri/src/cron_task/{manager,execution,schedule,delivery,init_recovery}.rs`.
- **IM adapters**: `src-tauri/src/im/{agent_channel,enqueue,event_consumer,reply_router,state}.rs` + `telegram.rs` / `dingtalk.rs` / `feishu.rs` / `bridge.rs`.
- **Management API (Node↔Rust)**: `src-tauri/src/management_api.rs`.
- **System prompt three-tier**: `src/server/system-prompt.ts`.
- **Test classification**: `vitest.config.ts` + `scripts/check-test-classification.mjs` + `src/test/setup-no-egress.ts`.

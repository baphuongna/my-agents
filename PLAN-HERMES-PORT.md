# PLAN: Port Hermes Agent Upgrades to mya

**Source**: `docs/hermes-deep-dive*.md` (3 rounds, 9 explorer agents, 364 commits analyzed)
**Verified**: Current mya codebase state confirmed against Hermes implementations
**Stack**: TS strict + ESM + napi-rs + Vitest(forks)

---

## Phase 0 — Security Foundation (P0, ~600 lines)

### 0.1 Redaction Engine → `packages/core/src/redact.ts`
- Port 43 API key prefix patterns (sk-, ghp_, github_pat_, gho/ghu/ghs/ghr_, xapp-, xox[baprs]-, AIza, pplx-, fal_, fc-, bb_live_, AKIA, sk_live_/sk_test_, SG., hf_, r8_, npm_, pypi-, dop_v1_, am_..., tvly-, exa_, gsk_, syt_, xai-, ntn_, fw-, fw_, fpk_)
- ENV assignment patterns (`KEY=value` where KEY matches secret-like names)
- JSON field patterns (`"apiKey":`, `"token":`, etc.)
- Auth headers (`Authorization: Bearer`, `x-api-key:`)
- PEM private keys, JWTs, DB connection strings
- URL bare tokens, Telegram bot tokens, E.164 phone numbers
- `force=true` for persistence boundaries (compaction, memory writes)
- `redactUrlCredentials=true` opt-in stricter pass
- Substring pre-check optimization (-68% latency)
- `_maskToken()`: first 6 + last 4, floor 18
- Non-reusable sentinels for file reads (`«redacted:ghp_…»`)
- **Tests**: `packages/core/src/redact.test.ts` — each pattern category

### 0.2 Prompt Injection Detection → `packages/core/src/threat-scan.ts`
- 3-tier scope: `"all"` (narrow) ⊂ `"context"` (default) ⊂ `"strict"` (broad)
- Classic injection patterns: `ignore previous instructions`, `system prompt override`
- Role-play/identity hijack: `you are now`, `pretend you are`, `name yourself`
- C2/Brainworm: `register as node`, `beacon to`, `cobalt strike/sliver/havoc`
- Exfiltration: `curl/wget $(KEY|TOKEN|SECRET)`, `cat .env/credentials`
- Persistence/SSH backdoor: `authorized_keys`, `$HOME/.ssh`, `update AGENTS.md`
- Unicode defense: strip 17 invisible chars (U+200B-D, U+2060, U+FEFF, etc.)
- NFKC normalization before regex
- MAX_SCAN_CHARS = 65536 cap
- Integrate at: context file scan, memory writes, skill installs
- **Tests**: `packages/core/src/threat-scan.test.ts` — each scope + Unicode

### 0.3 CJK Token Estimation → `packages/tools/src/output-compress.ts`
- Replace `Math.floor(text.length / 4)` with CJK-aware version
- ASCII fast path: `/^[\x00-\x7F]*$/.test(text)` → `(len + 3) >> 2`
- CJK dense counting: count chars in ranges U+1100-11FF, U+2E80-9FFF, U+AC00-D7AF, U+F900-FAFF, U+FF00-FFEF
- Mixed: `dense + ceil(sparse / 4)` where dense = 1 token/char
- Images: flat 1500 tokens
- **Tests**: update existing `output-compress.test.ts` + add CJK fixtures

---

## Phase 1 — MCP Reliability (P0, ~400 lines)

### 1.1 Failure Classification → `packages/gateway/src/mcp-client.ts`
```typescript
type McpFailureClass = "permanent" | "transient";
function classifyMcpFailure(err: unknown): McpFailureClass {
  // permanent: ENOENT, 401, 403, auth errors, invalid URL
  // transient: everything else
}
```

### 1.2 Reconnect Budget → `packages/gateway/src/mcp-client.ts`
- `_sessionProven: boolean = false` — fresh session unproven
- `_reconnectRetries: number = 0` — consecutive unproven reconnects
- Session "proves" itself via: successful tool call OR successful keepalive
- `_MAX_RECONNECT_RETRIES = 5` → park (deregister tools, self-probe 300s)
- `_PARKED_RETRY_INTERVAL = 300_000`
- `_BACKOFF_JITTER = 0.2` (±20%)
- Update `McpPhase` FSM: add `Parked` state

### 1.3 Per-Server Isolation Cooldown
- `_connectFailures: Map<string, number>` — consecutive failures per server
- `_connectRetryAfter: Map<string, number>` — monotonic deadline
- Backoff: `min(30 * 2^(n-1), 600)` seconds
- Register filter skips cooldown servers
- `shutdown()` clears all cooldown state

### 1.4 Keepalive Ping → `packages/gateway/src/mcp-client.ts`
- `_keepaliveInterval = 180_000` (configurable, min 5s)
- `_pingUnsupported: boolean = false` — latch to fall back to `tools/list`
- Probe: `send_ping()` with 30s timeout → on method-not-found → latch + use `tools/list`
- Keepalive success → `_markSessionProven()`
- Keepalive failure → trigger reconnect

### 1.5 Exception Group Unwrapping
- `_unwrapExceptionGroup(err)` — dig out real root cause from anyio-like nested errors
- Fatal leaves (KeyboardInterrupt/SystemExit equivalent) always re-raise
- Prefer non-cancellation leaves over AbortError noise

**Tests**: `packages/gateway/src/mcp-reliability.test.ts`

---

## Phase 2 — Context Compression Engine (P1, ~1200 lines)

### 2.1 Compression Config → `packages/core/src/types.ts`
```typescript
interface CompressionConfig {
  enabled: boolean;           // default true
  threshold: number;          // 0.50
  targetRatio: number;        // 0.20
  protectLastN: number;       // 20
  protectFirstN: number;      // 3
  maxAttempts: number;        // 3 (hard-capped 10)
  thresholdTokens: number | null;  // absolute cap, null = disabled
  idleCompactAfterSeconds: number; // 0 = disabled
  modelThresholds: Record<string, number>; // per-model overrides
}
```

### 2.2 Token Threshold Resolution → `packages/prompts/src/compress.ts`
- 4-layer chain: config → per-model (longest substring) → small-context floor (<512K → 75%) → compute (64K floor + 85% guard + maxTokens reservation)
- `resolveModelThreshold(model, thresholds, default)` — longest substring match
- `computeThresholdTokens(contextLength, thresholdPercent, maxTokens?)`

### 2.3 Idle Compaction Predicate → `packages/prompts/src/compress.ts`
```typescript
function shouldIdleCompact(opts: {
  enabled: boolean; idleAfterSeconds: number; idleGapSeconds: number;
  tokens: number; floorTokens: number; cooldownActive: boolean;
}): boolean
```
- Uses `core.time.nowWallclock()` for idle gap (invariant #10)
- Called in `loop.ts` turn prologue before preflight

### 2.4 Prune Old Tool Results → `packages/prompts/src/compress.ts`
- 3 passes (NO LLM):
  1. Dedup identical tool results (SHA-256 hash, >200 chars)
  2. Replace >200 char results with 1-line summary
  3. Truncate tool_calls args JSON >500 chars (parse + shrink + re-serialize)

### 2.5 Summary Generation → `packages/prompts/src/compress.ts`
- Structured template: Historical Task Snapshot, Goal, Constraints, Completed Actions, Active State, etc.
- Rolling update: feed previous summary back on re-compaction
- LLM call via auxiliary model (from CompressionConfig)
- Abort guard: auth/network failure → return unchanged
- Fallback: static template summary (no LLM)

### 2.6 Assembly + Role Selection
- Head protection (system + protectFirstN, decays after first compaction)
- Tail boundary (backward walk, soft ceiling = budget × 1.5)
- Role selection: avoid consecutive same-role + Anthropic user-first requirement
- Zero-user guard: force user if no user-role survives
- `SUMMARY_PREFIX` directive: "Respond ONLY to the latest user message"
- `_compressedSummary` metadata key (underscore = stripped on wire)

### 2.7 Anti-Thrashing
- `shouldCompress(tokens)` uses rough estimate for preflight
- Anti-thrashing verdict in `updateFromResponse(realTokens)` — provider-verified
- `_ineffectiveCompressionCount` increments when still over threshold after compaction
- `_summaryFailureCooldownUntil` (600s default)
- Block at: cooldown active, ineffective count ≥2, fallback streak ≥2

### 2.8 Strict Redaction at Boundaries
- All text entering/exiting summary → `redact(text, { force: true, urlCredentials: true })`
- Applied at: serialization input, summary output, previous summary, focus topic, memory context

### 2.9 Wire into loop.ts
- Replace stub `compressHistory` with actual engine
- Add idle compaction check in turn prologue
- Add preflight multi-pass compression loop

**Tests**: `packages/prompts/src/compress.test.ts` — idle predicate, threshold chain, prune passes, role selection, anti-thrashing

---

## Phase 3 — FTS5 Improvements (P1, ~300 lines)

### 3.1 CJK Bigram Tokenizer → napi-rs (`crates/natives/src/cjk_tokenizer.rs`)
- Port `cjk_is_cjk` (13 codepoint ranges)
- Port rolling `bounds[3]` bigram emission algorithm
- ASCII fast path (zero overhead for Latin)
- Lone CJK char → unigram
- Export: `tokenize(text: string) → Array<{token: string, start: number, end: number}>`
- Rust gate: trust boundary + hot inner loop + determinism ✅

### 3.2 External-Content FTS5 Schema Update → `packages/memory/src/sqlite-schema.ts`
- Current: `fts_working` uses inline content (not external-content)
- New: convert to external-content `content='working_memory', content_rowid='id'`
- Add tool-row-free trigram view (exclude tool output from trigram index)
- Add CJK bigram index table (when napi-rs tokenizer available)
- Marker-gated triggers for deferred rebuild

### 3.3 FTS Query Routing → `packages/memory/src/sqlite-recall.ts`
- Detect CJK in query → route to CJK bigram index
- Non-CJK → unicode61 FTS5
- Short CJK terms → LIKE fallback
- BM25 ranking with timestamp sort option

### 3.4 REINDEX Auto-Repair → `packages/memory/src/sqlite-manager.ts`
- `integrityCheck()` on open
- If "wrong # of entries in index" → `REINDEX`
- FTS5 read probe (`MATCH ''`)
- FTS5 runtime rebuild on DatabaseError

### 3.5 Slow-Query Log
- `MYA_SEARCH_SLOW_MS` env (default 1000ms)
- Log: `slow search: path={fts5|fts_cjk|like_scan} elapsed={ms}ms rows={n} query={q}`

**Tests**: `packages/memory/src/fts-cjk.test.ts`, `packages/memory/src/fts-repair.test.ts`

---

## Phase 4 — Gateway Hardening (P1, ~400 lines)

### 4.1 Stale Lock Detection → `packages/gateway/src/index.ts`
- PID existence check (`process.kill(pid, 0)`)
- Start-time fingerprint (best-effort on the platform)
- TTL check (120s)
- Tombstone rename: `fs.rename(lockPath, lockPath + '.stale')` → unlink
- Atomic: exactly one racer claims stale file

### 4.2 Hard-Exit Pattern → `packages/gateway/src/index.ts` / `packages/print/src/main.ts`
```typescript
function exitAfterGracefulShutdown(code: number): never {
  process.stdout.flush?.();
  process.stderr.flush?.();
  removePidFile();
  releaseRuntimeLock();
  drainLogQueue(1000); // bounded
  process.exit(code);  // Node: process.exit is hard-exit (no atexit in same way)
}
```
- Replace `process.exit(0)` calls with explicit lock release first
- Handle SIGINT/SIGTERM with bounded drain

### 4.3 Session Branch/Seed → `packages/core/src/session.ts`
- `parentSessionId` field on session
- 3 child types: branch (`_branchedFrom`), compression (`endReason='compression'`), delegate (`_delegateFrom`)
- Column inheritance: workspace columns for all children, routing for compression-only
- Compression tip walking (follow compression children)

### 4.4 Honest Durable Ack (for cron/async)
- Classify completion target: `terminal` (drop) / `retry` (release) / `deliver` (complete)
- Claim/complete/release/drop lifecycle
- Prevents pending-forever on permanently gone sessions

**Tests**: `packages/gateway/src/lock.test.ts`, `packages/core/src/session-branch.test.ts`

---

## Phase 5 — DDGS Process Isolation (P2, ~150 lines)

### 5.1 Disposable Worker → `packages/tools/src/web/search-worker.mjs`
- JSON over stdin/stdout protocol
- Request: `{"query": "...", "safeLimit": 5}`
- Response: `{"ok": true, "results": [...]}` or `{"ok": false, "error": "..."}`

### 5.2 Bounded Executor → `packages/tools/src/web/fetch.ts`
- Spawn child process with `detached: true` (own session)
- `communicate()` equivalent on side thread (Worker or child_process)
- Poll interrupt flag + 30s deadline at 100ms intervals
- Terminate: SIGTERM → 1s grace → SIGKILL
- `start_new_session` / `detached` for grandchild reap

**Tests**: `packages/tools/src/web/search-worker.test.ts`

---

## Phase 6 — MCP OAuth PKCE (P2, ~300 lines)

### 6.1 Token Storage → `packages/gateway/src/mcp-oauth.ts`
- `~/.mya/agent/mcp-tokens/<server>.json` (0600, atomic write)
- Access/refresh tokens with absolute expiry
- Client registration info
- OAuth server metadata

### 6.2 OAuth Flow
- Discovery: PRM → ASM from well-known endpoints
- Dynamic client registration (RFC 7591)
- PKCE: code verifier/challenge
- Authorization code flow: browser → localhost callback
- Token refresh: lazy before expiry

### 6.3 Cross-Process Reload
- Check file mtime before every auth flow
- Invalidate in-memory cache if disk changed

### 6.4 401 Deduplication
- N concurrent 401s → only one recovery fires
- All callers await same promise

**Tests**: `packages/gateway/src/mcp-oauth.test.ts`

---

## Phase 7 — Kanban Upgrade (P2, ~800 lines)

### 7.1 SQLite Migration → `packages/tools/src/kanban.ts`
- Replace JSON file with SQLite DB
- 7 tables: tasks, task_links (DAG), task_comments, task_events, task_runs, task_attachments, notify_subs
- WAL mode + `wal_checkpoint(TRUNCATE)` every 300s
- REINDEX auto-repair

### 7.2 Agent Tools (expand from 4 to 12)
- Add: `kanban_show`, `kanban_heartbeat`, `kanban_comment`, `kanban_attach`, `kanban_link`
- Worker gating: `MYA_KANBAN_TASK` env for workers
- Auto-heartbeat bridge: agent `_touchActivity` → heartbeat 60s
- Stop-guard: worker finish without terminal tool → synthetic nudge (2 attempts)

### 7.3 Notifications
- Subscription: `(taskId, channel, chatId, threadId)`
- Background watcher (5s interval)
- Cursor-based event delivery with rewind on failure

**Tests**: `packages/tools/src/kanban-sqlite.test.ts`

---

## Phase 8 — Provider Routing (P2, ~200 lines)

### 8.1 Sticky session_id → `packages/ai/src/`
- Provider profiles can inject `session_id` into `extra_body`
- Pin every turn to same upstream endpoint
- Benefits Anthropic `cache_control` breakpoints

### 8.2 Route URL Identity → `packages/ai/src/`
- `normalizeRouteBaseUrl(url)`: lowercase scheme/host, strip default ports, one trailing slash
- Preserve userinfo + query params (route change indicators)
- Fail-closed on control/whitespace chars

### 8.3 Context Pin Clearing
- `shouldClearContextPin(configured, active)` → fail-closed on mismatch
- Drop `context_length` pin on route change

**Tests**: `packages/ai/src/route-identity.test.ts`

---

## Execution Order & Dependencies

```
Phase 0 (Security) ────────────────────────┐
                                           ↓
Phase 1 (MCP) ─────────────────────────────┤
                                           ↓
Phase 2 (Compression) ← depends on Phase 0 (redaction)
                                           ↓
Phase 3 (FTS) ← independent, can parallel with Phase 2
                                           ↓
Phase 4 (Gateway) ← independent
                                           ↓
Phase 5 (DDGS) ← independent
Phase 6 (MCP OAuth) ← depends on Phase 1
Phase 7 (Kanban) ← independent
Phase 8 (Provider) ← independent
```

**Recommended batch order**:
1. **Batch A**: Phase 0 + Phase 1 (parallel, no deps, ~1000 lines)
2. **Batch B**: Phase 2 + Phase 3 + Phase 4 (parallel, ~1900 lines)
3. **Batch C**: Phase 5 + Phase 6 + Phase 7 + Phase 8 (parallel, ~1450 lines)

---

## Effort Summary

| Phase | Lines | New Files | Difficulty | Priority |
|-------|-------|-----------|------------|----------|
| 0 — Security | ~600 | 2 | Medium | P0 |
| 1 — MCP Reliability | ~400 | 0 (modify) | Medium | P0 |
| 2 — Compression | ~1200 | 1 | Hard | P1 |
| 3 — FTS5 | ~300 | 1 (Rust) | Medium | P1 |
| 4 — Gateway | ~400 | 0 (modify) | Medium | P1 |
| 5 — DDGS | ~150 | 1 | Easy | P2 |
| 6 — MCP OAuth | ~300 | 1 | Medium | P2 |
| 7 — Kanban | ~800 | 0 (rewrite) | Medium | P2 |
| 8 — Provider | ~200 | 0 (modify) | Easy | P2 |
| **Total** | **~4350** | **6 new** | | |

---

## Verification Gates

Each phase must pass before proceeding:
1. **Type check**: `npx tsc -b packages/<pkg>` — 0 errors (pre-existing TS errors in coding-agent/print excluded)
2. **Unit tests**: `npx vitest run packages/<pkg>` — all pass
3. **Bundle**: `npm run bundle` — dist/mya.js builds successfully
4. **E2E smoke**: Gateway starts, MCP servers connect, memory search works
5. **Invariant check**: No `Date.now()` outside `packages/core/src/time.ts`

---

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Compression engine complexity (1200 lines) | Phase 2 in sub-phases: 2.1-2.3 (config+predicate) first, then 2.4-2.6 (prune+summary+assembly), then 2.7-2.9 (anti-thrash+wire) |
| CJK tokenizer napi-rs build | Phase 3.1 can start with pure-TS tokenizer (slower but works), port to Rust later |
| Kanban JSON→SQLite migration | Phase 7 needs migration script for existing `~/.mya/kanban.json` |
| MCP OAuth browser flow on headless | Paste fallback (stdin reader) like Hermes |
| Pre-existing TS errors | Exclude coding-agent + print from CI gate; only enforce on touched packages |

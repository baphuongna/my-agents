# Hermes Agent — Deep-Dive Round 3: Security + Infrastructure + Kanban

**3 additional parallel explorers** reading implementation-level source code.
Builds on round 1 (architecture) + round 2 (algorithm-level) with security, infrastructure,
and orchestration system details.

> **📌 Port Status: COMPLETED** — All systems below were ported to mya.
> See `PLAN-HERMES-PORT.md` for results. Notable review findings:
> - **Redaction §1**: `decodeURIComponent(key)` must be wrapped in try/catch — malformed `%` sequences throw URIError, bypassing all redaction. Round 1 CRITICAL fix.
> - **Redaction §1.2**: `force: false` must use `=== true || _REDACT_ENABLED`, NOT `?? _REDACT_ENABLED` (false falls through). Round 1 HIGH fix.
> - **Redaction §1.1**: `sk_` prefix must be in `_PREFIX_SUBSTRINGS` pre-check list, not just the regex. Round 1 HIGH fix.
> - **Redaction §1.1**: E.164 phone must redact with `force=true` (persistence boundaries), not only `redactUrlCredentials`. Round 1 MEDIUM fix.
> - **MCP §2**: `start()` from `Failed`/`Parked` must transition through `Restarting → Initializing` (FSM rule). Round 2 CRITICAL fix.
> - **MCP §5**: `toFailed()` must skip `Parked` phase, else uncaught exception. Round 2 HIGH fix.
> - **Gateway §6.1**: Lock acquisition must use `O_EXCL` (wx flag) for atomic create, not `writeFileSync`. Round 2 HIGH fix.
> - **MCP §6**: RPC timeout timer must be `.unref()`'d and cleared on response. Round 2 HIGH fix.
> - **MCP §2.3**: `classifyMcpFailure` must use word boundaries (`\b40[13]\b`), not substring matching. Round 2 MEDIUM fix.

---

## 🔥 1. REDACTION ENGINE — 43 Secret Patterns + Force Boundaries

**File:** `agent/redact.py` (872 lines)

### 1.1 Pattern Inventory

| Category | Patterns | Replacement |
|----------|----------|-------------|
| **API keys (43 prefixes)** | `sk-`, `ghp_`, `github_pat_`, `gho_/ghu_/ghs_/ghr_`, `xapp-`, `xox[baprs]-`, `AIza`, `pplx-`, `fal_`, `fc-`, `bb_live_`, `AKIA`, `sk_live_/sk_test_/rk_live_`, `SG.`, `hf_`, `r8_`, `npm_`, `pypi-`, `dop_v1_`, `doo_v1_`, `am_`, `sk_`, `tvly-`, `exa_`, `gsk_`, `syt_`, `retaindb_`, `hsk-`, `mem0_`, `brv_`, `xai-`, `ntn_`, `fw-`, `fw_`, `fpk_` | `_mask_token()`: first 6 + last 4, floor 18 |
| **ENV assignments** | `KEY=value` where KEY matches `(API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH)` | value → `***` |
| **Config (lowercase/dotted)** | `api.key=`, `api-key:`, `token:` (YAML colon) | value → `***` |
| **JSON fields** | `"apiKey":`, `"token":`, `"secret":`, `"access_token":`, `"bearer":`, `"key_material":` | value → `***` |
| **Auth headers** | `(Proxy-)?Authorization: <scheme> <token>`, `x-api-key:`, `x-goog-api-key:` | token → `***` |
| **Private keys** | `-----BEGIN [A-Z ]*PRIVATE KEY-----` | `[REDACTED PRIVATE KEY]` |
| **JWTs** | `eyJ[A-Za-z0-9_-]{10,}` (1/2/3-part) | `_mask_token()` |
| **DB conn strings** | `(postgres|mysql|mongodb|redis|amqp)://user:pass@` | password → `***` |
| **URL bare token** | `scheme://TOKEN@host` (8+ chars) | token → `***` |
| **Telegram bot tokens** | `(bot)?\d{8,}:([-A-Za-z0-9_]{30,})` | `digits:***` |
| **E.164 phone** | `\+[1-9]\d{6,14}` | `+1234****6789` |

### 1.2 Force=True + redact_url_credentials=True

```python
# force=True bypasses security.redact_secrets: false
# Used at PERSISTENCE BOUNDARIES (compaction summaries, memory, trace upload)
if not (force or _REDACT_ENABLED):
    return text

# redact_url_credentials=True (default False) adds stricter URL pass:
# 1. Redacts credential-named query params: access_token, api_key, client_secret,
#    password, jwt, token, signature, code (OAuth), x-amz-signature → key=***
# 2. Strips user:pass@ userinfo → user:***@
```

**Why URL credentials default False**: OAuth callbacks, magic-links, pre-signed URLs carry tokens in query strings that the agent MUST follow.

### 1.3 Non-Reusable Sentinels for File Reads

```python
# file_read=True: «redacted:ghp_…» instead of ghp_S1...Pn2T
# Prevents agent from writing back a truncated dead 13-char key (#35519)
```

### 1.4 Performance Optimization (-68% latency)

```python
# Cheap substring pre-check before expensive regex:
if "=" in text:    # → ENV patterns
if "://" in text:  # → URL patterns
if "eyJ" in text:  # → JWT
if ": " in text:   # → JSON
# Drops 13-pattern scan from ~5.6μs → ~1.8μs per record
```

---

## 🔥 2. PROMPT INJECTION DETECTION — 3-Tier Scope

**File:** `tools/threat_patterns.py` (~230 lines)

### 2.1 Scope Hierarchy

| Scope | Patterns | Used By |
|-------|----------|---------|
| `"all"` (narrow) | Classic injection + exfil | Any text |
| `"context"` (default) | + promptware/C2/role-hijack | Context files, memory, tool results |
| `"strict"` (broad) | + persistence/SSH backdoor | Memory writes, skill installs |

### 2.2 Pattern Categories

**Classic injection** (`"all"`):
- `ignore ... (previous|all|above|prior) ... instructions`
- `system prompt override`, `disregard ... your ... instructions`
- `act as if ... you have no restrictions`
- HTML comment: `<!--...(ignore|override|system|secret)...-->`
- Hidden div: `<div style="...display:none`
- `do not tell the user`

**Role-play/identity hijack** (`"context"`):
- `you are now a/the`, `pretend you are`
- `output system prompt`, `respond without restrictions`
- `name yourself \w+` (Brainworm identity override)

**C2/Brainworm promptware** (`"context"`):
- `register as a node`, `heartbeat/beacon to`, `pull task`
- `unset CLAUDE/CODEX/HERMES/AGENT`
- `\b(cobalt strike|sliver|havoc|mythic|metasploit|brainworm)\b`
- Anti-forensic: `only use one-liners`, `never write script to disk`

**Exfiltration** (`"all"`):
- `curl/wget $(KEY|TOKEN|SECRET|PASSWORD)`
- `cat .env/credentials/.netrc/.pgpass`

**Persistence/SSH backdoor** (`"strict"`):
- `authorized_keys`, `$HOME/.ssh`, `$HOME/.hermes/.env`
- `update AGENTS.md/CLAUDE.md/.cursorrules`
- `(api_key|token|secret)\s*[=:]\s*["'][A-Za-z0-9+/=_-]{20,}` (hardcoded secrets)

### 2.3 Unicode/Homograph Defense
- 17 invisible chars stripped: U+200B–200D, U+2060, U+2062–2064, U+FEFF, U+202A–202E, U+2066–2069
- NFKC normalization before regex (full-width ｃａｔ → cat)
- `MAX_SCAN_CHARS = 65_536` cap

---

## 🔥 3. SSRF PROTECTION — DNS Resolution + IP Blocking

**File:** `tools/url_safety.py` (~400 lines)

### 3.1 Always-Blocked Floor (regardless of toggle)
- Cloud metadata endpoints: `169.254.169.254`, `169.254.170.2`, `169.254.169.253`, `fd00:ec2::254`, `100.100.100.200`
- Hostnames: `metadata.google.internal`, `metadata.goog`
- Networks: `169.254.0.0/16`, `::ffff:169.254.0.0/112`

### 3.2 Standard Blocking (unless `allow_private_urls=True`)
- Private, loopback, link-local, reserved, multicast, unspecified
- **CGNAT**: `100.64.0.0/10` (not covered by `is_private`)

### 3.3 Documented Limitation
DNS rebinding (TOCTOU) not fixable at pre-flight — requires connection-level validation.

---

## 🔥 4. DDGS WORKER ISOLATION — Disposable Child Process

### 4.1 The GIL Trap Problem
```python
# ddgs/primp blocks in native code holding GIL
# ThreadPoolExecutor + future.result(timeout) CAN'T FIRE
# because waiter never reacquires GIL → entire process freezes
```

### 4.2 Solution: Disposable Child + Side-Thread Communicate

```python
proc = subprocess.Popen([sys.executable, worker_path],
    stdin=PIPE, stdout=PIPE, stderr=DEVNULL,
    start_new_session=True)  # own session → reap hung grandchild

# communicate() on SIDE thread (not main, not inline)
fut = pool.submit(proc.communicate, json.dumps(request))

# Parent polls: interrupt flag + wall-clock deadline
while True:
    if is_interrupted(): break      # user Ctrl+C
    if time.monotonic() >= deadline: break  # 30s timeout
    try:
        out, _ = fut.result(timeout=0.1)  # 100ms poll
        break
    except TimeoutError: continue
```

### 4.3 Worker Protocol (JSON over stdin/stdout)
```json
// Request (stdin)
{"query": "search terms", "safe_limit": 5}

// Response (stdout)
{"ok": true, "results": [...]}
{"ok": false, "error": "RuntimeError: ..."}
```

Worker installs NO signal handlers — relies entirely on parent kill.

### 4.4 Termination (always in finally)
```python
proc.terminate()     # SIGTERM
_wait_until_dead(1.0)  # 1s grace
if proc.poll() is None:
    proc.kill()      # SIGKILL
```

---

## 🔥 5. MCP OAUTH 2.1 PKCE — Cross-Process Token Management

### 5.1 Token Storage (0600 atomic)
```
~/.hermes/mcp-tokens/
  ├── <server>.json          # access/refresh/expires_at
  ├── <server>.client.json   # dynamic registration (RFC 7591)
  └── <server>.meta.json     # OAuth server metadata
```

```python
# O_EXCL + 0600 avoids TOCTOU window (write_text + chmod = briefly 0o644)
fd = os.open(tmp, O_WRONLY | O_CREAT | O_EXCL, S_IRUSR | S_IWUSR)
# fsync + atomic replace
```

### 5.2 Dead-Client Detection + Auto-Re-registration
```python
# IdP rejects client_id with invalid_client → poison registration
if status in (400, 401) and b"invalid_client" in body:
    storage.poison_client_registration()  # delete client.json + meta.json
    # Next flow re-runs RFC 7591 dynamic registration
```

### 5.3 Cross-Process Token Reload (Disk Watch)
```python
# Check file mtime before every auth flow
if mtime_ns != entry.last_mtime_ns:
    entry.provider._initialized = False  # force reload from disk
```

### 5.4 401 Deduplication (Thundering Herd)
```python
# N concurrent tool calls hit 401 → only ONE recovery fires
pending = entry.pending_401.get(failed_token)
if pending is None:
    pending = create_future()
    # Only this caller runs recovery
pending.set_result(result)
return await pending  # all callers get same result
```

### 5.5 Paste Fallback (SSH/Remote Sessions)
```python
# stdin reader thread races HTTP listener
# User pastes redirect URL or just ?code=...&state=...
# Works from browser on another machine
```

---

## 🔥 6. MCP KEEPALIVE — ping with list_tools Fallback

### 6.1 The Probe Strategy
```python
async def _keepalive_probe(self):
    if not self._ping_unsupported:
        try:
            await wait_for(session.send_ping(), timeout=30.0)
            return  # alive
        except Exception as exc:
            if not _is_method_not_found_error(exc): raise  # real failure
            self._ping_unsupported = True  # latch: fall back permanently
    # Fallback for servers without ping:
    await wait_for(session.list_tools(), timeout=30.0)
```

**Why ping not list_tools**: ping = few bytes. list_tools on 830-tool server = ~1MB every cycle.

### 6.2 Keepalive vs Reconnect Budget

| Aspect | Keepalive | Reconnect Budget |
|--------|-----------|-----------------|
| Purpose | Detect stale idle sessions | Stop infinite respawn loops |
| Cadence | Every 180s (min 5s) | Per consecutive unproven reconnect |
| Trigger | Timeout in lifecycle wait | Transport returns cleanly, session unproven |
| Action | Probe ping/tools → reconnect on fail | Count retries → park at 5 |

### 6.3 Parent-Death Watchdog (POSIX)
```python
# Wrap stdio command: python3 -m tools.mcp_stdio_watchdog --ppid <pid> -- <real_cmd>
# Polls getppid() every 2s — when parent dies, getppid() changes to 1
def _watchdog_loop(proc, original_ppid):
    while proc.poll() is None:
        if getppid() != original_ppid:  # orphaned!
            _terminate_process_group(proc)  # killpg(SIGTERM → 3s → SIGKILL)
            return
        time.sleep(2.0)
```

Transparent pipe passthrough (NOT bytes proxy) — MCP stdio protocol talks directly.

---

## 🔥 7. SESSION BRANCH/SEED — Parent-Child Chain

### 7.1 Three Child Types

| Type | Marker | Visible | Routing Inherited | On Parent Delete |
|------|--------|---------|-------------------|------------------|
| Branch | `_branched_from` in model_config | ✅ Pickers | ❌ | Orphaned (parent_id → NULL) |
| Compression | parent `end_reason='compression'` | ❌ Hidden | ✅ | Orphaned |
| Delegate | `_delegate_from` in model_config | ❌ Hidden | ❌ | Cascade-deleted |

### 7.2 Column Inheritance (SQL UPDATE after INSERT)

**All children** inherit workspace columns:
```sql
UPDATE sessions SET
    cwd = COALESCE(sessions.cwd, (SELECT p.cwd FROM sessions p WHERE p.id = parent)),
    git_repo_root = COALESCE(..., (SELECT p.git_repo_root ...)),
    git_branch = COALESCE(..., (SELECT p.git_branch ...))
WHERE id = ? AND parent_session_id IS NOT NULL
```

**Compression children only** inherit gateway routing:
```sql
UPDATE sessions SET
    user_id = COALESCE(...), session_key = COALESCE(...),
    chat_id = COALESCE(...), chat_type = COALESCE(...),
    thread_id = COALESCE(...), origin_json = COALESCE(...)
WHERE id = ? AND parent_session_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM sessions p WHERE p.id = parent
              AND p.end_reason = 'compression')
```

**Why compression-only**: crash between child creation and gateway peer re-record would strand child without routing (#59527). Delegate children (parent still live) never inherit.

---

## 🔥 8. WEB UI BUILD LOCK — flock + Content Hash

### 8.1 Three-Tier flock Strategy
```python
try:
    flock(LOCK_EX | LOCK_NB)      # non-blocking try
except OSError:
    if dist_index.exists():
        return True               # serve stale dist (another process building)
    flock(LOCK_EX)                # block until builder finishes
return _do_build_web_ui()         # staleness check INSIDE lock
```

### 8.2 Content-Hash Freshness (NOT mtime)
```python
# SHA-256 of entire web source tree
# mtime unreliable: git checkout/pull/update rewrite mtimes without content change
hash = _compute_web_ui_content_hash(project_root, web_dir)
return hash != saved_hash  # compare against stamp file
```

### 8.3 --skip-build Recovery
```python
if not dist_index.exists():
    print("⚠ --skip-build but no web dist — attempting recovery build")
    _build_web_ui(fatal=True)  # ONE recovery build
    if not dist_index.exists(): sys.exit(1)
```

---

## 🔥 9. KANBAN — Board/Task Orchestration System

### 9.1 Data Model (7 tables)
```
tasks: id, title, body, assignee, status, priority, project_id,
       claim_lock, claim_expires, worker_pid, last_heartbeat_at,
       current_run_id, workflow_template_id, current_step_key,
       skills, model_override, session_id, block_kind, ...
task_links: parent_id, child_id (DAG dependencies)
task_comments, task_events (append-only log), task_runs,
task_attachments, kanban_notify_subs (subscription-based notifications)
```

Statuses: `triage → todo → scheduled → ready → running → blocked → review → done → archived`

### 9.2 12 Agent Tools

| Tool | Gating | Purpose |
|------|--------|---------|
| `kanban_show` | kanban mode | Read task state |
| `kanban_list` | orchestrator only | Board enumeration |
| `kanban_complete` | kanban mode | Close task with result |
| `kanban_block` | kanban mode | Block with typed reason |
| `kanban_heartbeat` | kanban mode | Extend claim + heartbeat |
| `kanban_comment` | kanban mode | Add comment |
| `kanban_create` | kanban mode | Create child task (fan-out) |
| `kanban_unblock` | orchestrator only | Routing |
| `kanban_link` | kanban mode | DAG dependency |

### 9.3 Auto-Heartbeat Bridge
```python
# Agent's _touch_activity calls heartbeat every 60s
# Dispatcher watchdog sees liveness without explicit kanban_heartbeat call
```

### 9.4 Stop-Guard
```python
# Worker tries to finish without terminal tool → inject synthetic nudge
# "You must call kanban_complete or kanban_block before stopping"
# Bounded to 2 attempts
```

### 9.5 Notification System
```python
# Subscription: (task_id, platform, chat_id, thread_id)
# Background watcher (5s interval):
#   1. claim_unseen_events_for_sub (advance cursor atomically)
#   2. Deliver events: completed, blocked, gave_up, crashed, timed_out
#   3. Success → advance cursor; Failure → rewind for retry
#   4. 3 consecutive send failures → drop subscription (dead chat)
```

### 9.6 WAL Checkpoint + Index Repair
```python
# Periodic: PRAGMA wal_checkpoint(TRUNCATE) every 300s per board
# Auto-repair: integrity_check → if index-only errors → quarantine → REINDEX
# CLI: `hermes kanban repair` → RepairResult(ok/repaired/corrupt/missing)
```

---

## 📊 FINAL PORTING PRIORITY (All Rounds Combined)

### P0 — Immediate (Low effort, high impact)
1. **CJK token estimator** (20 lines) → packages/core
2. **MCP reconnect budget** (100 lines) → packages/gateway/src/mcp-client.ts
3. **MCP failure classification** (50 lines) → same
4. **Redaction engine** (200 lines, 43 patterns) → packages/core/src/security.ts
5. **Hard-exit pattern** (30 lines) → gateway shutdown
6. **SSRF protection** (100 lines) → URL safety

### P1 — Near-term (Medium effort, high impact)
7. **Idle compaction predicate** (30 lines) → context engine
8. **Per-model threshold** (20 lines) → longest substring match
9. **External-content FTS5** (SQL DDL) → packages/memory
10. **Prompt injection detection** (230 lines, 3-tier scope) → security
11. **Strict redaction at boundaries** (force=True) → compaction
12. **Session branch/seed chain** (SQL UPDATE inheritance)

### P2 — Strategic (Higher effort, high impact)
13. **CJK bigram tokenizer** (80 lines C→Rust) → napi-rs
14. **compress() main flow** (500 lines) → context engine
15. **DDGS process isolation** (100 lines) → web search
16. **MCP OAuth PKCE** (300 lines) → MCP auth
17. **Kanban board system** (full system) → orchestration
18. **Widget grid SDK** (500 lines) → TUI dashboard

### P3 — Future (Nice-to-have)
19. Theme seed→ladder (300 lines)
20. Skin cross-surface sync
21. Slack Block Kit clarify
22. Provider auto-raise
23. Secrets management (Bitwarden/1Password)

**Total porting estimate**: ~5,000+ lines TS/Rust for P0-P2.

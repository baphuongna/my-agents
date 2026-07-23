# Hermes Agent — Deep-Dive Code Analysis (477c08b44 → 163fab8d0)

**364 commits** phân tích qua 4 parallel explorer agents đọc source code trực tiếp.
Không chỉ commit messages — đây là **implementation-level analysis** với code snippets,
data structures, và algorithms đủ chi tiết để port sang TypeScript.

> **📌 Port Status: COMPLETED** — All sections below were ported to mya in PLAN-HERMES-PORT.md.
> See `PLAN-HERMES-PORT.md` for final stats (6,316 lines, 553 tests, 35 bugs found across 7 review rounds).

---

## 🔥 1. COMPRESSION / CONTEXT COMPACTION (72 commits)

### 1.1 Architecture

```
config.yaml [compression.*]
    ↓
agent_init.py::_setup_agent()         → ContextCompressor(...)
    ↓
turn_context.py::build_turn_context()
    → Idle compaction check
    → Preflight compression check (multi-pass loop)
    ↓
conversation_compression.py::compress_context()
    → Lock acquisition (SQLite-backed)
    → Memory provider on_pre_compress()
    → ContextCompressor.compress()
        → _prune_old_tool_results()
        → _serialize_for_summary() with _redact_compaction_text()
        → _generate_summary() (LLM call via auxiliary_client)
        → Assemble: protected head + summary + protected tail
    → Session rotation or in-place archive
    → Post-compaction: system prompt rebuild, notification
```

### 1.2 Full Config Surface

| Key | Type | Default | Purpose |
|-----|------|---------|---------|
| `threshold` | float | 0.50 | % context window trigger (50%) |
| `enabled` | truthy | True | Master switch |
| `target_ratio` | float | 0.20 | Summary output = threshold × ratio |
| `protect_last_n` | int | 20 | Recent messages preserved verbatim |
| `protect_first_n` | int | 3 | Head messages preserved (+ system always) |
| `max_attempts` | int | 3 | Retry cap (hard-capped 10) |
| `abort_on_summary_failure` | truthy | False | Abort turn if summary LLM fails |
| `model_thresholds` | dict | {} | Per-model overrides (substring match) |
| `threshold_tokens` | int | None | Absolute token cap |
| `in_place` | truthy | False | Rewrite without session_id rotation |
| `idle_compact_after_seconds` | int | 0 | Idle compaction (0 = disabled) |

### 1.3 Idle Compaction — Pure Predicate

```python
def _should_idle_compact(*, enabled, idle_after_seconds, idle_gap_seconds,
                         tokens, floor_tokens, cooldown_active) -> bool:
    if not enabled or idle_after_seconds <= 0:
        return False
    if idle_gap_seconds < idle_after_seconds:
        return False
    if cooldown_active:
        return False
    return tokens > floor_tokens  # floor = threshold_tokens × target_ratio
```

**Key insight**: Orthogonal với token-threshold — không cần vượt `threshold_tokens`.
Chỉ cần `tokens > floor_tokens` (size compaction sẽ giảm đến). Chạy **synchronously** blocks turn.

### 1.4 Per-Model Threshold — Longest Substring Match

```python
def resolve_model_threshold(model, model_thresholds, default):
    best_key = ""
    for key in model_thresholds:
        if key in model and len(key) > len(best_key):
            best_key = key
    return float(model_thresholds[best_key]) if best_key else default
```

Config:
```yaml
compression:
  model_thresholds:
    "glm-5.2": 0.80       # substring match
    "glm-5.2-1M": 0.90     # longer match wins
```

4-layer threshold chain:
1. Config value → 2. Per-model override (longest substring) → 3. Small-context 75% floor (<512K) → 4. `_compute_threshold_tokens` (64K floor + 85% degenerate guard + max_tokens reservation)

### 1.5 Multi-Pass Preflight Compression

```python
for _pass in range(max_preflight_passes):
    messages, prompt = agent._compress_context(...)
    preflight_tokens = estimate_request_tokens_rough(...)
    if not _compression_made_progress(orig_len, new_len, orig_tokens, new_tokens):
        break  # Neither rows nor tokens moved
    if not compressor.should_compress(preflight_tokens):
        break  # Below threshold now

# Progress = row count dropped OR >5% token reduction
def _compression_made_progress(orig_len, new_len, orig_tokens, new_tokens):
    if new_len < orig_len: return True
    return orig_tokens > 0 and new_tokens < orig_tokens * 0.95
```

### 1.6 Compaction Handoff — Preserve Latest User Turn

```python
SUMMARY_PREFIX = (
    "[CONTEXT COMPACTION — REFERENCE ONLY] Earlier turns were compacted "
    "into the summary below. ... Respond ONLY to the latest user message "
    "that appears AFTER this summary — that message is the single source "
    "of truth for what to do right now. ..."
)

def _ensure_compressed_has_user_turn(original_messages, compressed):
    if any(_is_real_user_message(m) for m in compressed):
        return  # Already has a real user turn
    for m in reversed(original_messages):  # Find LAST real user message
        if _is_real_user_message(m):
            _insert_real_user_anchor(compressed, _fresh_compaction_message_copy(m))
            return
    compressed.append({"role": "user", "content": COMPRESSION_CONTINUATION_USER_CONTENT})
```

Rolling summary update feeds previous summary back:
```
"You are updating a context compaction summary...
PREVIOUS SUMMARY: {prev}
NEW TURNS TO INCORPORATE: {new}
PRESERVE all existing information... Update '## Active Task'..."
```

### 1.7 Strict Redaction at Every Boundary

```python
def _redact_compaction_text(text):
    return redact_sensitive_text(text, force=True, redact_url_credentials=True)
```

**`force=True`** overrides user's global `security.redact_secrets: false`.
Applied at: serialization input, summary output, previous summary on re-compact,
focus topic, memory context (truncated to 6000 chars).

Matches: API keys (`sk-`, `ghp_`), ENV assignments, JSON fields, auth headers,
PEM blocks, JWTs, DB connection strings, URL credentials, OAuth codes.

### 1.8 CJK Token Estimation — ASCII Fast Path

```python
_CJK_DENSE_RE = re.compile("[\u1100-\u11ff\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]")

def estimate_tokens_rough(text):
    if text.isascii():              # O(1) fast path
        return (len(text) + 3) // 4
    dense = len(text) - len(_CJK_DENSE_RE.sub("", text))
    if not dense:                   # Non-ASCII but no CJK
        return (len(text) + 3) // 4
    sparse = len(text) - dense
    return dense + ((sparse + 3) // 4)  # CJK = 1 token/char, rest = 4 chars/token
```

Images: flat 1500 tokens each (not base64 char count).

---

## 🔥 2. MCP RELIABILITY (23 commits)

### 2.1 Transport Classification

```python
def _is_http(self):
    return "url" in self._config  # Pure config key check
```

Cycle-safe: reconnect loop re-enters transport without counting as failure if
`_reconnect_event` was set AND `_session_proven` is True.

Exception group unwrapping digs out real root cause from anyio `BaseExceptionGroup`:
- Fatal leaves (`KeyboardInterrupt`/`SystemExit`) always re-raise
- Prefers non-cancellation leaves over `CancelledError` noise

### 2.2 Reconnect Budget (Rapid-Drop, #62212)

```python
# Problem: flapping transport that handshakes but drops = 6212 spawns in 63h
_session_proven: bool = False    # Fresh session UNPROVEN until real health
_reconnect_retries: int = 0     # Consecutive unproven reconnects

if self._session_proven:
    self._reconnect_retries = 0    # proven → clear budget
    backoff = 1.0
else:
    self._reconnect_retries += 1   # charge budget
    if self._reconnect_retries > 5:  # _MAX_RECONNECT_RETRIES
        # PARK: deregister tools, wait 300s, self-probe
```

Session "proves" itself via: keepalive success OR successful tool call.

### 2.3 Park Permanent Failures (#65673)

```python
def _classify_mcp_failure(exc):
    root = _unwrap_exception_group(exc)
    if _is_auth_error(root): return "permanent"
    if isinstance(root, (NonMcpEndpointError, InvalidMcpUrlError)): return "permanent"
    if isinstance(root, FileNotFoundError): return "permanent"
    if isinstance(root, OSError) and root.errno == errno.ENOENT: return "permanent"
    status = getattr(getattr(root, "response", None), "status_code", None)
    if status in (401, 403): return "permanent"
    return "transient"
```

Permanent = parks immediately on first attempt, skipping retry ladder.
Self-probes every 300s; `/reload-mcp` wakes immediately.

### 2.4 Isolate Failing stdio Server (#50394)

```python
_server_connect_retry_after: Dict[str, float] = {}   # name → deadline
_server_connect_failures: Dict[str, int] = {}        # name → consecutive count

def _record_connect_failure(server_name):
    n = failures.get(server_name, 0) + 1
    backoff = min(30 * (2 ** (n - 1)), 600)  # 30s → 60s → 120s → ... → 600s max
    retry_after[name] = time.monotonic() + backoff

# Register filter skips cooldown servers:
new_servers = {k: v for k, v in servers.items()
               if k not in _servers
               and not _connect_cooldown_active(k)}
```

One bad server's backoff is completely independent of healthy co-located servers.

### 2.5 Constants

| Constant | Value |
|----------|-------|
| `_MAX_RECONNECT_RETRIES` | 5 |
| `_MAX_INITIAL_CONNECT_RETRIES` | 3 |
| `_MAX_BACKOFF_SECONDS` | 60 |
| `_PARKED_RETRY_INTERVAL` | 300s |
| `_BACKOFF_JITTER` | ±20% |
| `_CONNECT_RETRY_BASE_BACKOFF` | 30s |
| `_CONNECT_RETRY_MAX_BACKOFF` | 600s |
| `_DEFAULT_KEEPALIVE_INTERVAL` | 180s |

### 2.6 Revision-Aware Reload (mcp_rev)

SHA-1 hash of `{mcp, mcp_servers, tools}` config sections → 12 chars.
Cosmetic writes don't bump rev → skip unnecessary reloads.

Leader/follower coalescing:
- LEADER wins non-blocking lock, runs full reload, marks completed generation
- FOLLOWER finds lock busy → blocks → checks: leader completed AND loaded my revision?
  - Both true → coalesce (just refresh own snapshot)
  - Either false → re-run full reload itself

Convergence loop handles config-edit-racing-slow-reload (3 passes max).

---

## 🔥 3. DATABASE / FTS (22 commits)

### 3.1 Schema v23 — External-Content FTS

```sql
-- OLD (v22): duplicate full text copy = ~75% size overhead (18.9 GB of 25 GB DB)
CREATE VIRTUAL TABLE messages_fts USING fts5(content, tool_name, tool_calls);

-- NEW (v23): external-content = store only inverted index
CREATE VIRTUAL TABLE messages_fts USING fts5(
    content, tool_name, tool_calls,
    content='messages',          -- NO inline text copy; reads from base table
    content_rowid='id'
);
```

### 3.2 Tool-Row-Free Trigram Index

Tool rows = ~90% of message bytes, mostly machine noise (base64, file dumps):

```sql
CREATE VIEW messages_fts_trigram_src AS
    SELECT id, role, content, tool_name, tool_calls
    FROM messages WHERE role <> 'tool';   -- EXCLUDE tool rows

CREATE VIRTUAL TABLE messages_fts_trigram USING fts5(
    content, tool_name, tool_calls,
    content='messages_fts_trigram_src',
    content_rowid='id',
    tokenize='trigram'
);
```

### 3.3 CJK Bigram Tokenizer (~250 lines C)

**Build**: `gcc -shared -fPIC -O2 fts5_cjk.c -o libfts5_cjk.so` → `~/.hermes/lib/`

**How it works**: Wraps `unicode61`. For each token, scans for CJK codepoints.
If present, emits **overlapping character bigrams** (Lucene `CJKAnalyzer` semantics):

```
캘린더 → [캘린][린더]   # FTS5 turns consecutive tokens into a phrase = exact substring
```

CJK codepoint ranges treated as dense:
- Hangul: `0xAC00–0xD7A3`, Jamo `0x1100–0x11FF`, ext-A/B
- CJK Unified: `0x4E00–0x9FFF`, ext-A/B-F
- Hiragana: `0x3040–0x309F`, Katakana: `0x30A0–0x30FF`

Fast path: no CJK anywhere → token passes through untouched (zero per-char overhead).

**Why this matters**: Stock `unicode61` splits CJK into individual chars (no substring match).
Stock `trigram` needs min 3 chars. CJK bigram gives index-speed substring match down to 2-char terms.

### 3.4 Search Routing

```
1. Non-CJK → messages_fts (unicode61) FTS5 MATCH
2. CJK + cjk_available + no tool rows + no lone 1-char → messages_fts_cjk (bigram)
3. CJK + count≥3 + trigram_available → messages_fts_trigram
4. Else → LIKE %term% substring scan
```

Relevance: FTS5 default **BM25** (`ORDER BY rank`). Sort adds timestamp primary key.

### 3.5 REINDEX Auto-Repair

```python
# Detect: PRAGMA integrity_check reports "wrong # of entries in index"
# Repair: conn.execute("REINDEX") — rewrites all b-trees from canonical table rows
# No data or FTS schema touched
```

### 3.6 FTS Corruption Self-Heal (3 layers)

1. **Offline probe** (`_db_opens_cleanly`): `PRAGMA journal_mode` + `integrity_check` +
   base-table read + FTS5 read probe (`MATCH ''`) + FTS5 write probe (transaction rollback)
2. **Runtime rebuild** (`_try_runtime_fts_rebuild`): one-shot guard on `DatabaseError` →
   FTS5 `'rebuild'` command + retry
3. **Capability classification**: `"no such tokenizer"` = capability gap (skip),
   `"malformed"` = corruption (trigger repair)

### 3.7 Slow-Query Log

```python
# Threshold: HERMES_SEARCH_SLOW_MS (default 1000ms, 0 = log every call)
# Routing-path attribution: _describe_search_path classifies each query
#   into: empty | fts5 | fts_cjk | trigram | like_scan | unknown
# WITHOUT executing the query
```

---

## 🔥 4. TUI WIDGET SDK + THEME SYSTEM (61 commits)

### 4.1 Widget Grid Layout Engine (3 layers)

**Track solver** — CSS grid-style `fr` units:
```typescript
type GridTrackSize = number | { fr: number; min?: number }
// Fixed tracks claim size → unpinned fr tracks share remainder by weight
// fr below min → pinned, re-solve iteratively
// Overflow → shave trailing tracks down to floor 1
```

**1-axis flow** (`layoutWidgetGrid`): first-fit greedy row packing.
Auto-column: `floor((width + gap) / (minColumnWidth + gap))`, clamped `[1, maxColumns]`

**2-axis workspace** (`layoutGridAreas`): dense first-fit auto-placement
(CSS `grid-auto-flow: row dense`). Cells solved to absolute `{x, y, width, height}`.

### 4.2 Widget SDK Contract

```typescript
interface WidgetApp<S = unknown> {
  id: string
  help: string
  mode?: 'ambient' | 'modal'       // modal = owns all keys, blocks composer
  zone?: AmbientZone               // ambient placement
  width?: number                   // card width in cells
  init(arg: string): null | S      // null = refuse, print usage
  reduce(state: S, input: WidgetInput): null | S  // null = close
  render(ctx: WidgetRenderCtx<S>): ReactNode
}
```

**Registry IS the catalog**: `Map<string, WidgetApp>`. Last-writer-wins.
Slash commands derive dynamically: `listWidgetApps().map(app => ({name: app.id, run: ...}))`.

**Hot-load**: `$HERMES_HOME/tui-widgets/*.mjs`, `default-export register(sdk)`.
`fs.watch` debounced 300ms. Cache-busted imports: `?t=${Date.now()}`. Delete-sync unregisters apps.

**Crash boundary**: React Error Boundary wraps every widget. Crash → `⚠ /{appId}: {message}`.
App stays registered so hot-reload fix re-renders.

### 4.3 Ambient Zones

| Zone | Family | Behavior |
|------|--------|----------|
| `dock-top` / `dock-bottom` | Dock | In-flow row, reserves real space |
| `top-left/right` | Float | Overlay transcript margins (absolute) |
| `bottom-left/right` | Float | Reserved side column, stacks from bottom |

### 4.4 Theme System — Seed → Derived Tone Ladder

**Core principle**: Skin supplies ~10 identity seeds; every secondary tone is DERIVED.

```typescript
function deriveTones(seeds): ThemeTones {
  const isLight = relativeLuminance(bg) > 0.5
  return {
    muted: isLight ? desaturate(accent, 0.05) : desaturate(mix(accent, bg, 0.19), 0.16),
    surface: mix(bg, desaturate(accent, 0.15), isLight ? 0.045 : 0.09),
    activeRow: mix(surface, accent, 0.25),
    selection: mix(surface, accent, 0.28),
    border: mix(accent, bg, 0.25)
  }
}
```

Knobs reverse-engineered from hand-tuned palettes via grid-search (documented with error margins).

**Background-aware adaptation** (2 guards):
1. Contrast floors: `liftForContrast(color, bg, floor)` — DISPLAY (1.45/1.18) vs SEMANTIC (2.2/1.6)
2. Fill polarity: wrong-polarity fill (navy menu on white terminal) → fallback to derived

**Flash-free boot**: persists last resolved theme to `~/.hermes/tui-theme-boot.json`,
replays as first frame so async signals merely confirm.

### 4.5 Cross-Surface Sync

```
YAML skin (authored once)
    → skin_engine.py resolves palette
    → JSON-RPC: gateway.ready, skin.changed
    → TUI: fromSkin() → ANSI-safe Theme (Ink)
    → Desktop: skinToDesktopTheme() → CSS custom properties (Tailwind/shadcn)
    → CLI: Python skin_engine → prompt_toolkit/Rich styles
```

Canonical token list in `apps/shared/src/skin.ts`: `SKIN_COLOR_TOKENS` array.

### 4.6 `hermes skin set` — Fork + In-Place Tweak

```python
def _skin_set(key, value, skin=None):
    path = _skins_dir() / f"{name}.yaml"
    if path.exists():
        data = yaml.safe_load(path.read_text())  # edit existing
    else:
        resolved = load_skin(name)                # built-in: FORK into editable copy
        data = {"name": f"{name}-custom", "colors": dict(resolved.colors), ...}
    data["colors"][key] = value
    path.write_text(yaml.safe_dump(data))
    # File mtime bump → gateway watcher repaints every live surface within ~1s
```

---

## 🔥 5. SECRETS MANAGEMENT (19 commits)

### 5.1 Architecture

```
config.yaml [secrets.*]
    ↓
env_loader._apply_external_secret_sources()
    ↓
registry.apply_all() — single entry point
    → For each registered source:
        → source.fetch(cfg, home) → FetchResult
        → Apply with precedence guards
    → Returns ApplyReport with provenance
```

### 5.2 SecretSource Contract

```python
class SecretSource(ABC):
    api_version: int = 1          # compatibility gate
    name: str                      # config key [a-z0-9_]+
    shape: str = "mapped"          # "mapped" or "bulk"
    scheme: Optional[str] = None   # URI scheme owned (e.g. "op://")

    @abstractmethod
    def fetch(self, cfg: dict, home_path: Path) -> FetchResult:
        """Resolve secrets. MUST NOT raise or prompt."""
```

`ErrorKind` enum: `NOT_CONFIGURED | BINARY_MISSING | AUTH_FAILED | AUTH_EXPIRED | REF_INVALID | NETWORK | EMPTY_VALUE | TIMEOUT | INTERNAL`

### 5.3 Precedence Rules

```
1. secrets.preserve_existing — pre-existing env ALWAYS wins (escape hatch)
2. Pre-existing env (.env/shell) — unless override_existing: True
3. Mapped sources (in configured order) — outrank bulk REGARDLESS of list order
4. Bulk sources (in configured order)

First-claim-wins: later source carrying same var → skipped_claimed + conflict warning
override_existing NEVER applies across sources
```

### 5.4 Encrypted Stale Cache Fallback

```python
# Only triggers on NETWORK or TIMEOUT errors — never AUTH_FAILED or INTERNAL
if kind in (ErrorKind.NETWORK, ErrorKind.TIMEOUT):
    # AES-256-GCM with HKDF-derived key from bootstrap token
    key = HKDF(SHA256(), length=32, salt=salt, info=b"hermes-bws-encrypted-cache-v1"
              ).derive(access_token.encode())
    # Raw token NEVER stored — only derives the AES key
```

Atomic write: `tempfile.mkstemp` → `os.chmod(tmp, 0o600)` → `os.replace(tmp, path)`

### 5.5 Command Source

```python
# Key passed as DATA (never interpolated into command string)
env["HERMES_SECRET_KEY"] = secret_key  # hostile key names ("; rm -rf ~") are inert
proc = subprocess.Popen(["/bin/sh", "-c", command], env=env, start_new_session=True)
# Hard timeout: 3s, output cap: 1 MiB
# start_new_session=True → os.killpg(SIGKILL) on timeout
# stderr captured and DISCARDED (may carry secrets)
```

### 5.6 Config SecretRef Resolution

```python
def _env_expand_match(m):
    inner = m.group(1).strip()
    if inner.startswith("env:"):     # ${env:VAR} — Cursor-style
        return os.environ.get(inner[4:].strip(), raw)
    return os.environ.get(inner, raw) # ${VAR} — legacy
```

---

## 🔥 6. GATEWAY HARDENING (40 commits)

### 6.1 Stale Lock Detection (TTL + PID Liveness)

5-point identity check:
1. PID existence (cross-platform, treats zombies as dead)
2. Start-time fingerprint (`/proc/<pid>/stat` field 22 or `psutil.create_time()`)
3. Command-line verification (requires actual `gateway run` subcommand)
4. Stopped-state detection (reads `/proc/{pid}/status` State: field for `T`/`t`)
5. Boot-time PID+start_time collision guard

**Tombstone rename** for atomic removal:
```python
# os.replace() is atomic: exactly one racer claims the stale file
tombstone = lock_path.with_name(lock_path.name + ".stale")
os.replace(lock_path, tombstone)  # atomic
tombstone.unlink(missing_ok=True) # then cleanup
```

`gateway_state.json` TTL: 120s before liveness claim is suspect.

### 6.2 Orphan Child Reap (POSIX)

```python
def reap_gateway_children(children, *, parent_pid, timeout=5.0):
    for child in children:
        if child.status() == STATUS_ZOMBIE: continue
        if child.ppid() == parent_pid: continue  # parent alive = not orphan
        child.terminate()   # SIGTERM
    gone, alive = psutil.wait_procs(live, timeout=timeout)  # bounded 5s wait
    for child in alive:
        child.kill()        # SIGKILL for survivors
```

Signal: SIGTERM → bounded wait → SIGKILL. Identity-aware (PID + create time) so recycled PIDs never signaled.

### 6.3 Platform-Lock Takeover (One-Shot)

```python
def _acquire_platform_lock(self, scope, identity):
    acquired, existing = acquire_scoped_lock(...)
    if acquired: return True
    if takeover_allowed and not takeover_attempted:
        self._platform_lock_takeover_allowed = False  # consume authority (ONE shot)
        owner_pid = take_over_scoped_lock_holder(existing)  # 7-point identity check
        # Writes takeover marker → SIGTERM → bounded wait → SIGKILL
        # Marker lets target exit 0 (planned) not exit 1 (systemd flap loop)
```

### 6.4 Honest Durable Ack

```python
async def _classify_completion_target(self, parent_session_id) -> str:
    parent = await session_db.get_session(parent_session_id)
    if parent is None: return "terminal"            # gone → DROP
    if not parent.get("ended_at"): return "deliver"  # live
    if parent.get("end_reason") != "compression": return "terminal"
    tip = await session_db.get_session(tip_session_id)
    if tip is None or tip.get("ended_at"): return "retry"
    return "deliver"
```

- `terminal` → `drop_completion_delivery()` (never replay as pending forever)
- `retry` → `release_completion_delivery()` (bounded churn)
- `deliver` → adapter → on success `complete`, on fail `release`

Key insight: "adapter acceptance is NOT proof of delivery — inner resolver can fail closed
AFTER adapter accepted, falsely acknowledging the durable row as delivered."

### 6.5 Hard-Exit After Graceful Teardown

```python
def _exit_after_graceful_shutdown(exit_code):
    for stream in (sys.stdout, sys.stderr): stream.flush()
    remove_pid_file()
    release_gateway_runtime_lock()    # BEFORE log drain (never strand locks)
    drain_log_queue(timeout=1.0)      # bounded
    os._exit(exit_code)               # HARD EXIT — bypasses atexit
```

**Why `os._exit` not `sys.exit`**: `sys.exit` raises `SystemExit` → `Py_FinalizeEx` →
joins every non-daemon thread. A wedged ThreadPoolExecutor (LLM call blocked) blocks
interpreter finalization → supervisor can't restart gateway.

---

## 📋 7. OTHER NOTABLE FEATURES

### 7.1 Kanban Auto-Repair + WAL Checkpoint

```python
# Periodic WAL checkpoint (TRUNCATE) on dispatcher tick
conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")

# Auto-repair: only index-only integrity errors are repairable
# Quarantine backup BEFORE any mutation → REINDEX → re-check
repair_db(db_path) → RepairResult(status="ok"|"repaired"|"corrupt"|"missing")
```

### 7.2 DDGS Process Isolation (#68096)

**Problem**: `ddgs`/`primp` can block inside native code holding GIL.
`ThreadPoolExecutor + future.result(timeout)` can't fire — waiter never reacquires GIL.

**Solution**: Each search runs in **disposable child process**:
```python
proc = subprocess.Popen([sys.executable, worker_path],
    stdin=PIPE, stdout=PIPE, stderr=DEVNULL,
    start_new_session=True)  # own session → reap hung grandchild
# Poll deadline + interrupt → terminate child → unblocks communicate thread
```

### 7.3 Slack Block Kit Clarify

`send_clarify(chat_id, question, choices, clarify_id, ...)` renders multi-choice
as tappable buttons. Button taps route to `clarify_gateway.resolve_gateway_clarify`.

Thread context rehydration: reads from attachments + blocks + fetched thread context.
Socket Mode ping/pong staleness healing.

### 7.4 Subagent execute_code (#69325)

Subagents can now use `execute_code` — previously blocked.

### 7.5 Battery Status

```python
@dataclass(frozen=True)
class BatteryStatus:
    available: bool
    percent: Optional[int] = None    # clamped 0-100
    plugged: Optional[bool] = None
# Memoizes for a few seconds (status bar repaints every keystroke)
```

---

## 🎯 PORTING PRIORITY FOR MYA

### Tier 1 — High Impact, Low Risk
1. **CJK token estimation** (ASCII fast path) → `packages/core/src/time.ts` area
2. **MCP reconnect budget + park failures** → `packages/gateway/src/mcp-client.ts`
3. **MCP failure classification** (permanent vs transient) → same file
4. **DDGS process isolation pattern** → `packages/tools/src/web/`
5. **Hard-exit pattern** → gateway shutdown

### Tier 2 — High Impact, Medium Effort
6. **Idle compaction predicate** → context engine
7. **Per-model threshold override** (longest substring match)
8. **External-content FTS5** → `packages/memory/src/sqlite-*`
9. **CJK bigram tokenizer** (port C file + build step)
10. **Compaction handoff** (preserve latest user turn + SUMMARY_PREFIX)
11. **Strict redaction at compaction boundaries**

### Tier 3 — Architectural Reference
12. **Widget grid SDK** (for future TUI dashboard)
13. **Theme seed→derived ladder** (for theme system)
14. **Secrets management** (if enterprise secrets needed)
15. **Gateway stale lock detection** (5-point identity + tombstone rename)
16. **Honest durable ack** (claim/complete/release/drop lifecycle)

### Tier 4 — Nice-to-Have
17. Kanban REINDEX auto-repair
18. Revision-aware reload (mcp_rev leader/follower)
19. Platform-lock takeover
20. Battery status bar

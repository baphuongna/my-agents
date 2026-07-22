# Hermes Agent — Deep-Dive Round 2: Implementation-Level Analysis

**6 parallel explorer agents** đọc source code trực tiếp, đến từng dòng.
Phân tích đủ chi tiết để port sang TypeScript/napi-rs.

---

## 🔥 1. CJK FTS5 BIGRAM TOKENIZER — Line-by-Line C Code

**File:** `native/fts5_cjk/fts5cjk.c` (235 lines) + `build.sh` (5 lines)

### 1.1 The `SELECT fts5(?)` API Discovery Trick

```c
static fts5_api *cjkFts5Api(sqlite3 *db) {
    fts5_api *pRet = 0;
    sqlite3_stmt *pStmt = 0;
    if (sqlite3_prepare_v2(db, "SELECT fts5(?1)", -1, &pStmt, 0) == SQLITE_OK) {
        sqlite3_bind_pointer(pStmt, 1, (void*)&pRet, "fts5_api_ptr", 0);
        sqlite3_step(pStmt);
    }
    sqlite3_finalize(pStmt);
    return pRet;
}
```

`fts5(?1)` là scalar function registered bởi FTS5 module. Khi SQLite gọi nó, inspect argument 1: nếu là bound pointer type `"fts5_api_ptr"`, writes live `fts5_api*` vào pointer location đó. Side-effect during `sqlite3_step`.

### 1.2 Callback Inversion — Delegating to unicode61

```c
static int cjkTokenize(Fts5Tokenizer *pTok, void *pCtx, int flags,
                       const char *pText, int nText,
                       int (*xToken)(void*, int, const char*, int, int, int)) {
    CjkCallbackCtx cb;
    cb.pOuterCtx = pCtx;        // original FTS5 context
    cb.xOuterToken = xToken;    // original FTS5 callback
    // Call unicode61's tokenize with OUR callback → unicode61 calls cjkInnerCallback
    return p->inner.xTokenize(p->pInner, &cb, flags, pText, nText, cjkInnerCallback);
}
```

**Inversion-of-control pivot**: FTS5 hands you `xToken`; you swap in `cjkInnerCallback`.
unicode61 does ALL segmentation/case-folding/diacritics. This layer only post-processes.

### 1.3 The Bigram Emission Algorithm (Rolling Window)

```c
// CJK run: collect char byte-boundaries, emit overlapping bigrams
int bounds[3];               // rolling window: start, mid, end
bounds[0] = segStart;
bounds[1] = segStart + len;
int nChars = 1;
while (i < nToken) {
    int l2 = cjk_utf8_decode(z + i, nToken - i, &cp);
    if (!cjk_is_cjk(cp)) break;
    i += l2;
    nChars++;
    if (nChars >= 2) {
        bounds[2] = i;
        // Emit bigram [bounds[0], bounds[2])
        xOuterToken(ctx, tflags, pToken + bounds[0], bounds[2] - bounds[0], ...);
        bounds[0] = bounds[1];   // slide window
        bounds[1] = bounds[2];
    }
}
if (nChars == 1) {
    // Lone CJK char: emit as unigram
    xOuterToken(ctx, tflags, pToken + segStart, bounds[1] - segStart, ...);
}
```

**Concrete example**: `캘린더` (3 Hangul syllables, each 3 bytes UTF-8):
- Iteration 1: `nChars=2`, bounds={0,3,6} → emit `캘린` (offsets [0,6))
- Iteration 2: `nChars=3`, bounds={3,6,9} → emit `린더` (offsets [3,9))
- Result: `{캘린, 린더}` → query for `린더` hits index directly

**Lucene CJKAnalyzer/CJKBigramFilter semantics exactly.** N-1 bigrams for N-char run.

### 1.4 CJK Codepoint Ranges (13 ranges)

```c
static int cjk_is_cjk(unsigned int cp) {
    return (cp >= 0xAC00 && cp <= 0xD7A3)   // Hangul syllables
        || (cp >= 0x1100 && cp <= 0x11FF)   // Hangul Jamo
        || (cp >= 0x3130 && cp <= 0x318F)   // Hangul compat Jamo
        || (cp >= 0xA960 && cp <= 0xA97F)   // Hangul Jamo ext-A
        || (cp >= 0xD7B0 && cp <= 0xD7FF)   // Hangul Jamo ext-B
        || (cp >= 0x4E00 && cp <= 0x9FFF)   // CJK unified ideographs
        || (cp >= 0x3400 && cp <= 0x4DBF)   // CJK ext A
        || (cp >= 0xF900 && cp <= 0xFAFF)   // CJK compat ideographs
        || (cp >= 0x20000 && cp <= 0x2FA1F) // CJK ext B-F + compat supp
        || (cp >= 0x3040 && cp <= 0x309F)   // Hiragana
        || (cp >= 0x30A0 && cp <= 0x30FF)   // Katakana
        || (cp >= 0x31F0 && cp <= 0x31FF);  // Katakana phonetic ext
}
```

**Absent**: CJK punctuation (U+3000-303F), fullwidth Latin (U+FF00-FFEF) — get unicode61 treatment.

### 1.5 Fast Path (All-Latin)

```c
int hasCjk = 0;
while (i < nToken) {
    unsigned int cp;
    i += cjk_utf8_decode(z + i, nToken - i, &cp);
    if (cjk_is_cjk(cp)) { hasCjk = 1; break; }  // single scan, break on first CJK
}
if (!hasCjk) {
    return p->xOuterToken(p->pOuterCtx, tflags, pToken, nToken, iStart, iEnd);
    // ZERO allocations, ZERO copies for Latin tokens
}
```

### 1.6 Porting to napi-rs

- **Algorithm = ~80 lines**: `cjk_is_cjk`, `cjk_utf8_decode` (or Rust native), fast-path scan, rolling bigram loop, lone-char unigram
- **Option A** (simplest): Pure Rust `tokenize(text) → Array<{token, start, end}>` — no SQLite plumbing
- **Option B**: Full Rust SQLite loadable extension via `libsqlite3-sys` — keeps `SELECT fts5(?)` trick
- **CJK range parity critical**: any divergence = silent index/query mismatch

---

## 🔥 2. CONTEXT COMPRESSOR — Full compress() Algorithm

**File:** `agent/context_compressor.py` (4,607 lines)

### 2.1 Key Constants

```python
_MIN_SUMMARY_TOKENS = 2000
_SUMMARY_RATIO = 0.20
_SUMMARY_TOKENS_CEILING = 10_000
_SUMMARY_FAILURE_COOLDOWN_SECONDS = 600
_FALLBACK_SUMMARY_MAX_CHARS = 8_000
_SMALL_CTX_WINDOW_LIMIT = 512_000
_SMALL_CTX_THRESHOLD_PERCENT = 0.75
_MIN_CTX_TRIGGER_RATIO = 0.85
COMPRESSED_SUMMARY_METADATA_KEY = "_compressed_summary"
```

### 2.2 compress() — 5-Phase Flow

```
Phase 0: Reset state + telemetry. If force → clear failure cooldown.
         Min-size guard: n_messages <= head_size + 4 → bump ineffective count, return

Phase 1: Cheap pre-pass (NO LLM):
         - _prune_old_tool_results() → dedup + summarize + truncate
         - Strip blank platform-echo user rows after latest actionable user turn

Phase 2: Boundaries:
         compress_start = protect_head_size → align_forward (skip orphan tools)
         compress_end = find_tail_cut_by_tokens (backward walk, soft_ceiling = budget*1.5)
         If cut lands ON latest user message → bridge adjustment

Phase 3: Generate summary:
         summary = _generate_summary(turns_to_summarize, focus_topic, memory_context)
         Abort guard: auth/network failure → roll back, return unchanged
         Fallback: _build_static_fallback_summary() (template-based, no LLM)

Phase 4: Assembly:
         compressed = head[0:compress_start] + summary_msg + tail[compress_end:]
         Role selection (avoid consecutive same-role)
         _sanitize_tool_pairs() + _strip_historical_media() + _strip_persistence_markers()
```

### 2.3 _prune_old_tool_results() — 3 Passes (NO LLM)

```python
# Walk backward with token budget + count floor
for i in range(len(result)-1, -1, -1):
    msg_tokens = _estimate_msg_budget_tokens(result[i])
    if accumulated + msg_tokens > protect_tail_tokens and count >= min_protect:
        boundary = i; break
    accumulated += msg_tokens

# Pass 1: Deduplicate identical tool results (md5 hash, >200 chars)
#         Older dupes → "[Duplicate tool output — same content as a more recent call]"

# Pass 2: Replace each tool result >200 chars with 1-line summary
#         "[terminal] ran `npm test` -> exit 0, 47 lines output"

# Pass 3: Truncate assistant tool_calls[].arguments JSON >500 chars
#         Parse JSON → shrink string leaves to 200 chars → re-serialize
#         (MUST parse+re-serialize, not raw slice — providers 400 on invalid JSON)
```

### 2.4 Summary Prompt — Structured Template + Rolling Update

**First compaction:**
```
TURNS TO SUMMARIZE: {content}
{memory_context}

Create a structured checkpoint summary using these sections:
## Historical Task Snapshot
## Goal
## Constraints & Preferences
## Completed Actions
## Active State
## Historical In-Progress State
## Blocked
## Key Decisions
## Resolved Questions
## Historical Pending User Asks
## Relevant Files
## Historical Remaining Work
## Critical Context

Target ~{summary_budget} tokens
```

**Iterative update (re-compaction):**
```
PREVIOUS SUMMARY: {previous_summary}
NEW TURNS TO INCORPORATE: {content}

PRESERVE all existing information...
ADD new completed actions...
Move items In Progress → Completed...
CRITICAL: Update ## Active Task to reflect user's most recent input...
```

### 2.5 Role Selection — Avoid Consecutive Same-Role

```python
last_head_role = compressed[-1].get("role") if compressed else "user"
first_tail_role = tail[0].get("role") if tail else None

_force_user_leading = (compress_start == 0 or last_head_role == "system")
# Anthropic/Bedrock need user-first

# Zero-user guard (#58753): force user if NO user-role survives head+tail
if not _force_user_leading and no_user_survives:
    _force_user_leading = True

if last_head_role in {"assistant","tool"} or _force_user_leading:
    summary_role = "user"
else:
    summary_role = "assistant"

# Flip if collides with tail (only when flip doesn't collide with head)
if summary_role == first_tail_role and flip_safe:
    summary_role = flipped
elif both_collide:
    _merge_summary_into_tail = bool(tail_messages)
```

### 2.6 Tail Boundary — Backward Walk with Floors

```python
min_tail_floor = max(3, min(protect_last_n, _MAX_TAIL_MESSAGE_FLOOR))  # 8
soft_ceiling = token_budget * 1.5

for i in range(n-1, head_end-1, -1):
    msg_tokens = _estimate_msg_budget_tokens(messages[i])
    if accumulated + msg_tokens > soft_ceiling and (n - i) >= min_tail:
        break
    accumulated += msg_tokens; cut_idx = i

# Align: don't split tool group
cut_idx = align_backward(messages, cut_idx)     # pull before parent assistant(tool_calls)
cut_idx = ensure_last_user_message_in_tail(...)  # #10896 — never roll latest user into summary
cut_idx = ensure_last_assistant_message_in_tail(...)  # #29824
cut_idx = align_forward(messages, max(cut_idx, head_end + 1))
```

### 2.7 Anti-Thrashing — Provider-Verified, NOT Estimate-Based

```python
# should_compress() uses rough estimate for preflight
def should_compress(self, prompt_tokens=None):
    tokens = prompt_tokens if prompt_tokens is not None else self.last_prompt_tokens
    if tokens < self.threshold_tokens: return False
    return not self._automatic_compression_blocked()

# BUT the anti-thrashing verdict lives in update_from_response()
# against the PROVIDER'S REAL prompt count after compaction
def update_from_response(self, response_tokens):
    if response_tokens >= self.threshold_tokens:  # still over after compaction!
        self._ineffective_compression_count += 1
```

**Why not estimate-based**: Rough preflight estimates would reset the strike every turn.

---

## 🔥 3. SLACK INTEGRATION — Thread Lifecycle + Socket Mode

### 3.1 Block Kit Clarify — Multi-Choice Buttons

```python
async def send_clarify(self, chat_id, question, choices, clarify_id, ...):
    elements = []
    for idx, choice in enumerate(choices):
        elements.append({
            "type": "button",
            "text": {"type": "plain_text", "text": label[:75], "emoji": True},
            "action_id": f"hermes_clarify_choice_{idx}",
            "value": f"{clarify_id}|{idx}",  # packs clarify_id|idx
        })
    elements.append({  # trailing free-text button
        "type": "button", "text": "✏️ Other…",
        "action_id": "hermes_clarify_other",
        "value": f"{clarify_id}|other",
    })
    blocks = [{"type": "section", "text": {"type": "mrkdwn", "text": body}}]
    for start in range(0, len(elements), 5):  # chunk ≤5 per actions block
        blocks.append({"type": "actions", "elements": elements[start:start+5]})
```

**Double-click guard**: `_clarify_resolved.pop(msg_ts, True)` — first caller gets `False` and proceeds.

### 3.2 Thread Context Rehydration — 4-Way Branch

```
a) Cold start: full _fetch_thread_context (limit=30), set watermark
b) Active session + @mention: fetch only delta past watermark (force_refresh=True)
c) Restart rehydration: active session, first ordinary reply this process
   → inject missed replies (persisted watermark survives restart)
d) Block-Kit-only mention: _collect_slack_block_mentions walks blocks,
   ignores mentions inside rich_text_quote (can't trick via quoted content)
```

### 3.3 Socket Mode Healing — Ping/Pong Staleness

```python
def _socket_ping_pong_stale(self) -> bool:
    client = self._handler.client
    ping_interval = client.ping_interval
    last = client.last_ping_pong_time
    if last is None:  # no ping yet
        grace = max(60.0, ping_interval * 2)
        return (time.monotonic() - started_monotonic) > grace
    return (time.time() - last) > (ping_interval * 4)  # factor=4
```

Watchdog polls every interval, restarts on: task missing/done, `is_connected()=False`, or stale ping/pong.

### 3.4 Bot Identity Grounding

```python
def _build_identity_prompt(self, team_id="") -> str:
    return (f'You are connected to this Slack workspace as the bot "@{name}". ... '
            f'Only treat a message as directed at you when it mentions "@{name}" '
            f'specifically; a mention of any other participant is not a mention of you, '
            f'even if their name is similar.')
```

Ephemeral per-turn `channel_prompt` (never persisted to history → doesn't break prompt caching).

---

## 🔥 4. PROVIDER ROUTING — Sticky Sessions + Route Identity

### 4.1 Sticky session_id Injection

```python
# OpenRouter / Nous Portal:
def build_extra_body(self, *, session_id=None, **context):
    body = {}
    if session_id:
        body["session_id"] = session_id  # top-level sticky routing key
    return body

# Merged into api_kwargs["extra_body"] → appears as top-level JSON field
```

**Purpose**: Pin every turn to same upstream endpoint so Anthropic `cache_control` breakpoints stay warm.

### 4.2 Route URL Identity — normalize_route_base_url

```python
def normalize_route_base_url(base_url):
    # Scheme: lowercased
    # Hostname: lowercased
    # Port: default 80/443 stripped, non-default preserved
    # Userinfo (user:pass@): PRESERVED (route change!)
    # Query params: PRESERVED (route change!)
    # Trailing slash: ONLY ONE stripped
    # Control/whitespace chars: FAIL CLOSED (return raw → mismatch)
```

### 4.3 Fail-Closed Context Pin Clearing

```python
def _context_route_mismatch(configured, active, ...):
    configured_route = normalize_route_base_url(configured)
    active_route = normalize_route_base_url(active)
    if configured_route:
        return configured_route != active_route  # URL comparison wins
    # No URL → provider identity comparison
    return bool(configured_provider and active_provider
                and configured_provider != active_provider)

def should_clear_context_pin(...):
    try:
        return _context_route_mismatch(...)
    except Exception:
        return True  # FAIL CLOSED on any error
```

---

## 🔥 5. CODEX INTEGRATION — OAuth Context + Auto-Raise + Compaction

### 5.1 OAuth Context Window — Credential-Scoped Cache

```python
_codex_oauth_context_cache: Dict[str, Tuple[Dict[str, int], float]] = {}
_CODEX_OAUTH_CONTEXT_CACHE_TTL = 3600  # 1 hour

def _codex_oauth_token_fingerprint(access_token):
    return hashlib.sha256(access_token.encode()).hexdigest()[:16]
    # Raw token NEVER in cache key

# Live probe: chatgpt.com/backend-api/codex/models
# Headers: Authorization: Bearer + ChatGPT-Account-Id
# Only "live" values eligible for persistent writes
# Fallback table is runtime-only (transient OAuth failure can't poison future probes)
```

### 5.2 Auto-Raise Threshold — 85% for gpt-5.4/5.5

```python
_CODEX_GPT54_GPT55_COMPACTION_THRESHOLD = 0.85
_CODEX_SPARK_COMPACTION_THRESHOLD = 0.70

def _compression_threshold_for_model(model, provider, *, allow_autoraise=True):
    if _is_codex_gpt54_or_gpt55(model, provider):  # provider must be "openai-codex"
        return 0.85
    if _is_codex_spark(model, provider):  # 128K native window
        return 0.70
    return None

# Autoraise NEVER LOWERS a higher user-configured threshold
def _resolve_compression_threshold(global_threshold, model_threshold, *, is_codex_autoraise):
    if model_threshold is None:
        return global_threshold, None
    if is_codex_autoraise:
        if model_threshold <= global_threshold + 1e-9:
            return global_threshold, None  # keep user's higher threshold
        return model_threshold, notice
    return model_threshold, None
```

### 5.3 Responses API — Preserve Compaction Summaries on Auto-Truncate

```python
def _auto_truncate_response_history(history, *, limit=100):
    summary_indices = [i for i, msg in enumerate(history)
                       if _is_compressed_summary_message(msg)]
    if not summary_indices:
        return history[-limit:]  # simple tail slice

    # Preserve ALL compaction summaries, fill remaining with most-recent
    kept = set(summary_indices[:limit])
    remaining = limit - len(kept)
    for i in range(len(history)-1, -1, -1):
        if i not in summary_index_set:
            kept.add(i); remaining -= 1
            if remaining <= 0: break
    return [history[i] for i in sorted(kept)]
```

### 5.4 App-Server Notification Scoping — Thread/Turn Identity

```python
def _notification_belongs_to_turn(note, *, thread_id, turn_id) -> bool:
    observed_thread, observed_turn = _notification_scope_ids(note)
    if thread_id and observed_thread and str(observed_thread) != str(thread_id):
        return False  # foreign child thread
    if turn_id and observed_turn and str(observed_turn) != str(turn_id):
        return False  # stale turn
    return True

# thread/compact/start returns NO turn_id
# → ignore ALL terminal/projectable events until turn/started arrives
# → then filter every notification through _notification_belongs_to_turn
```

---

## 🔥 6. CURATOR + HOLOGRAPHIC MEMORY

### 6.1 Curator — Idle-Gated Background Consolidation

```python
DEFAULT_MIN_IDLE_HOURS = 2      # Only enforced when caller provides idle_for_seconds
DEFAULT_INTERVAL_HOURS = 7 * 24 # Static gate: last_run older than 7 days
DEFAULT_CONSOLIDATE = False     # LLM umbrella-building OFF by default

def maybe_run_curator(*, idle_for_seconds=None, on_summary=None):
    if not should_run_now(): return None
    if idle_for_seconds is not None:
        if idle_for_seconds < get_min_idle_hours() * 3600: return None
    return run_curator_review(on_summary=on_summary)
    # (1) apply_automatic_transitions: deterministic prune (stale 30d, archive 90d)
    # (2) OPTIONAL LLM umbrella pass (OFF by default)
```

### 6.2 Holographic Memory — FTS5 OR-Expansion

```python
_FTS_STOPWORDS = frozenset({"a","about","the","is",...})  # ~125 words

@classmethod
def _sanitize_fts_query(cls, query):
    tokens = []
    for raw in query.lower().split():
        cleaned = raw.strip(".,;:!?\"'()[]{}#@<>")
        if len(cleaned) < 2: continue
        if cleaned in cls._FTS_STOPWORDS: continue
        tokens.append(f'"{cleaned}"')  # phrase-literal each token
    return " OR ".join(tokens) if tokens else query
```

**Hybrid ranking**: `relevance = fts_weight*fts + jaccard_weight*jaccard + hrr_weight*hrr_sim`
`score = relevance * trust_score`, optional temporal decay.

HRR = holographic reduced representations: phase-vector algebra (encode=SHA-256, bind=phase add, bundle=circular mean, similarity=phase cosine).

### 6.3 Preventing Compaction Summary Harvesting

```python
from agent.context_compressor import is_compaction_summary_message

for msg in messages:
    if msg.get("role") != "user": continue
    pre_delimiter = _pre_delimiter_user_segment(msg)
    if pre_delimiter is not None:
        content = pre_delimiter  # merged-into-tail: keep genuine pre-delimiter part
    elif is_compaction_summary_message(msg):
        continue  # skip pure summary — don't store as durable "fact"
    else:
        content = msg.get("content")
    # match patterns → store.add_fact(content[:400], category=...)
```

---

## 📊 PORTING IMPACT MATRIX

| Feature | Lines to Port | Difficulty | mya Impact | Priority |
|---------|--------------|------------|------------|----------|
| CJK token estimator | ~20 | Trivial | High | P0 |
| CJK bigram tokenizer | ~80 (C→Rust) | Medium | High | P1 |
| MCP reconnect budget | ~100 | Medium | High | P0 |
| MCP failure classification | ~50 | Easy | High | P0 |
| Idle compaction predicate | ~30 | Trivial | High | P1 |
| Per-model threshold (substring) | ~20 | Trivial | Medium | P1 |
| External-content FTS5 | SQL DDL | Easy | High | P1 |
| Tool-row-free trigram | SQL view | Easy | Medium | P2 |
| compress() main flow | ~500 | Hard | High | P2 |
| _prune_old_tool_results | ~150 | Medium | Medium | P2 |
| Summary prompt template | ~100 | Easy | Medium | P2 |
| Strict redaction | ~200 | Medium | High | P1 |
| Compaction handoff | ~100 | Medium | Medium | P2 |
| DDGS process isolation | ~100 | Medium | Medium | P2 |
| Hard-exit pattern | ~30 | Trivial | Medium | P1 |
| Widget grid SDK | ~500 | Hard | Low (future) | P3 |
| Theme seed→ladder | ~300 | Hard | Low (future) | P3 |
| Slack Block Kit clarify | ~200 | Medium | Low | P3 |
| Sticky session_id | ~50 | Easy | Medium | P2 |
| Route URL identity | ~80 | Easy | Medium | P2 |
| Provider auto-raise | ~50 | Easy | Low | P3 |

**Total estimated porting**: ~2,500 lines of TypeScript/Rust for P0+P1 features.

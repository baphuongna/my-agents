# mya Memory System

> SQLite-first persistent memory for the mya agent.
> Pattern: [mnemopi](https://github.com/earendil-works/oh-my-pi/tree/main/packages/mnemopi) (oh-my-pi).

## Overview

mya remembers what you tell it — across sessions, across restarts. The memory
system is **disk-primary** (SQLite), not RAM-primary. Every fact lives in a
SQLite database on disk, indexed by FTS5 for instant full-text search.

```
~/.mya/memory/
  memory.db       ← SQLite database (WAL mode)
  memory.db-wal   ← write-ahead log
  memory.db-shm   ← shared memory
```

### Design principles

1. **SQLite IS the store** — no RAM cache, no separate index. SQLite FTS5
   provides BM25 ranking natively. Reads go to disk (fast with WAL + page cache).
2. **Two-tier capture** — automatic pattern-based extraction (always-on safety
   net) + explicit `remember` tool (LLM-driven, high-confidence facts).
3. **Two-tier consolidation** — shallow lifecycle on every turn + deep
   DreamCycle every 4 hours or on-demand via `/dream`.
4. **Per-type temporal decay** — 21 memory types, each with its own Weibull
   decay curve. Preferences persist 6 months; requests decay in 3 days.
5. **Zero dependencies** — uses Node 22's built-in `node:sqlite` with FTS5.
   No `better-sqlite3`, no native addons, no external services.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  TUI Session (mya)                                              │
│                                                                 │
│  ┌─ before_agent_start ──────────────────────────────────────┐ │
│  │  recall(prompt)                                           │ │
│  │  ├─ FTS5 BM25 search (working + episodic)                │ │
│  │  ├─ Weibull temporal decay                                │ │
│  │  ├─ Veracity weighting                                    │ │
│  │  └─ Top 5 hits → injected into system prompt             │ │
│  └──────────────────────────────────────────────────────────┘ │
│                          ↓ LLM generates response               │
│  ┌─ message_end ─────────────────────────────────────────────┐ │
│  │  Capture assistant response text (for auto-capture)       │ │
│  └──────────────────────────────────────────────────────────┘ │
│                          ↓ turn completes                       │
│  ┌─ turn_end (3 hooks fire) ─────────────────────────────────┐ │
│  │                                                           │ │
│  │  1. AUTO-CAPTURE (always-on)                             │ │
│  │     ├─ User message: autoCapture(prompt, minConf=0.55)   │ │
│  │     └─ Assistant:    autoCapture(text,  minConf=0.85)    │ │
│  │         38 regex patterns → classify → store             │ │
│  │                                                           │ │
│  │  2. LIFECYCLE (shallow consolidation)                    │ │
│  │     ├─ consolidate: working→episodic (≥2 same type)     │ │
│  │     ├─ degrade: tier 1→2 (30d), 2→3 (180d)              │ │
│  │     └─ purge: Weibull decay < 0.1 → DELETE               │ │
│  │                                                           │ │
│  │  3. EXPLICIT REMEMBER (already stored during turn)       │ │
│  │     └─ LLM may call remember tool mid-turn               │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌─ DreamCycle timer (every 4h when idle) ───────────────────┐ │
│  │  DEEP CONSOLIDATION                                      │ │
│  │  ├─ collect: recent working_memory (last 4h)             │ │
│  │  ├─ summarize: LLM (optional) or zero-LLM digest         │ │
│  │  ├─ store: dream summary → episodic_memory               │ │
│  │  └─ lifecycle()                                          │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌─ /dream slash command ────────────────────────────────────┐ │
│  │  On-demand deep consolidation (same as timer, manual)     │ │
│  └──────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────────┐
│  SQLite (~/.mya/memory/memory.db)                               │
│                                                                 │
│  L0: working_memory  ← auto-capture + remember tool             │
│      fts_working     ← FTS5 BM25 index (content || embed_text)  │
│                                                                 │
│  L1: episodic_memory ← consolidated summaries + dream cycles    │
│      fts_episodes    ← FTS5 BM25 index                          │
│                                                                 │
│  L2: facts           ← structured (subject, predicate, object)  │
│      triples         ← RDF-like knowledge graph                 │
│      fts_facts       ← FTS5 BM25 index                          │
│                                                                 │
│  consolidation_log   ← audit trail of consolidation batches     │
└─────────────────────────────────────────────────────────────────┘
```

---

## Capture: how memories get stored

### Layer 1: Auto-capture (always-on)

Every `turn_end`, the user prompt and assistant response are scanned by
**38 regex patterns** that detect memory-worthy statements.

**File:** `packages/memory/src/auto-capture.ts`

| Pattern type | Example regex | Confidence | Example match |
|---|---|---|---|
| `preference` | `\b(i prefer\|my favorite)\b` | 0.85–0.95 | "I prefer Rust" |
| `decision` | `\b(i decided\|going with)\b` | 0.75–0.9 | "I decided to use LSM trees" |
| `commitment` | `\b(i will\|deadline\|due by)\b` | 0.75–0.85 | "deadline is next Friday" |
| `goal` | `\b(my goal\|trying to)\b` | 0.65–0.9 | "trying to build a cache" |
| `context` | `\b(i'm currently\|working on)\b` | 0.55–0.8 | "I'm building TurboCache" |
| `fact` | `\b(my name is\|i work at)\b` | 0.8–0.9 | "I'm a backend developer" |
| `learning` | `\b(i learned\|turns out)\b` | 0.75–0.85 | "turns out the bug was..." |
| `error` | `\b(this is broken\|the bug is)\b` | 0.7–0.8 | "this crashes on startup" |
| `relationship` | `\b(manages\|reports to)\b` | 0.8–0.85 | "Alice manages the team" |
| `instruction` | `\b(always do\|never use)\b` | 0.7–0.8 | "always run tests first" |

**Noise filters (prevent false positives):**
- Questions (`?`) are excluded
- Chitchat (`hi`, `thanks`, `great`, `ok`, `sure`) is excluded
- Interrogatives (`what`, `how`, `why`, `do you`) are excluded
- Sentences < 15 chars or > 500 chars are excluded

**Deduplication:** Each sentence is SHA-256 hashed. The hash is stored in
`metadata_json.captureHash`. If the same sentence appears again, it's skipped.

**Confidence thresholds:**
- User messages: `minConfidence = 0.55` (captures most real statements)
- Assistant messages: `minConfidence = 0.85` (very conservative — prevents
  echoing user's words back as "memories")

### Layer 2: Explicit `remember` tool (LLM-driven)

The LLM can call the `remember` tool to store high-importance facts it
identifies during conversation.

```
Tool: remember
Parameters:
  content:   "Alice is a senior engineer who loves Rust"
  entity:    "alice"           (subject/topic)
  kind:      "fact"             (event|preference|commitment|belief|fact)
  visibility: "private"         (private|world)
```

Stored with `importance = 0.7`, `veracity = "unknown"`, `source = "tui"`.

### Storage format

```sql
INSERT INTO working_memory (
  id, content, source, timestamp, session_id,
  importance, metadata_json, veracity, memory_type
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
```

| Field | Auto-captured | Explicit remember |
|---|---|---|
| `source` | `auto:user` / `auto:assistant` | `tui` |
| `importance` | 0.4–0.54 (confidence × 0.6) | 0.7 |
| `veracity` | `inferred` | `unknown` |
| `memory_type` | detected by pattern (e.g. `preference`) | from tool `kind` |
| `metadata_json` | `{captureHash, captureConfidence, autoCaptured}` | `{}` |

---

## Recall: how memories are retrieved

**File:** `packages/memory/src/sqlite-recall.ts`

### Pipeline

```
User prompt: "What programming language do I prefer?"
     │
     ├─ 1. Sanitize query → FTS5-compatible tokens
     │     "programming language prefer"
     │
     ├─ 2. FTS5 BM25 search (working_memory)
     │     SELECT bm25(fts_working) FROM fts_working
     │     WHERE fts_working MATCH ?
     │       AND superseded_by IS NULL
     │       AND (valid_until IS NULL OR valid_until > now)
     │     ORDER BY bm25_rank LIMIT 10
     │
     ├─ 3. FTS5 BM25 search (episodic_memory)
     │     Same query against fts_episodes
     │
     ├─ 4. Compose score for each hit:
     │     score = exp(bm25) × 0.5     ← relevance (normalized to [0,1])
     │           + importance × 0.2     ← user/system importance
     │           + temporal × 0.2       ← Weibull recency boost
     │           + veracity × 0.1       ← trust weighting
     │
     ├─ 5. Sort by composed score, take top 5
     │
     └─ 6. Inject into system prompt:
           "## Relevant memories
            - [working] I prefer Rust for systems programming"
```

### Score formula

```typescript
function composeScore(bm25Rank, importance, temporalBoost, veracity): number {
  const normalizedBm25 = Math.exp(bm25Rank); // [-inf,0] → [0,1]
  return normalizedBm25 * 0.5
       + importance     * 0.2
       + temporalBoost  * 0.2
       + veracity       * 0.1;
}
```

| Component | Weight | Source |
|---|---|---|
| BM25 relevance | 50% | FTS5 `bm25()` function, exponential-normalized |
| Importance | 20% | `importance` column (0.0–1.0) |
| Temporal boost | 20% | Weibull decay based on `memory_type` + age |
| Veracity | 10% | trust level (stated=1.0, inferred=0.7, false=0.0) |

### Weibull temporal decay

**File:** `packages/memory/src/weibull.ts`

Each memory type has a Weibull decay curve `W(t) = exp(-(t/η)^k)`:

| Type | k (shape) | η (scale, hours) | Effective half-life | Use case |
|---|---|---|---|---|
| `profile` | 0.3 | 8760 | ~1 year | "I'm a developer" |
| `preference` | 0.4 | 4380 | ~6 months | "I prefer Rust" |
| `relationship` | 0.35 | 8760 | ~1 year | "Alice manages Bob" |
| `fact` | 0.8 | 720 | ~30 days | "API endpoint is /v2" |
| `decision` | 1.0 | 336 | ~14 days | "decided to use LSM trees" |
| `context` | 0.85 | 360 | ~15 days | "currently building X" |
| `goal` | 0.9 | 720 | ~30 days | "ship v1 by August" |
| `commitment` | 1.0 | 240 | ~10 days | "deadline next Friday" |
| `event` | 1.2 | 168 | ~7 days | "meeting with Alice" |
| `error` | 1.1 | 336 | ~14 days | "bug in auth module" |
| `request` | 1.5 | 72 | ~3 days | "send report by EOD" |
| `general` | 1.0 | 168 | ~7 days | fallback |

### Veracity weights

| Veracity | Weight | Meaning |
|---|---|---|
| `stated` | 1.0 | User explicitly stated this |
| `true` | 1.0 | Verified as true |
| `likely_true` | 1.0 | High confidence |
| `unknown` | 0.8 | Default (explicit remember) |
| `inferred` | 0.7 | Auto-captured from conversation |
| `imported` | 0.6 | Migrated from old system |
| `tool` | 0.5 | Generated by a tool |
| `false` | 0.0 | Marked as incorrect (never recalled) |

---

## Lifecycle: consolidation, degradation, purge

**File:** `packages/memory/src/sqlite-consolidate.ts`

Runs on every `turn_end` (shallow) and every 4 hours / `/dream` (deep).

### 1. Consolidation (working → episodic)

Groups unconsolidated `working_memory` entries by `(source, memory_type)`.
When a group has ≥ 2 entries, their content is concatenated into a single
`episodic_memory` record. The original entries are marked `consolidated_at`
(never deleted — kept for audit).

```sql
-- Group and batch
SELECT id, content FROM working_memory
WHERE consolidated_at IS NULL AND superseded_by IS NULL
ORDER BY source, memory_type, timestamp
LIMIT 500;

-- Batch ≥ 2 items → INSERT INTO episodic_memory
-- Mark originals: UPDATE working_memory SET consolidated_at = now
```

### 2. Tier degradation (content compression)

Episodic memories degrade through 3 tiers based on age:

| Tier | Age | Content | Purpose |
|---|---|---|---|
| 1 (fresh) | < 30 days | Full content | Recent context |
| 2 (compressed) | 30–180 days | Truncated to 800 chars | Medium-term recall |
| 3 (key-signal) | > 180 days | Truncated to 300 chars | Long-term archive |

```sql
-- Tier 1 → 2: older than 30 days
UPDATE episodic_memory SET tier = 2, content = substr(content, 1, 800)
WHERE tier = 1 AND superseded_by IS NULL
  AND timestamp < (now - 30 days) LIMIT 1000;

-- Tier 2 → 3: older than 180 days
UPDATE episodic_memory SET tier = 3, content = substr(content, 1, 300)
WHERE tier = 2 AND superseded_by IS NULL
  AND timestamp < (now - 180 days) LIMIT 1000;
```

### 3. Purge (Weibull decay)

Each memory's Weibull decay factor is computed. When it drops below 0.1
(90% decayed), the memory is deleted:

```sql
-- Purge memories where Weibull decay < 0.1
DELETE FROM working_memory WHERE weibull_factor(timestamp, memory_type) < 0.1;
DELETE FROM episodic_memory WHERE weibull_factor(timestamp, memory_type) < 0.1;
```

---

## DreamCycle: deep consolidation

**File:** `packages/memory/src/dream-cycle.ts`

### When it runs

- **Timer:** every 4 hours when the session is idle (timer is `unref`'d —
  never keeps the process alive)
- **On-demand:** `/dream` slash command (user or LLM triggers manually)

This follows the mnemopi/agentmemory pattern: on-demand consolidation + a
long-interval fallback timer. Shallow lifecycle runs on every turn; DreamCycle
handles deeper summarization.

### What it does

```
1. COLLECT — recent unconsolidated memories from last interval
   SELECT id, content, memory_type, importance FROM working_memory
   WHERE timestamp >= (now - interval)
     AND consolidated_at IS NULL
     AND source NOT LIKE 'dream%'
   ORDER BY importance DESC LIMIT 50

2. SUMMARIZE
   ├─ If LLM provider wired: ask LLM to summarize + extract patterns
   └─ Else: deterministic digest ("Consolidated N memories [type(n), ...]")

3. STORE — dream summary → episodic_memory
   INSERT INTO episodic_memory
     content = '[Dream] <summary>',
     source = 'dream', importance = 0.6, veracity = 'inferred'

4. LIFECYCLE — consolidate + degrade + purge (same as turn_end)

5. REVIEW SKILLS — check for stale skills (>30 days unused)
   (best-effort, never blocks the dream cycle)
```

---

## SQLite schema

**File:** `packages/memory/src/sqlite-schema.ts`

### Tables

#### `working_memory` (L0 — raw facts)
```sql
CREATE TABLE working_memory (
  id              TEXT PRIMARY KEY,
  content         TEXT NOT NULL,
  embed_text      TEXT DEFAULT NULL,        -- optional embedding text
  source          TEXT DEFAULT '',           -- 'auto:user', 'tui', 'dream'
  timestamp       TEXT NOT NULL,
  session_id      TEXT DEFAULT 'default',
  importance      REAL DEFAULT 0.5,          -- 0.0–1.0
  metadata_json   TEXT DEFAULT '{}',         -- captureHash, etc.
  veracity        TEXT DEFAULT 'unknown',    -- stated|true|inferred|false
  memory_type     TEXT DEFAULT 'general',    -- drives Weibull decay
  consolidated_at TEXT,                       -- NULL = not yet consolidated
  recall_count    INTEGER DEFAULT 0,
  last_recalled   TEXT DEFAULT NULL,
  valid_until     TEXT DEFAULT NULL,          -- expiry timestamp
  superseded_by   TEXT DEFAULT NULL,          -- newer memory ID
  scope           TEXT DEFAULT 'global',
  created_at      TEXT DEFAULT (datetime('now'))
);
```

#### `episodic_memory` (L1 — consolidated summaries)
```sql
CREATE TABLE episodic_memory (
  id              TEXT PRIMARY KEY,
  content         TEXT NOT NULL,
  source          TEXT DEFAULT '',
  timestamp       TEXT NOT NULL,
  session_id      TEXT DEFAULT 'default',
  importance      REAL DEFAULT 0.5,
  summary_of      TEXT,                       -- consolidated from working_memory
  veracity        TEXT DEFAULT 'unknown',
  tier            INTEGER DEFAULT 1,          -- 1=fresh, 2=compressed, 3=archived
  memory_type     TEXT DEFAULT 'general',
  superseded_by   TEXT DEFAULT NULL,
  scope           TEXT DEFAULT 'global'
);
```

#### `facts` + `triples` (L2 — structured knowledge)
```sql
CREATE TABLE facts (
  fact_id     TEXT PRIMARY KEY,
  subject     TEXT NOT NULL,
  predicate   TEXT NOT NULL,
  object      TEXT NOT NULL,
  confidence  REAL DEFAULT 0.5,
  session_id  TEXT DEFAULT 'default',
  source      TEXT DEFAULT '',
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE triples (
  subject     TEXT NOT NULL,
  predicate   TEXT NOT NULL,
  object      TEXT NOT NULL,
  metadata    TEXT DEFAULT '{}',
  PRIMARY KEY (subject, predicate, object)
);
```

### FTS5 virtual tables (3)

```sql
-- Working memory: standalone, id-keyed (content || embed_text)
CREATE VIRTUAL TABLE fts_working USING fts5(
  content, id UNINDEXED, tokenize = 'porter unicode61'
);
-- Trigger: AFTER INSERT/UPDATE/DELETE ON working_memory

-- Episodic: content-synced, rowid-keyed
CREATE VIRTUAL TABLE fts_episodes USING fts5(
  content, content='episodic_memory', content_rowid='rowid',
  tokenize = 'porter unicode61'
);

-- Facts: content-synced
CREATE VIRTUAL TABLE fts_facts USING fts5(
  subject, predicate, object, content='facts', content_rowid='rowid',
  tokenize = 'porter unicode61'
);
```

**Tokenizer:** `porter unicode61` — case-insensitive, Unicode-aware, Porter
stemming (so "TypeScript" matches "typescript" and "typescripts").

### Indexes (14)

```sql
idx_wm_session           ON working_memory(session_id)
idx_wm_timestamp         ON working_memory(timestamp)
idx_wm_source            ON working_memory(source)
idx_wm_unconsolidated    ON working_memory(session_id, timestamp) WHERE consolidated_at IS NULL
idx_wm_session_recall    ON working_memory(session_id, last_recalled) WHERE valid_until IS NULL
idx_em_session           ON episodic_memory(session_id)
idx_em_timestamp         ON episodic_memory(timestamp)
idx_em_tier              ON episodic_memory(tier)
idx_em_scope_imp         ON episodic_memory(scope, importance) WHERE superseded_by IS NULL
idx_facts_subject        ON facts(subject)
idx_facts_session        ON facts(session_id)
idx_triples_subject      ON triples(subject)
idx_triples_predicate    ON triples(predicate)
idx_triples_object       ON triples(object)
```

### SQLite pragmas

```sql
PRAGMA journal_mode = WAL;      -- concurrent readers + single writer
PRAGMA synchronous = NORMAL;    -- safe with WAL, faster than FULL
PRAGMA foreign_keys = ON;       -- enforce FK constraints
PRAGMA busy_timeout = 5000;     -- 5s timeout for write contention
PRAGMA temp_store = MEMORY;     -- temp tables in RAM
```

---

## Slash commands

| Command | Description |
|---|---|
| `/dream` | Run dream cycle (on-demand deep consolidation) |
| `/memory` | Show memory statistics (record counts, DB size) |
| `/remember` | (LLM tool) Store a fact explicitly |

---

## Migration from old system

**File:** `packages/memory/src/migrate.ts`

On startup, `migrateOldMemory()` runs (idempotent). It imports:

- `~/.mya/memory/brain.jsonl` → `working_memory` (skips if SQLite already has records)
- `~/.mya/memory/archivist.md` → `working_memory` (parsed as facts)

Migration is **idempotent** — safe to run multiple times. Uses `INSERT OR IGNORE`
for first-wins deduplication by content hash.

---

## File map

```
packages/memory/src/
├── sqlite-db.ts          # node:sqlite wrapper (WAL, transactions, lazy load)
├── sqlite-schema.ts      # Schema init (5 tables + 3 FTS5 + 14 indexes + 9 triggers)
├── sqlite-store.ts       # CRUD: storeWorking/Episodic/Fact, markConsolidated, etc.
├── sqlite-recall.ts      # FTS5 BM25 + Weibull + veracity → recall()
├── sqlite-consolidate.ts # consolidate + degrade (1→2→3) + purge
├── sqlite-manager.ts     # SqliteMemoryManager (thin facade)
├── auto-capture.ts       # 38 regex patterns → classify + autoCapture()
├── dream-cycle.ts        # Deep consolidation (4h timer + /dream command)
├── weibull.ts            # Per-type Weibull decay curves (21 types)
├── migrate.ts            # brain.jsonl + archivist.md → SQLite
└── index.ts              # Public API exports

packages/print/src/
├── shared-instances.ts   # SqliteMemoryManager created at ~/.mya/memory/memory.db
└── mya-bridge.ts         # Hooks: before_agent_start, message_end, turn_end + /dream
```

---

## Performance

| Operation | Time | Notes |
|---|---|---|
| Recall (FTS5 + Weibull) | ~2ms | BM25 is native SQLite |
| Auto-capture (38 patterns) | <1ms | Regex on single sentence |
| Lifecycle (turn_end) | ~1ms | LIMIT 1000 per scan |
| DreamCycle (zero-LLM) | ~10ms | 50-item digest |
| DreamCycle (with LLM) | 1–5s | Provider call |

**Database size:** ~170KB for 10 memories. Scales linearly.

---

## Comparison with reference systems

| Feature | mnemopi | agentmemory | gbrain | **mya** |
|---|---|---|---|---|
| Store | SQLite | KV (Map→JSON) | Postgres | **SQLite** |
| Search | FTS5 ×3 | KV scan | pgvector + HNSW | **FTS5 ×3** |
| Decay | Weibull | TTL | learned weights | **Weibull** |
| Capture | MCP tool | MCP function | event hooks | **auto-capture + tool** |
| Consolidation | on-demand | on-demand | cron | **4h + on-demand** |
| Tier degradation | no | no | no | **3-tier (30d/180d)** |
| Veracity tracking | yes | no | no | **8 levels** |
| Dependencies | zero | zero | Postgres + pgvector | **zero** |

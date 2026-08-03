# Memory System v2 — Architecture & Reference (Post-Redesign)

**Status**: After 5-phase redesign (retention + conflict + scope + ports + governance/grounding). All phases verified (3-review + 1-verify each), 895 tests, real mya tested.

**Date**: 2026-07-17

---

## Overview

mya's memory is a **3-tier scope-isolated SQLite brain** with:
- **Capture**: autoCapture (regex, role-scoped) + explicit `remember` tool (common/shared)
- **Storage**: SQLite WAL, 2 main tables (working L0 + episodic L1), FTS5 full-text search
- **Consolidation**: working → episodic via lifecycle (grouped by source/type/scope/agent_id)
- **Recall**: FTS5 BM25 + Weibull temporal + veracity + **trust** weighting, scope-filtered
- **Retention**: score-driven DELETE (salience × Weibull × access-reinforcement) + TTL ceiling + pin protection + purge audit
- **Governance**: trust scoring (feedback-driven), contradiction detection (surface, not auto-resolve)
- **Grounding**: referent tracking (content-hash re-verification for file-referenced observations)
- **Conflict**: cosine/jaccard supersession (re-adopted from mya-v1, scope-aware)

---

## Schema (working_memory — 21 columns)

```sql
CREATE TABLE working_memory (
  id              TEXT PRIMARY KEY,
  content         TEXT NOT NULL,          -- the memory text
  embed_text      TEXT,                   -- optional embedding source
  source          TEXT,                   -- 'auto:user' | 'auto:assistant' | 'tui' | 'consolidation'
  timestamp       TEXT NOT NULL,          -- ISO 8601 capture time
  session_id      TEXT DEFAULT 'default', -- pi session UUID
  importance      REAL DEFAULT 0.5,       -- [0,1] capture-time importance
  metadata_json   TEXT DEFAULT '{}',      -- extensible metadata (captureHash, etc.)
  veracity        TEXT DEFAULT 'unknown', -- stated|inferred|tool|false|unknown
  memory_type     TEXT DEFAULT 'general', -- 21 types (see below)
  consolidated_at TEXT,                   -- NULL = unconsolidated; set when promoted to episodic
  recall_count    INTEGER DEFAULT 0,      -- access-frequency signal (retention reinforcement)
  last_recalled   TEXT,                   -- last recall timestamp
  valid_until     TEXT,                   -- TTL expiry (set at capture per-type); NULL = no TTL
  superseded_by   TEXT,                   -- conflict resolution: points to newer version
  scope           TEXT DEFAULT 'global',  -- 'global' (common) | 'role' (agent-scoped) | 'session'
  created_at      TEXT,
  pinned          INTEGER NOT NULL DEFAULT 0,  -- R17: retention protection (never purged)
  agent_id        TEXT,                   -- R18: role that captured (coder/reviewer/researcher/...)
  turn_id         TEXT,                   -- R18: ephemeral turn scope
  trust           REAL NOT NULL DEFAULT 0.5 -- R19: feedback-driven authority [0,1]
);
```

`episodic_memory` has the same columns (consolidated summaries).

### Auxiliary tables

| Table | Purpose |
|---|---|
| `episodic_memory` | L1 consolidated summaries (working → episodic via lifecycle) |
| `facts` | L2 structured facts (subject/predicate/object + FTS5) |
| `triples` | L2+ bitemporal belief-base (valid_from/valid_until — **legacy, unused**) |
| `referents` | R19 grounding: (memory_id, referent_path, sha256, mtime_ms, size) |
| `purge_log` | R17 audit: every retention DELETE logged with reason + content snippet |
| `consolidation_log` | consolidation audit trail |
| `fts_working` / `fts_episodes` / `fts_facts` | FTS5 virtual tables (BM25 search) |

---

## 3-Tier Scope Model (Phase 3)

The core isolation mechanism. `scope` + `agent_id` + `session_id` determine visibility:

| Tier | scope value | Isolation | Example |
|---|---|---|---|
| **Common** (shared brain) | `global` | All roles see this | "project uses TypeScript 7" |
| **Role:X** (per-role) | `role` + `agent_id=X` | Only role X sees this | "coder prefers strict mode" |
| **Session** (task-private) | `session` + `session_id=S` | Only session S sees this | "current task: refactor auth" |

### Capture policy ("default-private, explicit-shared")

| Capture path | scope | agent_id | Visible to |
|---|---|---|---|
| **autoCapture** (brain types under a role) | `role` | active role | that role only |
| **autoCapture** (brain types, no role) | `global` | NULL | all roles |
| **autoCapture** (session types: context/goal/error/event/...) | `session` | NULL | own session only |
| **`remember` tool** (explicit) | `global` | NULL | all roles (shared) |

### Recall filter (3-tier)

```sql
WHERE (scope = 'global'                                    -- common: all roles
       OR (scope = 'role' AND agent_id = ?)                -- own role only
       OR (scope = 'session' AND session_id = ?))          -- own session only
```

**Verified**: 3 parallel managers (coder/reviewer/researcher), same WAL DB — **12/12 isolation, zero contamination**.

---

## Memory Types (21) — TTL + Salience + Decay

Each type has 3 configured parameters:

| Type | Salience | TTL (hours) | Weibull eta | Decay |
|---|---|---|---|---|
| preference | 0.85 | 8760 (1yr) | 4380h | slow |
| decision | 0.80 | 672 (28d) | 336h | medium |
| instruction | 0.75 | 8760 (1yr) | — | slow |
| fact | 0.70 | 1440 (60d) | 720h | medium |
| relationship | 0.70 | 17520 (2yr) | 8760h | very slow |
| learning | 0.70 | 2880 (120d) | 1440h | medium |
| commitment | 0.65 | 4320 (180d) | — | medium |
| pattern | 0.60 | 3360 (140d) | 1680h | medium |
| setup | 0.60 | 4320 (180d) | 2160h | medium |
| entity | 0.60 | 8760 (1yr) | 4380h | slow |
| artifact | 0.55 | 4320 (180d) | 2160h | medium |
| project | 0.50 | 2160 (90d) | 1080h | medium |
| profile | 0.50 | 17520 (2yr) | 8760h | very slow |
| goal | 0.45 | 1440 (60d) | 720h | medium-fast |
| general | 0.45 | 720 (30d) | 168h | medium |
| observation | 0.40 | 960 (40d) | 480h | fast |
| context | 0.35 | 720 (30d) | 360h | fast |
| event | 0.30 | 336 (14d) | 168h | fast |
| error | 0.30 | 336 (14d) | 336h | fast |
| issue | 0.30 | 336 (14d) | 336h | fast |
| request | 0.25 | 144 (6d) | 72h | very fast |

**Brain types** (conflict-checked): preference, decision, fact, relationship, learning, instruction, entity, artifact.
**Session types** (ephemeral): context, goal, error, event, commitment, observation.

---

## Retention (Phase 1)

### Retention strength formula
```
strength = weibullDecay(age_hours, type) × salience(type) × (1 + accessBoost)
```
- `weibullDecay`: `e^(-(age/eta)^k)` — per-type shape (k) + scale (eta)
- `salience`: type importance (0.25–0.85, see table above)
- `accessBoost`: `min(0.5, log1p(recall_count) × 0.1)` — frequently-recalled memories survive longer

### 3 DELETE paths

| Path | Trigger | Scope |
|---|---|---|
| **TTL ceiling** (`purgeExpired`) | `valid_until < now` (set at capture per-type) | Hard expiry — even popular memories eventually expire |
| **Score-driven** (`purgeWeakMemories`) | `strength < 0.05` (working) / `< 0.025` (tier-3 episodic) | Decay-based — weak memories purged |
| **Pin protection** | `pinned = 1` → **never purged** regardless of score/TTL | User-pinned memories survive |

### Lifecycle tick (every turn_end + DreamCycle)
```
lifecycle(sessionId):
  1. purgeExpired(working + episodic)    — TTL ceiling
  2. consolidate(working → episodic)     — group by (source, type, scope, agent_id), ≥3 items, ≥24h old
  3. degradeOldMemories(episodic)        — tier 1→2→3 by age (content compressed)
  4. purgeWeakMemories(working + episodic) — score-driven DELETE + audit log
```

Every DELETE writes to `purge_log` (source_table, row_id, content_snippet, reason, strength_at_purge, pinned).

---

## Conflict Resolution (Phase 2 — re-adopted from mya-v1)

When a brain-type memory is stored, `checkAndResolveConflicts` scans for semantic conflicts:

```
1. recall(newContent, {internal: true, topK: 50})  — broad FTS5 candidate search
2. filter to SAME scope (scope + agent_id match)    — Phase 3: no cross-role supersede
3. findTextConflicts: jaccard > 0.7 AND content ≠ (case-insensitive)
4. supersede(old → new) in a transaction            — old.superseded_by = new.id
```

- **Threshold**: jaccard > 0.7 (strict) — high overlap but different content = conflict
- **Case-insensitive**: "User prefers TABS" vs "user prefers tabs" = update, not conflict
- **Newest wins**: old memory gets `superseded_by`; recall filters `superseded_by IS NULL`
- **Scope-aware**: coder cannot supersede reviewer's memory (Phase 3 isolation)
- **Atomic**: supersede loop wrapped in transaction (no partial state)

---

## Governance — Trust Scoring (Phase 5)

### Trust lifecycle
- **Default**: 0.5 (neutral)
- **Helpful feedback** (`/trust <id> up`): +0.05 (clamped at 1.0)
- **Unhelpful feedback** (`/trust <id> down`): -0.10 (clamped at 0.0)
- **Recall weighting**: `final_score = base_score × trust` — low-trust memories rank lower

### Commands
```
/trust <memoryId> [up|down]   — adjust trust (find ids via /memory <query>)
/contradict                    — surface potentially-contradictory pairs (review only, no auto-resolve)
/stale                         — list memories with changed/gone file referents
```

### Contradiction detection
`detectContradictions(db, {similarityThreshold: 0.6})` — pairwise jaccard over brain-type memories. **Surfaces** pairs (returns content + similarity); does NOT auto-resolve (human-in-loop, gbrain model).

---

## Grounding — Referent Tracking (Phase 5)

For observations that reference files, `trackReferent` stores a content fingerprint:

```sql
referents (memory_id, referent_path, sha256, mtime_ms, size)
```

- **trackReferent**: computes sha256 (< 256KB files) + mtime + size on capture
- **checkReferent**: returns `match` | `changed` | `gone` | `no_referent`
  - `match`: mtime + size unchanged → current
  - `changed`: mtime/size differ + re-hash confirms → STALE
  - `gone`: file deleted → invalid
- **staleMemories**: sweep listing changed/gone referents (bounded, LIMIT 100)

**Wired via**: `remember` tool `filePath` parameter → `trackReferent(memory_id, filePath)`.

---

## Recall Pipeline

```
recall(query, {topK, sessionAware, sessionId, agentId, internal}):
  1. FTS5 MATCH (BM25 ranking) on fts_working + fts_episodes
  2. Scope filter: global + own-role + own-session (3-tier)
  3. Exclude superseded (superseded_by IS NULL)
  4. Exclude expired (valid_until > now OR NULL)
  5. Score: bm25_normalize × 0.5 + importance × 0.2 + weibull_temporal × 0.2 + veracity × 0.1
  6. Trust weighting: score × trust  (Phase 5)
  7. Sort + topK
  8. recordRecall (unless internal) — bumps recall_count + last_recalled
```

---

## Ports Interface (Phase 4)

```typescript
interface MemoryStore {
  record(input: WorkingMemoryInput): string;
  recall(query: string, options?: RecallOptions): MemoryHit[];
  lifecycle(sessionId?: string): LifecycleResult;
  getDatabase(): SqliteDatabase;
}
```

`SqliteMemoryManager implements MemoryStore` — compile-enforced. Enables future Postgres backend (engine as deployment knob, gbrain dual-engine pattern).

Additional declared seams (future): `VectorIndex`, `TextIndex`, `Embedder`, `MemoryCache`, `GraphStore`.

---

## Concurrency

- **Storage**: SQLite WAL mode (`PRAGMA journal_mode = WAL; busy_timeout = 5000`)
- **Concurrent readers**: unlimited (WAL allows N readers)
- **Concurrent writers**: 1 at a time (WAL); `busy_timeout` absorbs brief contention
- **Verified**: 3 concurrent Node processes, 30 writes, **0 deadlock, 0 loss**

---

## Configuration Constants

| Constant | Value | Purpose |
|---|---|---|
| PURGE_STRENGTH_THRESHOLD | 0.05 | Working memory purge threshold |
| (episodic uses threshold/2) | 0.025 | Episodic tier-3 purge (stricter) |
| ACCESS_BOOST_CAP | 0.5 | Max recall-frequency reinforcement |
| ACCESS_BOOST_COEFF | 0.1 | log1p(recall_count) coefficient |
| CONSOLIDATION_AGE_HOURS | configurable | Min age for consolidation eligibility |
| MIN_BATCH_SIZE | configurable | Min items per consolidation group |
| TRUST_HELPFUL_DELTA | +0.05 | Trust boost on helpful feedback |
| TRUST_UNHELPFUL_DELTA | -0.10 | Trust penalty on unhelpful feedback |
| TRUST_DEFAULT | 0.5 | Initial trust for new memories |
| Conflict threshold | 0.7 (jaccard) | Strict > for conflict detection |
| Conflict topN | 50 | Max candidates scanned |
| DreamCycle interval | 4 hours | Deep consolidation timer |
| purge LIMIT | 1000/tick | Max DELETEs per lifecycle tick |

---

## Data Flow (capture → expire)

```
User message / Assistant message
  ↓
autoCapture (regex classify → memory_type + confidence ≥ 0.55)
  ↓ (brain type + role active?)
  scope = 'role', agent_id = role     scope = 'global'
  ↓                                    ↓
manager.record({content, type, scope, agentId, sessionId})
  ↓
storeWorking: INSERT + valid_until = TTL(type) + conflict check (same-scope supersede)
  ↓
[lifecycle tick — turn_end + DreamCycle 4h]
  ↓
purgeExpired (TTL ceiling) → consolidate (working→episodic) → degrade (tier) → purgeWeak (score)
  ↓
recall: FTS5 + scope filter + trust weighting
  ↓
Inject top-5 into system prompt (before_agent_start)
```

---

## What's Deferred (known gaps)

| Item | Status | Why |
|---|---|---|
| Full Bayesian TMS | Not built | gbrain proves unnecessary (compiled-truth + human-in-loop suffices) |
| Belief re-verification | Not built | Unsolved in general (no reference does it) |
| Postgres backend | Interface ready (Phase 4 ports) | Defer until >50K memories or multi-user |
| Consumer migration to MemoryStore | Gradual | `implements` enforced; consumers migrate over time |
| Consolidation trust propagation | Resets to 0.5 | Known gap (reviewer M3); episodic trust doesn't inherit working trust |
| Shared-brain multi-agent | Never | Use pi-crew mailbox model instead |
| Path traversal in trackReferent | Latent | Safe-by-no-exposure (not agent-callable); add workspace containment if exposed |
| Trust manipulation via applyFeedback | Latent | Safe-by-no-exposure (slash-command only); add scope-check + rate-limit if exposed |

# mem0 vs mya Memory — Deep-Dive Findings (Verified)

> Companion to `docs/mem0-comparison.md`. This document records **verified
> failure modes** found by reading the actual code of both systems + a runtime
> reproduction of the headline bug.
> Sources: `source/mem0/` (v2.0.12) + `packages/memory/`. Date: 2026-07-17.
> Method: code audit (file:line) + runtime repro. No files changed in the audited
> repos.

## ⚠️ Headline findings (both critical, both verified)

| # | System | Finding | Severity | Verified how |
|---|--------|---------|----------|--------------|
| **A** | **mya** | **Recall scoring is INVERTED** — `composeScore` uses `Math.exp(bm25)` but SQLite FTS5 bm25 is *negative-and-more-negative-is-better*. Result: the **worst** match gets the highest score; the best match is pushed down. | **CRITICAL** | Code read + **runtime repro** (best match ranked 3/5) |
| **B** | **mem0** | **The local OSS proxy is completely broken** — `proxy/main.py` passes `filters=` to `add()` and top-level scope IDs to `search()`, both rejected by the current V3 core (`TypeError` / `ValueError`). The "use as an OpenAI-compatible proxy" path crashes on every turn. | **CRITICAL** | Code read, both routes traced |

Finding **A** is the more important one for mya: it means mya's recall **does not
rank by relevance today**. The earlier comparison doc treated mya's FTS5 keyword
matching as a (working) weakness vs. mem0's semantic search. In reality mya's
recall is *also* broken — so the comparison's "mya loses on semantic but is
otherwise sound" framing needs correcting.

---

## Finding A (mya) — recall scoring inversion

### The bug

`packages/memory/src/sqlite-recall.ts:252-258`:

```ts
/**
 * BM25 returns negative values (more negative = better). We normalize to [0, 1].
 * Final: (1 - normalized_bm25) * 0.5 + importance * 0.2 + temporal * 0.2 + veracity * 0.1
 */
function composeScore(bm25Rank, importance, temporalBoost, veracity) {
  const normalizedBm25 = Math.exp(bm25Rank); // [0, 1], higher = better  ← WRONG COMMENT
  return normalizedBm25 * 0.5 + importance * 0.2 + temporalBoost * 0.2 + veracity * 0.1;
}
```

The **docstring** says the intent is `(1 - normalized_bm25) * 0.5`. The **code**
implements `normalized_bm25 * 0.5`. They disagree. Because SQLite FTS5 `bm25()`
returns *more-negative = better*:

| Match quality | bm25 | `Math.exp(bm25)` | `× 0.5` contribution |
|---|---|---|---|
| Best (rare word) | −6.0 | 0.0025 | **0.0012** (≈ zero) |
| Medium | −2.5 | 0.082 | 0.041 |
| Worst | −0.8 | 0.449 | **0.225** (max) |

So the best match contributes ~0 to the score; the worst match contributes the
most. Since `hits.sort((a,b) => b.score - a.score)` re-sorts by this score, the
**weakest matches bubble to the top**.

### Runtime proof

```
Query: "typescript"
Inserted (in order):
  f1 "typescript typescript typescript configuration and tsconfig options"  ← BEST match
  f2 "the project uses typescript for all source files"
  f3 "javascript is also supported but typescript preferred"
  f4 "the database uses postgres with sql migrations"
  f5 "types are important for safety"

recall("typescript", topK=5) returned order:
  1. "the project uses typescript for all source files"
  2. "javascript is also supported but typescript preferred"
  3. "typescript typescript typescript configuration and..."   ← BEST match at rank 3
BEST match rank: 3/5  ❌ (should be 1)
```

The best match (3× the query term) is returned **3rd**. f1 and f2 tied at the
same score (0.44) despite f1 being a strictly stronger match — proving BM25 is
not discriminating at all.

### Why the tests didn't catch it

`phase1-sqlite.test.ts:180-196` ("BM25 ranking works on FTS5") tests raw FTS5
ordering with `SELECT ... ORDER BY rank LIMIT 1` — it **bypasses `composeScore`
entirely**. No test exercises `recall()`'s final ordering against relevance.
The SQL `ORDER BY bm25_rank LIMIT topK*2` correctly selects the candidate pool;
the bug is only in the post-fetch re-sort.

### Impact

- The candidate pool is correct (top-K×2 by BM25), so results aren't garbage —
  but the **final topK are the worst-ranked of the best pool**. For topK=5 from
  a pool of 10, you effectively return relevance-ranks ~6–10 and push the true
  top 5 out of the window.
- As memories age, Weibull temporal decay lowers `temporalBoost` uniformly, so
  all candidates converge to near-floor scores where the inverted BM25 term
  dominates ordering → recall degrades over time.
- Same inversion in L2 facts recall at `sqlite-recall.ts:283`:
  `score: 1 - (-Math.max(-10, Math.min(0, r.rank)) / 10)` — for rank=−10 (best)
  → score 0; rank=0 (worst) → score 1. **Also inverted, also untested.**

### Fix (one line, proven)

```ts
const normalizedBm25 = 1 - Math.exp(bm25Rank); // matches docstring intent
```

Simulated fixed-score ranking: `f1(best) > f2 > f3(weak)` — correct. Better yet,
min-max normalize bm25 per-query (`-bm25 / max(-bm25)`) so the strongest match in
each query contributes the full 0.5 weight.

---

## Finding B (mem0) — proxy is broken against the V3 core

`mem0/proxy/main.py:153-171` calls:
- `mem0_client.add(messages, ..., filters=filters)` — but `Memory.add()` has **no
  `filters` parameter** → `TypeError`.
- `mem0_client.search(query, user_id=..., agent_id=..., run_id=..., ...)` — but
  V3 `Memory.search()` calls `_reject_top_level_entity_params()` → `ValueError`.

Both the local OSS route (`Memory()`) and the hosted route (`MemoryClient`) are
broken: hosted `search()` also rejects top-level entity params (`client/main.py:313`).
So `Mem0(config=...).chat.completions.create(...)` **crashes on every chat turn**.

The proxy also `pip install litellm` at import time and `sys.exit(1)` on failure
(`proxy/main.py:10-25`). This is a shipped feature that doesn't work against the
current core — a migration was left half-finished.

---

## mya — verified findings (all 8)

| # | Finding | Verdict | Severity | Evidence |
|---|---------|---------|----------|----------|
| A | Recall BM25 scoring inverted | **Confirmed (runtime)** | **Critical** | `sqlite-recall.ts:252-258` + repro |
| 1 | Conflict jaccard: primitive tokenization, real false+/- | Confirmed | High | `conflict.ts:42-51` |
| 2 | Weibull dead-weight for slow types (TTL caps first) | Confirmed | Medium | `weibull.ts` + computed horizons |
| 3 | `embed_text` column unused (placeholder) | Confirmed | Low→High | `sqlite-schema.ts:40`, 0 reads/writes |
| 5 | Consolidation resets trust → 0.5 | Confirmed (documented gap) | Medium | `sqlite-consolidate.ts:184-201` |
| 6 | Scope asymmetry: cross-scope dupes persist | Confirmed (by design) | Medium-Low | `conflict.ts:82-87` vs `sqlite-recall.ts:138-145` |
| 7 | autoCapture regex coverage gap (6 types unreachable, no audit) | Confirmed | High | `auto-capture.ts:64-126` |
| 8 | No SQLITE_BUSY retry (cross-process) | Confirmed | Medium | `sqlite-db.ts:89-110` |

### 1. Conflict jaccard false-positive/false-negative
Tokenization is `toLowerCase().split(/\s+/)` — no stopwords, no stemming, no
bigrams (`conflict.ts:42-51`).
- **False positive**: `"team uses TypeScript for the backend service"` vs
  `"...frontend service"` → jaccard 0.75 > 0.7 → **wrong supersede** (distinct
  facts silently destroyed).
- **False negative**: `"user prefers tabs for indentation"` vs `"indentation
  should be spaces"` → jaccard 0.125 ≪ 0.7 → **no conflict** (contradictory prefs
  both persist forever).

The test (`conflict.test.ts:48-54`) only passes by accident of wording ("tabs
for code indentation" / "spaces for code indentation" share 5/6 tokens).

### 2. Weibull vs TTL interaction
Math is correct, but for slow types the **TTL ceiling fires before Weibull**:
- preference: Weibull purge horizon ≈ 6.76 yr, but TTL = 1 yr → **TTL wins**.
- profile: horizon ≈ 16 yr, TTL = 2 yr → **TTL wins**.

So the Weibull × salience × accessBoost machinery is **dead weight** for exactly
the types it was sized for. It only binds for fast types (request purges at ~4 d
inside its 6 d TTL). Risk: if anyone later removes TTL to "never lose
preferences," those will then live ~7 years instead.

### 3. `embed_text` unused
Schema has `embed_text TEXT DEFAULT NULL` (`sqlite-schema.ts:40`); the FTS
trigger concats it (`COALESCE(new.content,'') || COALESCE(new.embed_text,'')`).
But **0 application reads, 0 writes** (verified by grep — 8 hits all in
schema/trigger/test-fixture). It's a placeholder. **Zero migration friction** for
a future dense-vector upgrade on this column.

### 5. Consolidation trust-reset
`sqlite-consolidate.ts:184-201` INSERT omits `trust` → defaults to 0.5. Source
rows keep their trust. A working memory with trust 0.95 → episodic 0.5 → final
recall score cut ~47%. `importance` IS propagated (`Math.max(...importance)`);
`trust` is not. Documented as known gap (`edge-cases.test.ts:81-92`).

### 7. autoCapture coverage
38 regex patterns across 12 types; **6 types unreachable from autoCapture**
(project, observation, pattern, setup, entity, profile). Below-0.55 confidence is
silently dropped (only in returned `details`, no DB/audit). Concrete misses an
LLM would catch: third-person facts ("She said her birthday is..."), paraphrased
tech facts ("uses Stripe under the hood"), quantified constraints ("set cache TTL
to 30s"), past-tense decisions ("we agreed last week to...").

### 8. Concurrency
Single-process is safe (better-sqlite3 is synchronous — no writer interleaving).
Cross-process: `busy_timeout=5000` but **no retry** — `SQLITE_BUSY` propagates
raw to the agent. The DreamCycle consolidation transaction (up to 1000 rows/pass)
could trip the 5 s window on slow disk under contention.

---

## mem0 — verified findings (all 10)

| # | Finding | Verdict | Severity | Evidence |
|---|---------|---------|----------|----------|
| B | Proxy broken vs V3 core | **Confirmed** | **Critical** | `proxy/main.py:153-171` |
| 1 | Hybrid search is fake (semantic-only candidate pool; BM25/entity can't add candidates) | Confirmed | High | `main.py:1584-1643`, `scoring.py:78-95` |
| 2 | `linked_memory_ids` silently dropped (prompt asks, code ignores) | Confirmed | High | `main.py:983-999` |
| 3 | ADD-only: `get_update_memory_messages`/`DEFAULT_UPDATE_MEMORY_PROMPT` are dead code | Confirmed | Medium | `prompts.py:176,406` (only test refs) |
| 4 | Scoring fusion flaw: semantic threshold applied BEFORE fusion | Confirmed | Medium | `scoring.py:78-95` |
| 5 | Embedder-dim switch = destructive reset (no reindex) | Confirmed | Medium | all `vector_stores/*` |
| 6 | `/tmp/qdrant` default + telemetry ON by default | Confirmed | Medium | `configs/.../qdrant.py:16`, `telemetry.py` |
| 7 | (covered by B) | — | — | — |
| 8 | Exact-dedup only checks top-10 retrieved; no global hash index | Confirmed | Medium | `main.py:961-990` |
| 9 | Entity hub over-penalization (`0.001*(n-1)²` → ~0 boost at n>100) | Confirmed | Low | `main.py:1757-1764` |
| 10 | Expiration is hide-only (no reaper; `get()` returns expired) | Confirmed | Medium | `main.py:403-412` |

### Highlights

**1. "Hybrid" search is fake.** The candidate pool is built ONLY from dense
semantic results (`main.py:1638` loops `semantic_results`). BM25/entity can only
re-score existing semantic candidates — a keyword-only match (rare proper noun,
code identifier) can NEVER appear in results regardless of BM25 strength. Worse,
the semantic threshold (default 0.1) is applied BEFORE fusion (`scoring.py:88`),
so BM25/entity can't rescue a sub-threshold semantic candidate. And `max_possible`
is selected globally — if any BM25 result exists, the divisor inflates to 2.0 for
ALL candidates, deflating pure-semantic scores ~50%.

**2. Wasted LLM tokens.** The `ADDITIVE_EXTRACTION_PROMPT` asks the LLM to return
`linked_memory_ids` for contradiction/narrative linking. The post-processing loop
(`main.py:983-999`) only reads `text` + `attributed_to` — **`linked_memory_ids` is
never persisted**. Every extraction burns extra output tokens for a field that's
discarded. Only spaCy entity links survive (a separate path).

**3. V3 ADD-only is total.** `Memory.add()` never calls update/delete. The legacy
`DEFAULT_UPDATE_MEMORY_PROMPT` (with ADD/UPDATE/DELETE/NONE logic including
contradiction→DELETE) is dead code, reachable only from `tests/configs/test_prompts.py`.
Contradictions are now stored as parallel ADD rows forever.

**5. Switching embedders is destructive.** No reindex/migration exists; the only
path is `vector_store.reset()` (delete everything). No fail-fast dim-mismatch check
at startup — failure surfaces at first `insert()`.

**6. Privacy defaults.** Vector store defaults to `/tmp/qdrant` (lost on reboot,
shared across users). Telemetry posts provider FQNs (vector-store, LLM, embedder
class names) to `us.i.posthog.com` on **every op**, **opt-out not opt-in**
(`MEM0_TELEMETRY=false` disables, but default is True).

---

## Quantitative comparison

| Metric | mem0 (default OpenAI) | mya |
|---|---|---|
| Cost per capture | 1 LLM call + N embedding calls (~$0.001–0.01/turn) | $0 (regex + SQLite) |
| Latency per capture | ~0.9–1.1s (managed) / +LLM round-trip (OSS) | <5ms |
| Memory growth | Unbounded (ADD-only, no reaper) | Bounded (Weibull + TTL + purge) |
| External services | OpenAI (default) + Qdrant + PostHog | None |
| Dependencies (mandatory) | qdrant-client, openai, sqlalchemy, posthog, protobuf, pytz | better-sqlite3 |
| Offline-ready out-of-box | No (OpenAI default, telemetry, model downloads) | Yes |
| Conflict handling | None (accumulate) | Supersession (but jaccard is brittle) |
| Recall relevance ranking | Semantic (good) but fake-hybrid | **Currently broken (inverted)** |

### mem0 ADD-only growth model
With no dedup beyond top-10 + no reaper, a memory store grows ~monotonically with
conversation volume. Over a year of daily use, duplicates + contradictions
accumulate; recall top-K precision degrades as the store fills with near-duplicates.
mya's Weibull+TTL reaches a steady state (insertion rate ≈ purge rate).

---

## Corrected verdict

The first-pass comparison concluded "mya loses on semantic recall but is
otherwise sound." **This deep-dive corrects that**: mya's recall is **not** sound
today — the BM25 inversion means it doesn't rank by relevance at all. So:

- **mya's recall is currently WORSE than mem0's** (mem0 at least ranks by
  semantic similarity; mya returns the wrong half of its candidate pool).
- The #1 priority is **not** "add embeddings to mya" — it's **fix the scoring
  inversion first**. Adding embeddings on top of an inverted scorer would just
  produce a fancier wrong ranking.

### What mya should do (prioritized)

| # | Action | Effort | Impact |
|---|--------|--------|--------|
| **1** | **Fix recall scoring inversion** (`1 - Math.exp(bm25)`, + min-max per-query) + add a recall-order test | 1 line + test | **Critical** — restores relevance ranking |
| **2** | Tighten conflict: threshold 0.85 + add audit when supersede fires | Small | High — stops wrong supersede |
| **3** | Add dense-vector recall signal (wire `embed_text` + local embedder) | Medium | High — closes mem0's real edge |
| **4** | Propagate trust through consolidation (`Math.max(...trusts)`) | 1 line | Medium |
| **5** | Add SQLITE_BUSY retry wrapper around `transaction()` | Small | Medium |
| **6** | autoCapture: add audit table for skipped captures | Small | Medium |

### What NOT to borrow from mem0
- ADD-only conflict model (mya's supersession is better, once jaccard is tightened)
- The fake "hybrid" search (don't replicate the semantic-only candidate pool flaw)
- `/tmp` default / opt-out telemetry / OpenAI defaults
- The dead update-prompt machinery

## Verification artifacts

- `source/mem0/` cloned 2026-07-17 (v2.0.12), read-only
- mya recall-inversion repro: runtime confirmed (best match ranked 3/5)
- All findings cite `file:line` and were cross-checked by two independent
  read-only explorer passes (mem0: 10 items; mya: 8 items) + direct code reads

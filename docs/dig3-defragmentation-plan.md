# Dig 3 De-fragmentation — Brain Storage Seam Implementation Plan

> **Status:** READ-ONLY design document. No source modified.
> **Verified against code** at commit 2026-07-27. Every claim cited `file:line`.
> **Relationship:** Supersedes the rejected "accept the split" plan in
> `docs/memory-migration-plan.md`. That plan's verdict correctly identified
> that the codebase anticipates this refactor; this document specifies *how*.

---

## 1. Problem Statement

The codebase has **two parallel memory engines** that share no storage:

| Engine | State | Persistence | Used by |
|--------|-------|-------------|---------|
| **Brain** (`brain.ts`) | 4 in-memory `Map`s + 10 zero-LLM analysis phases | Optional JSONL (`brain-store.ts`) | SDK live path (`agent/src/index.ts:263`), 13 domains, dream-cycle fallback |
| **SqliteMemoryManager** (`sqlite-manager.ts`) | SQLite (5-layer, FTS5, vector, Weibull decay) | SQLite WAL (`memory.db`) | CLI bridge, auto-capture, dream-cycle preferred path |

The dream-cycle explicitly branches on which engine to use (`dream-cycle.ts:217-218`):

```typescript
if (this.sqliteMemory) {
  return this.dreamSQLite(start);    // preferred
}
```

…and falls back to Brain (`dream-cycle.ts:220-223`). The `@deprecated` comment
on Brain (`index.ts:19-21`) documents the intended resolution:

> *Routing Brain through a GraphStore adapter is a future refactor
> (Dig 3 de-fragmentation).*

**This document specifies that refactor.** The goal: Brain's **storage** (the
4 Maps) becomes swappable behind a seam; its **10 analysis phases** (pure
computation) stay untouched. A new `SqliteBrainStore` makes Brain durable,
unifying it with SQLite. The dream-cycle dual-path collapses.

---

## 2. Target Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Brain class                         │
│                                                         │
│  ┌─────────────────────────────────────────────┐       │
│  │  10 zero-LLM analysis phases (UNCHANGED)    │       │
│  │  backlinks · consolidate · purge · embed    │       │
│  │  extractFacts · lint · orphans              │       │
│  │  schemaSuggest · resolveSymbolEdges         │       │
│  │  conversationFactsBackfill · purgeTombstones│       │
│  └─────────────────────────────────────────────┘       │
│                    │ operates on                        │
│                    ▼                                    │
│  ┌─────────────────────────────────────────────┐       │
│  │  BrainStorage seam (NEW interface)          │       │
│  │  putFact / getFact / deleteFact / allFacts  │       │
│  │  putTake / getTake / allTakes               │       │
│  │  putPage / getPage / allPages               │       │
│  │  putTombstone / deleteTombstone / allTomb…  │       │
│  └─────────────────────────────────────────────┘       │
│              │                              │           │
│              ▼                              ▼           │
│  ┌──────────────────┐          ┌────────────────────┐  │
│  │ InMemoryBrain    │          │ SqliteBrainStore   │  │
│  │ Storage          │          │ (NEW)              │  │
│  │ (4 Maps —        │          │                    │  │
│  │  current behavior)│         │ write-through:     │  │
│  │                  │          │ InMemoryBrainStorage│  │
│  │ DEFAULT          │          │ + SQLite WAL       │  │
│  │ backward-compat  │          │ DURABLE            │  │
│  └──────────────────┘          └────────────────────┘  │
│                                                         │
│  ┌─────────────────────────────────────────────┐       │
│  │  backlinksCache (stays in Brain — NOT in    │       │
│  │  the store; invalidated on mutations)        │       │
│  └─────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────┘
         │ public API (UNCHANGED)
         ▼
┌─────────────────────────────────────────────┐
│  13 domains · dream-cycle · LifecycleManager │
│  (all use Brain's public API — NO changes)   │
└─────────────────────────────────────────────┘
```

**Key design decisions:**

- **The "GraphStore adapter" in the Dig 3 note (`index.ts:20`) is a conceptual
  storage adapter, NOT the `ports.ts:83-87` `GraphStore` interface** (which is
  entity/edge CRUD for knowledge-graph traversal — `upsertEntity`,
  `upsertEdge`, `subgraph`). We create a new `BrainStorage` seam instead.
  Force-fitting `GraphStore` would be wrong: it models edges, not facts.
- **`TypedGraph` (`graph.ts`) stays separate.** It ingests FROM Brain
  (`graph.ts:50-52`: `ingestBacklinks(edges)`) — it is a consumer, not a
  backing store. No role in Dig 3.
- **Dedicated `brain_*` SQLite tables** (not reusing SMM's `working_memory`).
  The `facts` table in `sqlite-schema.ts` models RDF triples
  (subject/predicate/object — `sqlite-schema.ts:71-82`), not Brain's rich
  `Fact` with `kind`, `entity`, `visibility`, `notability`, `embedded`,
  `consolidatedInto`. See §4 for DDL.
- **Write-through cache.** `SqliteBrainStore` wraps an `InMemoryBrainStorage`
  for reads (analysis phases iterate ALL facts — must stay sub-ms) and writes
  through to SQLite for durability.

---

## 3. BrainStorage Interface Signatures

```typescript
// packages/memory/src/brain-storage.ts (NEW — Phase A)

import type { Fact, Take, BrainPage } from "./brain.js";

/**
 * Storage seam for Brain's state. Two implementations:
 * - InMemoryBrainStorage: current behavior (4 Maps), backward-compat.
 * - SqliteBrainStore: write-through cache + SQLite WAL (durable).
 *
 * Design constraints:
 * - allFacts() / allTakes() / allPages() return LIVE iterators over internal
 *   Map values (NOT copies). Brain's embed() and consolidate() mutate facts
 *   in-place via the iterator; a defensive copy would break this.
 * - Methods are SYNCHRONOUS to match current Map semantics. Brain's analysis
 *   phases are all sync; adding async would ripple through 700+ tests.
 *   SqliteBrainStore achieves sync semantics via WAL mode (~1ms writes).
 */
export interface BrainStorage {
  // ── Facts ──
  getFact(id: string): Fact | undefined;
  putFact(fact: Fact): void;
  deleteFact(id: string): boolean;
  allFacts(): IterableIterator<Fact>;
  /** Count of live (non-tombstoned) facts. */
  readonly factCount: number;

  // ── Takes ──
  getTake(id: string): Take | undefined;
  putTake(take: Take): void;
  allTakes(): IterableIterator<Take>;
  readonly takeCount: number;

  // ── Pages ──
  getPage(id: string): BrainPage | undefined;
  putPage(page: BrainPage): void;
  allPages(): IterableIterator<BrainPage>;

  // ── Tombstones (soft-delete with 72h recovery window) ──
  putTombstone(id: string, entry: { fact: Fact; deletedAt: number }): void;
  getTombstone(id: string): { fact: Fact; deletedAt: number } | undefined;
  deleteTombstone(id: string): boolean;
  allTombstones(): IterableIterator<[string, { fact: Fact; deletedAt: number }]>;
  readonly tombstoneCount: number;

  // ── Bulk hydration (for manager.loadFromBrainStore / SQLite load) ──
  loadFromSnapshot(snapshot: {
    facts: Iterable<Fact>;
    takes: Iterable<Take>;
    pages: Iterable<BrainPage>;
    tombstones: Iterable<[string, { fact: Fact; deletedAt: number }]>;
  }): void;
}

/**
 * Default implementation — exact behavioral replacement for Brain's current
 * 4 Maps. All 707 existing tests pass with ZERO behavior change.
 */
export class InMemoryBrainStorage implements BrainStorage {
  private readonly facts = new Map<string, Fact>();
  private readonly takes = new Map<string, Take>();
  private readonly pages = new Map<string, BrainPage>();
  private readonly tombstones = new Map<string, { fact: Fact; deletedAt: number }>();

  getFact(id: string): Fact | undefined { return this.facts.get(id); }
  putFact(fact: Fact): void { this.facts.set(fact.id, fact); }
  deleteFact(id: string): boolean { return this.facts.delete(id); }
  allFacts(): IterableIterator<Fact> { return this.facts.values(); }
  get factCount(): number { return this.facts.size; }

  getTake(id: string): Take | undefined { return this.takes.get(id); }
  putTake(take: Take): void { this.takes.set(take.id, take); }
  allTakes(): IterableIterator<Take> { return this.takes.values(); }
  get takeCount(): number { return this.takes.size; }

  getPage(id: string): BrainPage | undefined { return this.pages.get(id); }
  putPage(page: BrainPage): void { this.pages.set(page.id, page); }
  allPages(): IterableIterator<BrainPage> { return this.pages.values(); }

  putTombstone(id: string, entry: { fact: Fact; deletedAt: number }): void { this.tombstones.set(id, entry); }
  getTombstone(id: string): { fact: Fact; deletedAt: number } | undefined { return this.tombstones.get(id); }
  deleteTombstone(id: string): boolean { return this.tombstones.delete(id); }
  allTombstones(): IterableIterator<[string, { fact: Fact; deletedAt: number }]> { return this.tombstones.entries(); }
  get tombstoneCount(): number { return this.tombstones.size; }

  loadFromSnapshot(snapshot: {
    facts: Iterable<Fact>;
    takes: Iterable<Take>;
    pages: Iterable<BrainPage>;
    tombstones: Iterable<[string, { fact: Fact; deletedAt: number }]>;
  }): void {
    this.facts.clear();
    this.takes.clear();
    this.pages.clear();
    this.tombstones.clear();
    for (const f of snapshot.facts) this.facts.set(f.id, f);
    for (const t of snapshot.takes) this.takes.set(t.id, t);
    for (const p of snapshot.pages) this.pages.set(p.id, p);
    for (const [id, ts] of snapshot.tombstones) this.tombstones.set(id, ts);
  }
}
```

---

## 4. SQLite Schema Changes

Brain's `Fact` type (`brain.ts:31-53`) has fields with **no equivalent** in
SMM's `working_memory` table (`sqlite-schema.ts:36-60`):

| Brain Fact field | SMM equivalent | Gap |
|-----------------|----------------|-----|
| `kind` (FactKind) | `memory_type` | Values differ: `event\|preference\|commitment\|belief\|fact` vs `general\|…` |
| `entity` | — | **No column** |
| `visibility` (private\|world) | — | **No column** |
| `notability` (0-10) | `importance` (0-1) | Scale mismatch |
| `consolidatedInto` | — | **No column** |
| `embedded` | — | **No column** |
| `accessCount` | `recall_count` | Naming differs |
| `lastAccessedAt` | `last_recalled` | Type differs (epoch ms vs ISO string) |
| `strength` | — | **No column** (Weibull in SMM, separate calc) |

**Conclusion:** Reusing `working_memory` would require ALTER TABLE for 6+
columns and risk data corruption from the field-type mismatches. Dedicated
`brain_*` tables are cleaner and isolate Brain data from SMM lifecycle.

### DDL (added in `initSchema()` — `sqlite-schema.ts`)

```sql
-- Brain facts (full-fidelity — all fields from brain.ts:31-53)
CREATE TABLE IF NOT EXISTS brain_facts (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'fact',
  entity TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'private',
  notability REAL NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  valid_from INTEGER,
  valid_until INTEGER,
  consolidated_at INTEGER,
  consolidated_into TEXT,
  embedded INTEGER NOT NULL DEFAULT 0,
  access_count INTEGER DEFAULT 0,
  last_accessed_at INTEGER,
  strength REAL
);

CREATE INDEX IF NOT EXISTS idx_brain_facts_entity ON brain_facts(entity);
CREATE INDEX IF NOT EXISTS idx_brain_facts_source ON brain_facts(source);
CREATE INDEX IF NOT EXISTS idx_brain_facts_unconsolidated
  ON brain_facts(source, entity) WHERE consolidated_at IS NULL;

-- Brain takes (promoted fact clusters)
CREATE TABLE IF NOT EXISTS brain_takes (
  id TEXT PRIMARY KEY,
  entity TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL,
  synthesized_at INTEGER NOT NULL,
  sources_json TEXT NOT NULL DEFAULT '[]'  -- JSON array of fact ids
);

-- Brain pages (compiled truth)
CREATE TABLE IF NOT EXISTS brain_pages (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL DEFAULT '',
  compiled_truth TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);

-- Brain tombstones (soft-delete with 72h recovery)
CREATE TABLE IF NOT EXISTS brain_tombstones (
  id TEXT PRIMARY KEY,
  fact_json TEXT NOT NULL,               -- serialized Fact
  deleted_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_brain_tombstones_deleted ON brain_tombstones(deleted_at);
```

**No FTS5, no triggers** on `brain_*` tables. Brain has its own `backlinks()`
regex extraction (`brain.ts:174-247`) — it does not use SQL search. The tables
are pure CRUD stores.

---

## 5. How Each of the 10 Analysis Phases Maps

All 10 phases are **pure computation over the fact set loaded from the seam**.
They stay in Brain, unchanged. The seam only replaces the *storage* (CRUD
over facts/takes/pages/tombstones), not the *computation*.

| # | Phase | Storage ops used | Computation | Change in Dig 3? |
|---|-------|-----------------|-------------|:---:|
| 1 | `backlinks()` (`brain.ts:174`) | `this.facts.values()` → `this.storage.allFacts()` | Regex extraction of typed edges | Reads from seam; logic unchanged |
| 2 | `consolidate()` (`brain.ts:122`) | `this.facts.values()` → `storage.allFacts()`; `this.takesMap.set()` → `storage.putTake()`; **in-place mutation of `f.consolidatedAt`/`f.consolidatedInto`** | Bag-of-words clustering | Reads + writes through seam; **GAP-1 fix required** (see §7.1) |
| 3 | `purge()` (`brain.ts:248`) | `this.facts.delete()` → `storage.deleteFact()`; `this.tombstones.set()` → `storage.putTombstone()` | Validity check | Writes through seam |
| 4 | `embed()` (`brain.ts:315`) | `this.facts.values()` → `storage.allFacts()`; **in-place mutation of `f.embedded`** | Boolean flag set | Reads from seam; **GAP-1 fix required** (see §7.1) |
| 5 | `extractFacts()` (`brain.ts:280`) | `this.facts.values()` → `storage.allFacts()` | Regex: dates, URLs, emails, commits, versions | Reads from seam; read-only computation |
| 6 | `lint()` (`brain.ts:370`) | `this.facts.values()` → `storage.allFacts()`; `this.facts.get()` → `storage.getFact()` | Empty/duplicate/no-entity detection | Reads from seam; read-only computation |
| 7 | `orphans()` (`brain.ts:394`) | `this.facts.values()` → `storage.allFacts()` | Edge connectivity check | Reads from seam; read-only computation |
| 8 | `schemaSuggest()` (`brain.ts:417`) | `this.facts.values()` → `storage.allFacts()` | Case-insensitive entity collision | Reads from seam; read-only computation |
| 9 | `resolveSymbolEdges()` (`brain.ts:438`) | `this.facts.values()` → `storage.allFacts()` | Cross-entity bare-name match | Reads from seam; read-only computation |
| 10 | `conversationFactsBackfill()` (`brain.ts:470`) | `this.facts.values()` → `storage.allFacts()`; `this.recordFact()` → uses `storage.putFact()` internally | Conversation scan for entity names | Reads + writes through seam |

### CRITICAL: GAP-1 — In-Place Mutations Invisible to SQLite Write-Through

> **POST-PHASE-A UPDATE (cold adversarial review, 2026-07-27):** the GAP-1 register is **FOUR sites, not two.** Sites 1–2 (inside `Brain`) were patched in Phase A; **sites 3–4 (in external consumers) are pre-existing and UNPATCHED — they are BLOCKING for Phase B.**

Brain mutates `Fact`/`Take`/`BrainPage` objects **in place without calling a store set**. With `InMemoryBrainStorage` the mutated object IS the Map value (same reference) — changes are visible. With `SqliteBrainStore` (write-through cache + SQLite) **SQLite is never notified** because no `putFact()`/`putTake()`/`putPage()` is called.

#### GAP-1 register (4 sites)

| # | Site | Mutation | Phase A | Impact if lost (Phase B restart) |
|---|------|----------|:-:|---|
| 1 | `brain.ts` `embed()` (~:331) | `f.embedded = true` | ✅ Patched — `storage.putFact(f)` after mutation | embedded reverts → vector arm re-indexes |
| 2 | `brain.ts` `consolidate()` (~:146) | `f.consolidatedAt`/`consolidatedInto` | ✅ Patched — `storage.putFact(f)` per cluster fact | consolidated facts re-clustered into duplicate Takes |
| 3 | `lifecycle.ts:284-289` `recordAccess()` | `f.lastAccessedAt`/`f.accessCount` | 🛑 **UNPATCHED (pre-existing)** | `accessCount=0` → `computeStrength()` underestimates decay resistance → frequently-accessed facts **incorrectly purged** |
| 4 | `domains/sync.ts:89-93` `SyncDomain.onRecord()` | `fact.hlc` | 🛑 **UNPATCHED (pre-existing)** | `hlc=undefined` → `extractHlc()` falls back to `(createdAt,0,"unknown")` → LWW sync ordering **breaks** (all nodes "unknown" origin) |

**Phase A fix (sites 1–2, DONE):** explicit `this.storage.putFact(f)` after each in-place mutation — a no-op for `InMemoryBrainStorage` (idempotent re-set of same reference) but essential for `SqliteBrainStore`. **Verified by a spy-storage injection test** (`brain-storage.test.ts` → *"Brain ↔ BrainStorage seam — GAP-1 verification"*, A-GATE-2/3): with `InMemoryBrainStorage` alone a missing `putFact` is invisible (same-ref no-op), so a spy `BrainStorage` is injected into a real `Brain` to assert `putFact` is actually invoked by `embed()`/`consolidate()`.

**Phase B fix (sites 3–4, BLOCKING):** external consumers mutate Fact fields obtained from `brain.allFacts` without going through Brain. Phase B must add a persistence path for external mutations — e.g. a `brain.touchFact(id, patch)` that delegates to `storage.putFact()` — and patch `lifecycle.recordAccess` + `SyncDomain.onRecord` to use it. Add B-GATE durability tests for both (close/reopen).

---

## 6. Incremental Migration Phases

### Phase A — Introduce Seam + InMemoryBrainStorage (ZERO behavior change)

**Goal:** Replace Brain's 4 private Maps with `this.storage` (an
`InMemoryBrainStorage` instance). All 707 tests pass unchanged.

**Scope:**
1. Create `brain-storage.ts` with `BrainStorage` interface +
   `InMemoryBrainStorage` class.
2. Modify `brain.ts`:
   - Add `storage: BrainStorage` field + constructor parameter
     (default: `new InMemoryBrainStorage()`).
   - Replace all `this.facts.*` → `this.storage.*` (fact ops).
   - Replace all `this.takesMap.*` → `this.storage.*` (take ops).
   - Replace all `this.pagesMap.*` → `this.storage.*` (page ops).
   - Replace all `this.tombstones.*` → `this.storage.*` (tombstone ops).
   - **GAP-1 fix:** Add `this.storage.putFact(f)` after in-place mutations in
     `embed()` (`brain.ts:320`) and `consolidate()` (`brain.ts:131-133`).
   - Add `loadFromSnapshot()` public method (delegates to
     `this.storage.loadFromSnapshot()` + invalidates `backlinksCache`).
3. Modify `manager.ts:313-330`: Rewrite `loadFromBrainStore()` to call
   `this.brain.loadFromSnapshot(snapshot)` instead of reaching into private
   Maps via `as unknown as`.
4. Modify `index.ts`: Export `BrainStorage`, `InMemoryBrainStorage`.
5. Create `brain-storage.test.ts`: CRUD tests for all 4 entity types.

**Constructor backward-compat (verified):**
- Production: `new Brain()` — no args (`agent/src/index.ts:263`,
  `shared-instances.ts:92`). ✅ Safe.
- Tests: `new Brain(3, 0.5)` — 2 positional args (`domains.test.ts:71,86,364`).
  No code passes 3 args. ✅ Safe.

**Gating criteria:**

| Gate | Criterion |
|------|-----------|
| A-GATE-1 | All 707 existing tests pass (confirmed baseline). |
| A-GATE-2 | `embed()` calls `this.storage.putFact(f)` after mutation. |
| A-GATE-3 | `consolidate()` calls `this.storage.putFact(f)` after each cluster mutation. |
| A-GATE-4 | `manager.ts:loadFromBrainStore()` uses `brain.loadFromSnapshot()` — no more `as unknown as`. |
| A-GATE-5 | `brain-storage.test.ts` covers CRUD for facts, takes, pages, tombstones. |
| A-GATE-6 | New test: `embed()` via storage → `storage.getFact(id).embedded === true`. |
| A-GATE-7 | New test: `consolidate()` via storage → `storage.getFact(id).consolidatedAt !== undefined`. |

**Effort:** ~6 files (2 create + 4 modify). Risk: MEDIUM (mechanical but
GAP-1 fix is non-obvious). Estimated: 1-2 days.

---

### Phase B — Add SqliteBrainStore (durable backing)

**Goal:** Brain facts persist to SQLite. Write-through cache ensures read
performance is unchanged.

**Scope:**
1. Create `brain-sqlite-store.ts`: `SqliteBrainStore implements BrainStorage`.
   - Internally wraps an `InMemoryBrainStorage` (the read cache).
   - On construction: calls `loadFromSQLite()` to populate the cache.
   - All write ops (`putFact`, `putTake`, `putPage`, `putTombstone`,
     `deleteFact`, `deleteTombstone`): update cache + write to SQLite (WAL).
   - `loadFromSnapshot()`: clears cache, populates from snapshot, writes all
     to SQLite.
2. Modify `sqlite-schema.ts`: Add `brain_facts`, `brain_takes`, `brain_pages`,
   `brain_tombstones` tables + indexes (§4 DDL).
3. Modify `index.ts`: Export `SqliteBrainStore`.
4. Create `brain-sqlite-store.test.ts`: CRUD + durability + write-through +
   GAP-1 persistence tests.
5. *(Optional)* Config-gated wiring in `shared-instances.ts:92` or
   `agent/src/index.ts:263` to construct Brain with `SqliteBrainStore` when
   a DB path is available.

**Same-DB-file decision:** `brain_*` tables share `memory.db` with SMM's
tables. This is correct:
- SMM's lifecycle/consolidation operates on `working_memory`/`episodic_memory`
  by table name — won't touch `brain_*` tables.
- Single WAL, single checkpoint, single close handler.
- `brain_*` tables have NO FTS5 triggers — Brain has its own `backlinks()`.

**Gating criteria:**

| Gate | Criterion |
|------|-----------|
| B-GATE-1 | All Phase A tests pass unchanged. |
| B-GATE-2 | Write-through: `putFact()` → cache updated AND SQLite row exists (SELECT). |
| B-GATE-3 | Durability: write fact → close DB → reopen → `getFact(id)` returns same fact with all fields. |
| B-GATE-4 | GAP-1: `embed()` → close → reopen → `embedded === true` in SQLite. |
| B-GATE-5 | GAP-1: `consolidate()` → close → reopen → `consolidatedAt` + `consolidatedInto` persisted. |
| B-GATE-6 | Performance: 10,000 facts, `allFacts()` iteration < 50ms (cache-only path). |
| B-GATE-7 | Performance: 10,000 `recordFact()` calls, total time measured + reported. |

**Effort:** ~5 files (2 create + 2 modify + 1 test). Risk: MEDIUM.
Estimated: 2-3 days.

---

### Phase C — Collapse Dream-Cycle Dual-Path

**Goal:** When Brain is SQLite-backed, the dream-cycle uses Brain's path
(not `dreamSQLite()`). Manual persistence in `lifecycle.ts` becomes redundant.

**Scope:**
1. Modify `dream-cycle.ts:217-218`: When `Brain` is backed by
   `SqliteBrainStore`, the Brain path IS the durable path — skip the
   `dreamSQLite()` branch.
2. Modify `lifecycle.ts:125-145`: Remove manual `brainStore.persistTakes()`
   / `persistFact()` / `persistPage()` calls when Brain storage is durable
   (data already written through via `storage.putFact()` etc.).
   - `wireBrainStore()` becomes a no-op when Brain has durable storage.

**Note on `dreamSQLite()` method:** Keep it for SMM's auto-capture path
(operates on `working_memory`/`episodic_memory` — different data source).
The two paths serve different data; only the *dispatch* in `dream()`
collapses.

**Gating criteria:**

| Gate | Criterion |
|------|-----------|
| C-GATE-1 | Dream-cycle with SQLite-backed Brain uses Brain path (not `dreamSQLite()`). |
| C-GATE-2 | `lifecycle.ts:tick()` no longer calls `brainStore.persist*` when Brain storage is durable. |
| C-GATE-3 | Dream summary persists across simulated restart (close/reopen Brain → re-run `dream()` → no re-processing of already-consolidated facts). |

**Effort:** ~2 files modified. Risk: MEDIUM (dual-path logic is subtle).
Estimated: 1 day.

---

### Phase D — Retire JSONL Persistence

**Goal:** `brain-store.ts` (JSONL) is deprecated. Existing `brain.jsonl`
files migrate to `brain_*` SQLite tables.

**Scope:**
1. Create `brain-migrate-jsonl.ts`: One-way JSONL → SQLite migration.
   Reuses `BrainStore.load()` (`brain-store.ts:96-137`) to read the JSONL
   snapshot, then writes facts/takes/pages/tombstones to `brain_*` tables.
   Idempotent: skip if `brain_facts` already has rows.
2. Modify `brain-store.ts`: Add `@deprecated` JSDoc.
3. Modify `index.ts:19-21`: Update Dig 3 note to "✅ Dig 3 COMPLETE".
4. Consider deprecating the existing lossy `migrate.ts` Brain-fact path
   (maps Brain facts to `working_memory` with scale conversion — `migrate.ts:40`
   normalizes notability 0-10 → 0-1). The new `brain-migrate-jsonl.ts` should
   be the PREFERRED path (full-fidelity to `brain_*` tables).

**Gating criteria:**

| Gate | Criterion |
|------|-----------|
| D-GATE-1 | `brain.jsonl` → SQLite migration tested (facts/takes/pages/tombstones). |
| D-GATE-2 | Migration is idempotent (second run is no-op if `brain_facts` has rows). |
| D-GATE-3 | `brain-store.ts` marked `@deprecated`, remains importable and functional. |
| D-GATE-4 | `index.ts:19-21` Dig 3 note updated to "✅ COMPLETE". |

**Effort:** ~3 files (1 create + 2 modify). Risk: LOW.
Estimated: 0.5-1 day.

---

## 7. File-by-File Change List

### Phase A (6 files: 2 created + 4 modified)

| File | Action | Key Changes | Risk |
|------|:------:|-------------|:----:|
| `packages/memory/src/brain-storage.ts` | **CREATE** | `BrainStorage` interface + `InMemoryBrainStorage` class | LOW |
| `packages/memory/src/brain-storage.test.ts` | **CREATE** | CRUD tests for all 4 entity types + GAP-1 tests | LOW |
| `packages/memory/src/brain.ts` | **MODIFY** | (1) Add `storage` field + constructor param. (2) Replace `this.facts.*`→`this.storage.*`. (3) **GAP-1 fix**: `putFact()` in `embed()` + `consolidate()`. (4) Replace `this.takesMap.*`→`this.storage.*`. (5) Replace `this.pagesMap.*`→`this.storage.*`. (6) Replace `this.tombstones.*`→`this.storage.*`. (7) Add `loadFromSnapshot()`. | MEDIUM |
| `packages/memory/src/index.ts` | **MODIFY** | Export `BrainStorage`, `InMemoryBrainStorage` | LOW |
| `packages/memory/src/manager.ts` | **MODIFY** | Rewrite `loadFromBrainStore()` (`:313-330`) to use `brain.loadFromSnapshot()` | MEDIUM |
| `packages/memory/src/brain.ts` (ctor) | (same file) | Add 3rd constructor param: `storage?: BrainStorage` (default: `new InMemoryBrainStorage()`) | LOW |

### Phase B (5 files: 2 created + 2 modified + 1 test)

| File | Action | Key Changes | Risk |
|------|:------:|-------------|:----:|
| `packages/memory/src/brain-sqlite-store.ts` | **CREATE** | `SqliteBrainStore` (write-through cache + SQLite) | MEDIUM |
| `packages/memory/src/brain-sqlite-store.test.ts` | **CREATE** | CRUD + durability + write-through + GAP-1 + performance | MEDIUM |
| `packages/memory/src/sqlite-schema.ts` | **MODIFY** | Add `brain_facts`/`brain_takes`/`brain_pages`/`brain_tombstones` + indexes | LOW |
| `packages/memory/src/index.ts` | **MODIFY** | Export `SqliteBrainStore` | LOW |
| `packages/print/src/shared-instances.ts` or `packages/agent/src/index.ts` | **MODIFY** (optional) | Config-gated Brain construction with SQLite backing | MEDIUM |

### Phase C (2 files modified)

| File | Action | Key Changes | Risk |
|------|:------:|-------------|:----:|
| `packages/memory/src/dream-cycle.ts` | **MODIFY** | Collapse dual-path when Brain is SQLite-backed (`:217-218`) | MEDIUM |
| `packages/memory/src/lifecycle.ts` | **MODIFY** | Remove manual `brainStore.persist*` when durable (`:125-145`) | LOW |

### Phase D (3 files: 1 created + 2 modified)

| File | Action | Key Changes | Risk |
|------|:------:|-------------|:----:|
| `packages/memory/src/brain-migrate-jsonl.ts` | **CREATE** | One-way JSONL→SQLite migration (reuses `BrainStore.load()`) | LOW |
| `packages/memory/src/brain-store.ts` | **MODIFY** | Add `@deprecated` JSDoc | LOW |
| `packages/memory/src/index.ts` | **MODIFY** | Update Dig 3 note to "✅ COMPLETE" (`:19-21`) | LOW |

**Total: ~16 files across 4 phases. ~8-10 days of effort.**

---

## 8. Risk Register + Rollback

| # | Risk | Severity | Mitigation | Rollback |
|---|------|:--------:|------------|----------|
| GAP-1 | In-place Fact mutations invisible to SQLite — **4 sites**: `embed()`, `consolidate()` (✅ Phase A); `lifecycle.recordAccess()`, `SyncDomain.onRecord()` (🛑 Phase B) | **HIGH** | Sites 1–2 patched in Phase A + verified by spy-storage test (A-GATE-2/3). Sites 3–4 BLOCKING for Phase B — add `brain.touchFact()` persistence path + B-GATE durability tests. | Sites 1–2: remove `putFact()` (InMemory still works). |
| RISK-1 | `manager.ts:313-330` reaches into private Maps | MEDIUM | Rewrite to `brain.loadFromSnapshot()` in Phase A. Gate A-GATE-4. | Revert to `as unknown as` access (compiles only if Maps exist). |
| RISK-2 | `lifecycle.ts:125-145` dual-persistence confusion during transition | MEDIUM | Phase C removes manual persistence when Brain is durable. Gate C-GATE-2. | Keep JSONL manual persistence (harmless — append-only). |
| RISK-3 | `backlinksCache` invariant depends on live fact references | LOW | Seam returns live iterators, not copies. Do NOT introduce copy-on-read in `SqliteBrainStore`. Cache stays in Brain. | N/A — design constraint. |
| RISK-4 | Constructor 3rd param breaks callers | LOW | Verified: no production/test code passes 3 positional args. Default `new InMemoryBrainStorage()`. | Remove 3rd param (revert to Maps). |
| RISK-5 | Sync SQLite writes add latency to hot path | MEDIUM-HIGH | WAL mode makes writes ~1ms. Profile 10k `recordFact()` calls (Gate B-GATE-7). If too slow, consider async flush with sync cache write. | Switch to `InMemoryBrainStorage` (sync Map — zero SQLite overhead). |
| RISK-6 | `shared-instances.ts:92` module-level singleton cannot be re-wired | LOW | Phase B adds config option; default stays InMemory. Lazy init pattern possible. | Default constructor remains InMemory. |

### Rollback Strategy

Each phase is independently revertible:
- **Phase A rollback:** Remove `storage` field, restore 4 Maps. Tests still pass.
- **Phase B rollback:** Don't construct `SqliteBrainStore` — Brain falls back to `InMemoryBrainStorage`.
- **Phase C rollback:** Restore `dream()` dual-path dispatch. Keep JSONL manual persistence.
- **Phase D rollback:** Keep JSONL as active persistence path. `brain-migrate-jsonl.ts` is additive (no destructive change).

---

## 9. Test Strategy

### Existing Tests (must stay green throughout)

All 707 memory tests pass unchanged through every phase. The `InMemoryBrainStorage`
default ensures backward compatibility:
- `domains.test.ts` (13 domains × Brain API)
- `brain.test.ts` (Brain CRUD + analysis phases)
- `dream-cycle.test.ts` (Brain path — InMemory default)
- `lifecycle.test.ts` (tick + persistence)
- `manager.test.ts` (withBrain + loadFromBrainStore)

### New Tests

| File | Phase | Coverage |
|------|:-----:|----------|
| `brain-storage.test.ts` | A | `InMemoryBrainStorage` CRUD for facts, takes, pages, tombstones. GAP-1 tests: `embed()` + `consolidate()` through storage. |
| `brain-sqlite-store.test.ts` | B | SQLite write-through, durability (close/reopen), GAP-1 persistence across restart, performance (10k facts iteration < 50ms; 10k `recordFact()` measured). |
| `brain-dig3-integration.test.ts` | B/C | End-to-end: `SqliteBrainStore` + Brain → full dream-cycle → close → reopen → verify consolidation survives restart. |
| `brain-migrate-jsonl.test.ts` | D | JSONL → SQLite migration: facts/takes/pages/tombstones round-trip. Idempotency. |

### Test Count Impact

- Phase A: +~30 tests (storage CRUD + GAP-1). Total: ~737.
- Phase B: +~25 tests (SQLite store + durability). Total: ~762.
- Phase C: +~10 tests (dual-path collapse). Total: ~772.
- Phase D: +~10 tests (migration). Total: ~782.

---

## 10. Definition of Done

- [ ] **A-D-GATE:** All gates from §6 are satisfied.
- [ ] **707 baseline:** Original 707 memory tests pass with `InMemoryBrainStorage`.
- [ ] **SQLite-backed Brain:** Brain facts survive close/reopen with `SqliteBrainStore`.
- [ ] **GAP-1 verified:** `embedded` + `consolidatedAt`/`consolidatedInto` persist across restart.
- [ ] **Dual-path collapsed:** Dream-cycle uses single Brain path when SQLite-backed.
- [ ] **JSONL deprecated:** `brain-store.ts` marked `@deprecated`, migration tested.
- [ ] **index.ts updated:** Dig 3 note changed to "✅ COMPLETE" (`index.ts:19-21`).
- [ ] **Performance profiled:** `recordFact()` p99 latency measured and acceptable (< 5ms with WAL).
- [ ] **13 domains unchanged:** No domain file modified — they call Brain's public API only.

---

## 11. Comparison vs Rejected "Accept the Split" Plan

`docs/memory-migration-plan.md` proposed **Strategy B: Accept the Split** —
keep Brain and SQLite as permanently separate systems, annotate the split
as "by design". Its own verification verdict (`memory-migration-plan.md:7-25`)
**rejected** the deletions (F3/F4/F5) that would have erased the Dig 3
roadmap signal.

| Dimension | Rejected Plan ("Accept the Split") | Dig 3 (This Plan) |
|-----------|-------------------------------------|--------------------|
| **Brain persistence** | JSONL forever (process-local, lost on crash) | SQLite WAL (durable, crash-safe) |
| **Dream-cycle** | Dual-path persists (`dream-cycle.ts:217-218`) | Single path collapses (Phase C) |
| **Data unification** | Never — two stores diverge | Brain facts in `memory.db`, queryable alongside SMM |
| **`index.ts:19-21` note** | Plan would erase it (F3 — rejected) | Plan fulfills it |
| **`@deprecated` on Brain** | Contradicts "accept the split" (Brain stays) | Justified — storage unified, Brain's *computation* remains |
| **Roadmap alignment** | Contradicts codebase's own signal | Implements exactly what `index.ts:20` describes |
| **Risk** | Low (do nothing) — but accumulates technical debt | Medium (8-10 days) — pays down the debt |
| **Reversibility** | N/A | Each phase independently revertible |

**Why Dig 3 is the correct fix:** The codebase already signals Brain as
deprecated (`index.ts:19`) and documents the unification path (`index.ts:20`).
The dream-cycle already branches on SQLite availability (`dream-cycle.ts:217`).
The 13 domains already use only Brain's public API (verified — no private
field access). The infrastructure (`sqlite-schema.ts`, `sqlite-store.ts`,
`migrate.ts`) already exists. Dig 3 is the *completion* of a migration that
was started but paused — not a new initiative.

---

## 12. Open Questions (For Leader/Product Decision)

1. **Sync vs async SQLite writes (RISK-5):** Should `BrainStorage.putFact()`
   return `void` (sync) or `Promise<void>` (async)?
   - **Recommendation:** Sync interface with sync cache write + sync SQLite
     write (WAL mode, ~1ms). Profile before committing. If async is needed,
     add a separate `flush()` method — cache writes stay sync.

2. **`loadFromSnapshot()` API location:** Public method on Brain, or should
   `manager.ts` use the storage interface directly?
   - **Recommendation:** Public method on Brain — encapsulates `backlinksCache`
     invalidation.

3. **Phase C scope for `dreamSQLite()`:** Remove entirely or keep as SMM
   auto-capture bridge?
   - **Recommendation:** Keep `dreamSQLite()` for SMM's `working_memory`
     auto-capture path (different data source). Only the *dispatch* in
     `dream()` collapses when Brain is SQLite-backed.

4. **`shared-instances.ts:92` singleton re-wiring:** How to make the
   module-level `brain` singleton SQLite-backed?
   - **Recommendation:** Phase B adds a config option (env var or constructor
     arg); default remains `InMemoryBrainStorage`. Lazy init pattern.

5. **Existing `migrate.ts` lossy path:** Deprecate the Brain-fact→`working_memory`
   migration in favor of full-fidelity `brain-migrate-jsonl.ts`?
   - **Recommendation:** Yes. `migrate.ts:40` normalizes notability (0-10 → 0-1)
     and loses `entity`/`visibility`/`consolidatedInto`/`embedded`. The new
     migration preserves all fields.

# Memory Migration Plan — Resolving the Brain / SQLite Dual-System

> **Status:** READ-ONLY analysis + decision document. No source modified.
> **Source of truth:** Verified against code at the commit on 2025-07-27.
> Every claim is cited `file:line`.

---

## ⚠️ VERIFICATION VERDICT (post-review — supersedes the decision below)

A skeptical re-verification of **every deletion/cleanup item** against the actual code was performed on 2026-07-27. **Key finding: this plan over-corrects.** Strategy B ("accept the split") with its deletions **F3/F4/F5 would silently abandon a documented roadmap item** and contradict the codebase's own signals. The original finding-#6 framing ("incomplete migration, Brain is legacy being phased out") is the *more accurate* one.

The codebase consistently signals Brain = legacy, SQLite = intended replacement, full unification deferred to a refactor documented in code as **"Dig 3 de-fragmentation"** (`packages/memory/src/index.ts:19-21`):

> `@deprecated` Legacy in-memory belief graph (pre-SQLite). Kept for the dream-cycle. **Routing Brain through a GraphStore adapter is a future refactor (Dig 3 de-fragmentation).**

### Per-item verdict

| Item | Action | Rationale (evidence) |
|------|:------:|----------------------|
| **F8** remove dead `memoryBackend` config | ✅ **PROCEED** | Exhaustive grep: in `packages/` `config.memoryBackend` is only *defined* (`shared-instances.ts:54`) and *loaded* (`:68`), never *read*. Independently corroborated by `docs/AUDIT-INTEGRATION.md:187`. Also remove env `MYA_MEMORY_BACKEND`. |
| **F1** fix `/memory` to show SQLite | ⚠️ **DEFER — owner decision** | Inconsistency is real (`/memory` reads `brain.factCount` at `mya-bridge.ts:1543-1546` while recall uses SQLite), but changing output is a *behavioral* choice, not a clear bugfix — the command's stated purpose is "Show Brain stats". Owner decides what `/memory` should show. |
| **F3** remove `@deprecated` from Brain | 🛑 **REJECT** | The `@deprecated` text documents the planned **"Dig 3 de-fragmentation"** refactor. Removing it discards roadmap signal — it is NOT a stale label. |
| **F4** change "Replaces" → "Complements" | 🛑 **REJECT** | `sqlite-manager.ts` header states the *end-goal* ("Replaces the old ... Brain"). Flipping to "Complements" reverses the stated architecture intent to "coexist forever" — a strategic reversal, not a comment fix. |
| **F5** change "Legacy Brain" label | 🛑 **REJECT** | `dream-cycle.ts:95` "Legacy Brain (old system)" accurately signals Brain's status. (Note: plan cited line 94; actual is 95.) |
| **F6/F7** add "dual-engine by design" comments | ⚠️ **REFRAME** | OK to document *current* behavior, but frame as "current state, Dig 3 pending", **not** "permanent by-design split" — the latter presupposes abandoning the roadmap. |
| **F9/F10** cron double-fire | ✅ **PROCEED** (read-only investigation) | No signal conflict. |

**Net:** of the deletions, **only F8 is safe.** F3/F4/F5 must be kept (they carry roadmap signal). F1 is an owner decision. The "accept the split" decision should only be taken as an *explicit* product call to abandon Dig 3 — never as a side-effect of "cleanup".

> The sections below are the *original* plan text, retained for traceability. Read them through the lens of the verdict above.

---

## 1. Decision: Strategy B — Accept the Split (Corrected)

**The two memory engines serve fundamentally different purposes and should NOT be unified.**

| Engine | Role | Data model | Persistence | Used by |
|--------|------|------------|-------------|---------|
| **Brain** | In-process zero-LLM analysis engine (10+ regex/heuristic phases) | Flat `Map<id, Fact>` + Takes/Pages | Optional JSONL (`brain-store.ts`) | SDK live path (`agent/src/index.ts:262`) |
| **SqliteMemoryManager** | Durable unified store (5-layer pipeline, FTS5, vector, temporal decay) | Relational: working/episodic/facts/triples | SQLite WAL (`memory.db`) | TUI/gateway path (`mya-bridge.ts`), auto-capture, dream-cycle |

### Why NOT Strategy A (Finish migration / retire Brain)?

Brain provides **10 zero-LLM analysis phases** with no SQL equivalent (`brain.ts:181–520`):

| # | Phase | What it does | SQL equivalent |
|---|-------|-------------|----------------|
| 1 | `backlinks()` | Extract typed edges (`[Name](path)`, `[[wikilink]]`, bare-name) from fact content | None |
| 2 | `extractFacts()` | Regex extraction: dates, URLs, emails, commits, versions | None |
| 3 | `lint()` | Validate: empty content, near-duplicates, missing entity | Partial (FTS dedup) |
| 4 | `orphans()` | Find isolated facts not connected by any edge | None |
| 5 | `schemaSuggest()` | Detect likely-duplicate entities (case-insensitive, alias overlap) | None |
| 6 | `resolveSymbolEdges()` | Cross-entity reference discovery (bare-name match) | None |
| 7 | `conversationFactsBackfill()` | Scan conversation for capitalized names matching known entities | None |
| 8 | `embed()` | Mark facts as indexed for vector arm | Partial (ONNX embeddings) |
| 9 | `purgeTombstones()` | Soft-delete with tombstone cleanup (72h retention) | Partial (supersede) |
| 10 | `consolidate()` | Ebbinghaus decay lifecycle on facts (L0/L1/L2 tiers) | Partial (Weibull decay) |

**Retiring Brain would lose 7 phases with zero SQL equivalent** and require rewriting ~250 tests across 9 Brain-specific test files. The SDK path (`agent/src/index.ts`) is tested and functional today.

### Why NOT Strategy C (Hybrid / SQLite backing for Brain)?

The two data models are structurally incompatible:
- Brain = flat `Map<id, Fact>` with entity/content/kind/visibility/notability/source fields (`brain.ts`)
- SQLite = 5-layer schema (working/episodic/facts/triples) with scope, agent_id, turn_id, importance, veracity, valid_until, conflict resolution (`sqlite-store.ts`)

A write-through sync layer between these would be a **silent data-corruption risk** (conflicting data models → which wins on read?). The cost is unjustified because the SDK path works today with optional JSONL persistence.

### What does Strategy B (Corrected) actually change?

Strategy B is **not** comment-only. The analyst identified a **behavioral bug** that must be fixed regardless:

| Change | Type | Severity | Post-review verdict |
|--------|------|----------|--------------------|
| Fix `/memory` TUI command to show SQLite stats (not stale Brain zeros) | **Behavioral** | High (user-visible bug) | ⚠️ **DEFER** — owner behavioral decision |
| Remove `@deprecated` from Brain export, document as SDK engine | Comment | Medium (misleading) | 🛑 **REJECT** — discards Dig 3 roadmap signal |
| Fix "Replaces" claim in sqlite-manager.ts header | Comment | Medium (misleading) | 🛑 **REJECT** — reverses stated end-goal |
| Fix "Legacy Brain" label in dream-cycle.ts | Comment | Low | 🛑 **REJECT** — label is accurate |
| Remove or wire dead `memoryBackend` config | Cleanup | Low | ✅ **PROCEED** — dead, corroborated |
| Investigate cron-session DreamCycle double-fire | Investigation | Medium | ✅ **PROCEED** — read-only investigation |

---

## 2. Current-State Architecture (Dual-System Map)

```
                     ┌─────────────────────────────────────┐
                     │         shared-instances.ts          │
                     │  (instantiates BOTH engines at        │
                     │   module load)                        │
                     │                                       │
                     │  brain = new Brain()          (:79)  │
                     │  memory = MemoryManagerImpl          │
                     │    .withBrain({brain, domains}) (:95)│
                     │  sqliteMemory = new                  │
                     │    SqliteMemoryManager(dbPath)(:130) │
                     └──────┬──────────────────────┬────────┘
                            │                      │
              ┌─────────────┘                      └──────────────┐
              ▼                                                   ▼
  ┌───────────────────────┐                       ┌──────────────────────────┐
  │   SDK LIVE PATH        │                       │   TUI / GATEWAY PATH     │
  │   agent/src/index.ts   │                       │   print/src/mya-bridge.ts│
  │                        │                       │                          │
  │ new Brain() (:262)     │                       │ turn_end (:498-508):     │
  │ DreamCycle(brain)      │                       │  sqliteMemory.lifecycle()│
  │   (:264-266)           │                       │    → preferred           │
  │                        │                       │  else lifecycleManager   │
  │ runDreamCycle()        │                       │    → fallback            │
  │  (:494-501):           │                       │  else memory.consolidate │
  │   brain.backfill()     │                       │    → fallback            │
  │   brain.consolidate()  │                       │  else brain.consolidate  │
  │   brain.backlinks()    │                       │    → last resort         │
  │   memory.syncAll()     │                       │                          │
  │                        │                       │ recall (:923-925):       │
  │ memory.refresh()       │                       │  sqliteMemory.recall()   │
  │   (:400,561)           │                       │    → preferred           │
  └───────────┬───────────┘                       │  else domain fan-out     │
              │                                    │                          │
              │           ┌────────────────────────┘  /memory (:1543-1546):   │
              │           │                            reads brain.factCount   │
              │           │                            → ALWAYS STALE/ZERO ⚠️  │
              ▼           ▼                                                  │
  ┌──────────────────────────────────────────────────────────────┐           │
  │                  CRON HYBRID PATH                              │           │
  │                  main.ts:372-389                               │           │
  │                                                                │           │
  │  createAgentSession (SDK → Brain-based createAgent)            │           │
  │    +                                                           │           │
  │  createMyaBridge({ brain, memory, sqliteMemory, ... }) (:379)  │           │
  │                                                                │           │
  │  ⚠️ BOTH engines active in same session                         │           │
  │  ⚠️ SDK DreamCycle (Brain) + bridge DreamCycle (SQLite)          │           │
  │     may BOTH fire → redundant consolidation                     │           │
  └────────────────────────────────────────────────────────────────┘           │
                                                                                │
  ┌─────────────────────────────────────────────────────────────────┐         │
  │  DREAM CYCLE (dream-cycle.ts:192-200)                            │         │
  │                                                                   │         │
  │  if (this.sqliteMemory) → dreamSQLite()     ← preferred           │         │
  │  else if (this.brain)   → legacy Brain path  ← fallback           │         │
  │                                                                   │         │
  │  Disjoint: Brain stores to its Map; SQLite stores to memory.db    │         │
  │  migrate.ts: one-way JSONL→DB (idempotent, runs on shared-        │         │
  │  instances init at :135)                                          │         │
  └─────────────────────────────────────────────────────────────────┘         │
                                                                                ▼
  ┌─────────────────────────────────────────────────────────────────────────┐
  │  13 DOMAINS (domains/*.ts) — all Brain-coupled                          │
  │  init(brain: Brain) at domains/types.ts:42                              │
  │  archivist, tree, diff, goals, sync, graph, conversations,             │
  │  search, sources, entities, store, tools, queue                         │
  │  None have a SQLite-backed variant.                                     │
  └─────────────────────────────────────────────────────────────────────────┘

  ┌─────────────────────────────────────────────────────────────────────────┐
  │  PORT SEAM (ports.ts:38-62)                                             │
  │  MemoryStore interface: record() / recall() / lifecycle() / getDB()    │
  │  SqliteMemoryManager satisfies it ✓                                     │
  │  Brain does NOT ✗ (different method surface)                            │
  └─────────────────────────────────────────────────────────────────────────┘
```

### Do the two engines share ANY data?

**No.** Fully disjoint at runtime:
- Brain stores facts in an in-memory `Map` + optional `brain.jsonl` (`brain-store.ts`)
- SQLite stores in `memory.db` (5-layer relational schema)
- `migrate.ts` is one-way idempotent JSONL→DB (runs at `shared-instances.ts:135`)
- No write-through, no bidirectional sync

---

## 3. Target Architecture (Post-Decision)

```
  ┌─────────────────────────────┐     ┌──────────────────────────────────┐
  │  SDK PATH (programmatic)     │     │  TUI / GATEWAY / CLI PATH        │
  │  agent/src/index.ts          │     │  print/src/mya-bridge.ts          │
  │                              │     │                                   │
  │  Brain (documented as        │     │  SqliteMemoryManager              │
  │   "SDK in-process engine")   │     │  (documented as "durable store    │
  │  + 13 domains                │     │   for interactive sessions")      │
  │  + DreamCycle (Brain)        │     │  + auto-capture                   │
  │  + DreamCycle (Brain)        │     │  + DreamCycle (SQLite-preferred)  │
  │                              │     │  + /memory (shows SQLite stats)   │
  │  These two NEVER unify.      │     │                                   │
  └─────────────────────────────┘     └──────────────────────────────────┘
                    │                                   │
                    └──────────┬────────────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │  CRON HYBRID PATH    │
                    │  main.ts:372-389     │
                    │                      │
                    │  SDK agent (Brain)   │
                    │  + Bridge (SQLite)   │
                    │                      │
                    │  FIXED: single        │
                    │  DreamCycle owner     │
                    └──────────────────────┘
```

### Key principle
The two engines are **complementary**, not competing. Brain's zero-LLM analysis phases and SQLite's durable recall pipeline serve orthogonal needs. The design intent is **delegation by preference** (SQLite wins when present), not unification.

---

## 4. File-by-File Change List

### Phase 1: Behavioral Fix (do first — user-visible bug)

| # | File | Line(s) | Change | Effort | Dependencies |
|---|------|---------|--------|--------|-------------|
| F1 | `packages/print/src/mya-bridge.ts` | 1543-1546 | **Fix `/memory` command**: when `opts.sqliteMemory` is present, show SQLite stats (table counts via `countTable()`). Fall back to Brain stats only when SQLite absent. ⚠️ **DEFER (post-review)**: behavioral change, not a clear bugfix — the command's stated purpose is "Show Brain stats". Needs owner decision on what `/memory` should display. | Small (1 function rewrite) | None |
| F2 | `packages/print/src/mya-bridge.test.ts` | — | **New test**: `/memory` with `sqliteMemory` present shows SQLite stats, not "Brain not configured". Add test for SQLite-absent fallback to Brain. | Small | F1 |

### Phase 2: Comment/Documentation Accuracy (low risk)

| # | File | Line(s) | Change | Effort |
|---|------|---------|--------|--------|
| F3 | `packages/memory/src/index.ts` | 19-22 | Remove `@deprecated` JSDoc. Replace with: "SDK in-process engine for zero-LLM analysis phases. NOT deprecated — actively used by the agent SDK path." 🛑 **REJECT (post-review)**: the existing text documents the planned "Dig 3 de-fragmentation" refactor (`Routing Brain through a GraphStore adapter is a future refactor`). Removing it discards roadmap signal. | Trivial |
| F4 | `packages/memory/src/sqlite-manager.ts` | 5 | Change "Replaces the old MemoryManagerImpl + Brain + MemoryTree + 13 domains" → "Durable store for interactive TUI/gateway sessions. Complements (does not replace) the Brain engine used by the SDK path." 🛑 **REJECT (post-review)**: "Replaces" states the intended end-goal. Flipping to "Complements" is a strategic reversal, not a comment fix. | Trivial |
| F5 | `packages/memory/src/dream-cycle.ts` | 95 | Change "Legacy Brain (old system)" → "Brain engine (used when SqliteMemoryManager is unavailable — e.g. SDK-only sessions)" 🛑 **REJECT (post-review)**: the label is accurate (Brain IS legacy). Line number corrected 94→95. | Trivial |
| F6 | `packages/print/src/shared-instances.ts` | 79-130 | Add block comment documenting the dual-engine split: "Both Brain and SQLite are instantiated by design. Brain powers SDK analysis phases; SQLite powers TUI durability. SQLite wins the turn_end preference cascade." | Trivial |
| F7 | `packages/print/src/mya-bridge.ts` | 498-508 | Add comment: "SQLite-always-wins preference cascade. This is intentional — SQLite is the durable store for TUI sessions." | Trivial |

### Phase 3: Dead Config Cleanup

| # | File | Line(s) | Change | Effort | Risk |
|---|------|---------|--------|--------|------|
| F8 | `packages/print/src/shared-instances.ts` | 54, 68 | Remove `memoryBackend` from `MyaConfig` interface and `loadConfig()`, plus the env read `process.env["MYA_MEMORY_BACKEND"]`. ✅ **PROCEED (post-review)**: confirmed dead — exhaustive grep finds no reader; corroborated by `docs/AUDIT-INTEGRATION.md:187`. | Trivial | Low — no consumer exists |

### Phase 4: Investigation (medium — requires tracing cron lifecycle)

| # | File | Line(s) | Change | Effort | Risk |
|---|------|---------|--------|--------|------|
| F9 | `packages/agent/src/index.ts` | 262-266 | Investigate: the SDK path creates its own `DreamCycle(brain)` and calls `dreamCycle.start()`. When a cron session (`main.ts:372-389`) uses `createAgentSession` (SDK) + `createMyaBridge` (bridge), BOTH the SDK DreamCycle and the bridge DreamCycle are wired. Determine whether both fire and whether this causes redundant consolidation. | Medium (investigation) | Medium |
| F10 | `packages/print/src/mya-bridge.ts` | 205-207 | If F9 finds double-fire: add a guard so only one DreamCycle runs per session (e.g. SDK DreamCycle suppressed when bridge DreamCycle is active, or vice versa). | Medium (fix) | Medium |

### Sequencing

```
Phase 1 (F1-F2)  ────────→  Behavioral fix + test
Phase 2 (F3-F7)  ────────→  Comment accuracy (parallel-safe, no overlap)
Phase 3 (F8)     ────────→  Dead config removal (independent)
Phase 4 (F9-F10) ────────→  Investigation + conditional fix (after Phase 1)
```

Phases 1-3 can proceed in parallel. Phase 4 requires Phase 1 to be done first (to ensure test coverage is stable before investigating timing).

---

## 5. Risk Register + Rollback

| ID | Risk | Likelihood | Impact | Mitigation | Rollback |
|----|------|-----------|--------|------------|----------|
| R1 | `/memory` shows stale Brain data (current bug) | **Certain** | Medium | F1 fixes this | Revert F1 |
| R2 | F1 changes `/memory` output format → breaks user scripts parsing it | Low | Low | Keep format similar (`[mya] Memory: N facts, M working, K episodic`) | Revert F1 |
| R3 | F8 removes `memoryBackend` → user has it in config.json | Low | Low | Field was never read; removing the interface key is safe (JSON ignores unknown keys) | Re-add field |
| R4 | Cron DreamCycle double-fire causes redundant LLM calls | Medium | Low | F9-F10 investigation | Disable SDK DreamCycle in cron path |
| R5 | Future developer sees Brain is "not deprecated" and hesitates to refactor | Low | Low | F3-F5 documentation clarifies role | N/A |
| R6 | SDK path needs durability across restarts (currently JSONL only) | Unknown | Medium | If this arises, implement Strategy C via `ports.ts` MemoryStore seam with a SQLite-backed BrainStore adapter | Build adapter |

### Rollback strategy
All changes are additive or comment-only except F1 (`/memory` behavioral). F1 is a single function — revert restores old behavior. No schema migration, no data migration needed.

---

## 6. Test Strategy

### Existing tests that MUST still pass (0 failures)

| Suite | Location | Count | What it covers |
|-------|----------|-------|---------------|
| Brain unit tests | `packages/memory/src/brain.test.ts` | ~80 | All 10 analysis phases |
| Domain tests | `packages/memory/src/domains/*.test.ts` | ~150 | 13 domain `init(brain)` wiring |
| SQLite tests | `packages/memory/src/sqlite-*.test.ts` | ~120 | Store, recall, consolidate, lifecycle |
| Dream-cycle tests | `packages/memory/src/dream-cycle.test.ts` | ~40 | Dual-path logic, decline strategy |
| Conflict/governance | `packages/memory/src/{conflict,governance,grounding}.test.ts` | ~60 | Trust, contradiction detection |
| Manager/pipeline | `packages/memory/src/{manager,lifecycle,store,tree}.test.ts` | ~120 | MemoryManagerImpl, LifecycleManager |
| Total memory tests | `packages/memory/src/` | ~707 | Full memory subsystem |

**Verification command:** `npx vitest run packages/memory/ --testTimeout=5000`

### New tests required

| # | File | Test description | AC |
|---|------|-----------------|-----|
| T1 | `packages/print/src/mya-bridge.test.ts` | `/memory` with `sqliteMemory` present → shows SQLite table counts | AC-1 |
| T2 | `packages/print/src/mya-bridge.test.ts` | `/memory` with only `brain` present → shows Brain stats (backward compat) | AC-1 |
| T3 | `packages/print/src/mya-bridge.test.ts` | `/memory` with neither → "Memory not configured" | AC-1 |

### Tests NOT required (no regression risk)
- No SDK path test changes needed (Brain instantiation unchanged)
- No domain test changes needed (init signatures unchanged)
- No SQLite test changes needed (SQLite code unchanged)

---

## 7. Definition of Done

- [ ] **AC-1**: `/memory` command shows SQLite stats when SQLite is present, Brain stats when absent, "not configured" when neither
- [ ] **AC-2**: `packages/memory/src/index.ts` Brain export does NOT contain `@deprecated`, documents role as SDK engine
- [ ] **AC-3**: `packages/memory/src/sqlite-manager.ts` header does NOT claim to "Replace" Brain, describes as complementary durable store
- [ ] **AC-4**: `packages/memory/src/dream-cycle.ts` Brain branch is NOT labeled "Legacy"
- [ ] **AC-5**: `memoryBackend` dead config removed from `MyaConfig` (or wired with tests if kept)
- [ ] **AC-6**: Cron DreamCycle double-fire investigated; if confirmed, a guard is in place to ensure only one DreamCycle consolidates per session
- [ ] **AC-7**: `npx vitest run packages/memory/` — all ~707 tests pass with 0 failures
- [ ] **AC-8**: New tests T1-T3 pass
- [ ] **AC-9**: `npx vitest run packages/print/src/mya-bridge.test.ts` — all tests pass including new T1-T3
- [ ] **AC-10**: `docs/mya-deep-analysis.md` Finding #6 updated to reflect "Strategy B (Corrected) accepted"

---

## Appendix A: Verified Coupling Points (Brain imports/uses)

Every file that imports or uses `Brain` in production (non-test) code:

| File | Line | Usage |
|------|------|-------|
| `packages/memory/src/brain.ts` | 1 | Definition |
| `packages/memory/src/index.ts` | 20-22 | Export (`@deprecated`) |
| `packages/memory/src/dream-cycle.ts` | 29, 94, 192-200 | DreamCycle dual-path (brain fallback) |
| `packages/memory/src/tree.ts` | — | `MemoryTree` constructor takes `Brain` |
| `packages/memory/src/lifecycle.ts` | — | `LifecycleManager` constructor takes `Brain` + `MemoryTree` |
| `packages/memory/src/manager.ts` | — | `MemoryManagerImpl.withBrain({ brain, ... })` |
| `packages/memory/src/domains/types.ts` | 42 | `init(brain: Brain)` signature |
| `packages/memory/src/domains/*.ts` | — | All 13 domain modules import `Brain` |
| `packages/agent/src/index.ts` | 262, 264-266, 496-498 | SDK live path: `new Brain()`, `DreamCycle(brain)`, `brain.backfill/consolidate/backlinks` |
| `packages/print/src/shared-instances.ts` | 79 | `brain = new Brain()` |
| `packages/print/src/shared-instances.ts` | 95-103 | `MemoryManagerImpl.withBrain({ brain, domains })` |
| `packages/print/src/shared-instances.ts` | 111 | `memoryTree = new MemoryTree(brain)` |
| `packages/print/src/shared-instances.ts` | 112 | `lifecycleManager = new LifecycleManager(brain, memoryTree)` |
| `packages/print/src/mya-bridge.ts` | 1543-1546 | `/memory` command reads `opts.brain.factCount` |
| `packages/print/src/mya-bridge.ts` | 506 | turn_end fallback: `opts.brain.consolidate()` |
| `packages/print/src/mya-bridge.ts` | 925 | recall fallback: `mem.recall()` (domain fan-out) |

## Appendix B: Dead Config Verification

`config.memoryBackend` is defined at `shared-instances.ts:54` and loaded at `:68` but **never read**:

- No `.memoryBackend` access found in any `packages/` source file
- No conditional branching on backend type
- No routing based on backend selection
- `loadConfig()` returns it, but the return value is never inspected for this field

## Appendix C: Open Questions (Deferred)

| # | Question | Deferral Rationale |
|---|----------|-------------------|
| Q1 | Does the SDK path need durability across process restarts? | JSONL persistence (`brain-store.ts`) currently suffices. If insufficient, implement Strategy C via `ports.ts` seam. |
| Q2 | Should the 13 domains eventually work with SQLite? | No consumer needs this today. The `MemoryStore` port (`ports.ts:38`) is the seam if needed. |
| Q3 | Should `config.memoryBackend` be wired for runtime backend selection? | Adds branching complexity for no current benefit. Removed as dead code (F8). Can be re-added if needed. |

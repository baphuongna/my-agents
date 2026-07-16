# Memory Redesign — Execution Plan

**Goal**: Implement the 5-phase memory architecture from `docs/best-memory-architecture.md`. Each phase: implement → 3 review rounds (correctness / security / architecture-regression) → 1 verify round. After all phases: full test suite.

**Discipline per phase**:
1. **Implement** (executor) — make the changes per spec
2. **Review round 1 — correctness/bugs** (reviewer) — logic errors, edge cases, off-by-one
3. **Review round 2 — security** (security-reviewer) — injection, trust boundaries, data leak
4. **Review round 3 — architecture/regression** (cold-verifier, fresh eyes) — does it fit the design? regressions? does it actually fix the dig?
5. **Fix** — address review findings
6. **Verify** (verifier) — does the implementation meet the phase acceptance criteria? tests pass?

Sequencing: phases are **sequential** (each builds on prior; files overlap). No worktree (same repo, linear).

---

## Phase 1 — Retention (fixes Dig 7) ⭐ URGENT

**Why first**: the user's catch; brain degrades over time regardless of correctness. Smallest (~80 lines), highest ROI.

**Spec**:
- `packages/memory/src/sqlite-schema.ts`: add `retention_score REAL` column to `working_memory` + `episodic_memory` (via `addColumnIfMissing` — pattern already exists). Add `valid_until` to `working_memory` if missing (it's on episodic; check working).
- `packages/memory/src/sqlite-store.ts`: at `storeWorking()` capture, set `valid_until = now + TTL(memoryType)` per-type TTL (event=7d, commitment=90d, preference=90d, fact=365d — copy gbrain `facts/decay.ts` halflives).
- New `packages/memory/src/retention.ts`: `retentionScore(memory)` = `salience(type) · e^(-λ·age) + σ · Σ(1/daysSinceAccess)` (agentmemory formula; salience map per type; access via existing access-log if present, else 0). `retentionSweep(db)` = hard-DELETE below `cold` threshold (0.15) WHERE `pinned != true`, return count + audit.
- `packages/memory/src/sqlite-manager.ts` / `dream-cycle.ts`: call `retentionSweep` in lifecycle/dream tick.
- Existing `purgeExpired` (already DELETEs WHERE valid_until < now) now FIRES because valid_until is set at capture.

**Acceptance criteria**:
- `valid_until` set at capture per type TTL (verifiable: insert a fact, check column)
- `retentionSweep` hard-DELETEs low-score rows (unit test: seed old low-importance, sweep, assert DELETE count)
- `pinned` rows survive sweep
- Existing `purgeExpired` fires (not no-op)
- No regression: 841 tests still pass

**Review focus**: TTL correctness (timezone/off-by-one), DELETE safety (no cascade accident), score formula edge cases (age=0, no access), pinned default.

---

## Phase 2 — Re-adopt mya-v1 conflict.rs (fixes Dig 2-3) — OWN CODE

**Why**: mya's own predecessor had working conflict resolution; rewrite dropped it. Cheap (~150 lines), proven.

**Spec**:
- New `packages/memory/src/conflict.ts` (TS port of `source/mya-v1/crates/mya-memory/src/conflict.rs`):
  - `checkAndResolveConflicts(store, key, content, category, threshold)`: recall top-10, for each Core candidate with score>threshold AND content≠new AND key≠new → supersede
  - `markSuperseded(db, oldIds, newId)`: `UPDATE memories SET superseded_by = ? WHERE id = ?`
  - `jaccardSimilarity(a, b)` fallback (no embeddings)
  - `findTextConflicts(entries, newContent, threshold)` pure function
- Wire into `sqlite-store.ts storeWorking()`: after insert, run conflict check against existing Core memories; supersede matches.
- Ensure recall filters `superseded_by IS NULL` (active only) — verify current recall SQL.

**Acceptance criteria**:
- Storing a conflicting Core memory marks the old `superseded_by` (unit test: store "prefer tabs", store "prefer spaces" similar, assert old superseded)
- Identical content = update not conflict (same key)
- Recall excludes superseded by default
- Re-adopt is faithful to mya-v1 semantics

**Review focus**: threshold tuning (jaccard fallback value), performance (recall top-10 on every write?), supersede atomicity, doesn't supersede across scopes.

---

## Phase 3 — Scope-derived (fixes Dig 4) — user's 3-tier done right

**Why**: implements the user's common/role/session proposal correctly (derived, not stored). Medium (~100 lines).

**Spec**:
- `packages/memory/src/sqlite-schema.ts`: ensure `working_memory` + `episodic_memory` have `agent_id TEXT`, `session_id TEXT`, `turn_id TEXT` columns (addColumnIfMissing).
- `packages/memory/src/sqlite-store.ts`: `WorkingMemoryInput` accepts `agentId?`, `turnId?` (sessionId exists). scope_level DERIVED: if turnId→turn, agentId→agent(role), sessionId→session, else user(common).
- `packages/memory/src/sqlite-recall.ts`: scope filter = `WHERE (scope='common' OR agent_id=? OR (session_id=? AND scope='session'))` — recall common + own-role + own-session.
- `packages/print/src/mya-bridge.ts`: pass `currentRole.name` as `agentId` on capture + recall.
- Roles config: `~/.mya/roles/*.json` already have the role names; auto-capture tags by active role.

**Acceptance criteria**:
- Capturing under role=coder → row has agent_id='coder'
- Recall under role=reviewer → does NOT see coder's session/role memories, DOES see common
- Switching roles changes visible memory
- Session memories isolated by session_id

**Review focus**: scope filter SQL correctness (no leak), migration safety (addColumnIfMissing), does agent_id default break existing rows (NULL → treated as common?).

---

## Phase 4 — Ports (fixes Dig 1, 3 fragmentation)

**Why**: unify the 4 dead subsystems behind one contract; enable engine knob. Larger.

**Spec**:
- New `packages/memory/src/ports.ts`: define `MemoryStore` interface (save, get, delete, query, supersede, getHistory, clearScope) + `VectorIndex`, `TextIndex`, `Embedder`, `MemoryCache`, `GraphStore` (headroom 6-port hexagon, TS).
- Refactor `sqlite-store.ts` → implements `MemoryStore`.
- Extract `MemoryEngine` orchestrator (composes ports) — minimal first, delegates to existing sqlite functions.
- Keep SQLite as only impl for now (Postgres deferred). The point: consumers depend on `MemoryStore` interface, not `SqliteMemoryManager` concrete.
- Mark Brain.ts + triples as deprecated (behind the interface, not deleted).

**Acceptance criteria**:
- `MemoryStore` interface exists + SQLite impl satisfies it
- Consumers (mya-bridge) reference the interface, not concrete class
- No behavior change (refactor only — all tests pass)
- Brain.ts/triples accessible via GraphStore port (not dead, just routed)

**Review focus**: interface completeness (does it cover all current callsites?), no behavior regression, doesn't over-abstract (YAGNI), migration path for future Postgres.

---

## Phase 5 — Governance + Grounding (fixes Dig 4 authority, Dig 6)

**Why**: epistemic polish. Largest, least urgent.

**Spec**:
- Governance: add `trust REAL DEFAULT 0.5` to memories. New `packages/memory/src/governance.ts`:
  - `applyFeedback(memoryId, helpful: boolean)`: trust += 0.05 / -= 0.10 (hermes holographic)
  - `recallWeight(score, trust) = score × trust`
  - `detectContradictions(store)`: find facts sharing entities with divergent content → surface (not auto-resolve)
- Grounding: new `ReferentStore` port + SQLite impl. `referents(memory_id, path, sha256, mtime, size)`. On recall, `metadata_match`/`metadata_changed` check → mark stale if referent changed (codebase-memory-mcp pattern).
- Wire referent capture for observations (tool outputs with file refs).

**Acceptance criteria**:
- Trust score adjusts on feedback, affects recall ranking
- Contradiction detection surfaces (doesn't auto-resolve) conflicting facts
- ReferentStore tracks file refs; recall flags stale when file hash changes
- Observations with file paths get grounded

**Review focus**: trust threshold tuning, contradiction false-positives, referent tracking overhead, grounding only for observations (not beliefs).

---

## Final — Full test suite

After Phase 5 verify:
- `npx vitest run` (full 841+ tests, expect growth from new phase tests)
- `npx tsc -b` (all packages clean)
- Bundle + smoke test `mya` (real PTY: capture/recall cycle)
- Manual: `/role` switching still works (roles fixes from earlier session intact)

---

## Out of scope (deferred, per architecture doc)

- Full Bayesian TMS (research-grade)
- Belief re-verification (unsolved)
- Postgres migration (until >50K memories)
- Multi-user (until Postgres+RLS)
- Shared-brain multi-agent (never — pi-crew mailbox instead)

---

## Execution status

- [x] Phase 1 — Retention ✅ (3review+1verify PASS)
- [x] Phase 2 — conflict.rs re-adopt ✅ (3review+1verify PASS)
- [x] Phase 3 — Scope-derived ✅ (3review+1verify PASS)
- [ ] Phase 4 — Ports
- [ ] Phase 5 — Governance + Grounding
- [ ] Final — Full test suite

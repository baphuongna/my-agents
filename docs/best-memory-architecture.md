# Best Memory Architecture for mya — Synthesis Proposal

**Goal**: Propose the best memory architecture for mya, synthesized from deep architectural reads of gbrain, headroom, mya-v1 (+ 9 other systems studied earlier). This is an opinionated design, not a feature dump — it picks the strongest pattern per concern and is honest about what to defer.

**Date**: 2026-07-16
**Inputs**: `memory-deep-dive-findings.md` (7 digs), `memory-reference-study-synthesis.md` (12 systems), `memory-architecture-reference.md` (7 themes), + deep reads of gbrain/headroom/mya-v1.

---

## Design principles (extracted, proven across systems)

These are non-negotiable — every mature system does them; mya does none:

1. **Ports-and-adapters** — storage behind interfaces (headroom 6 Protocols, gbrain BrainEngine, mya-v1 Memory trait). Consumers never couple to a backend. *mya couples directly to SQLite → every "add Postgres" is a rewrite.*
2. **Engine-as-deployment-knob** (gbrain) — same interface, SQLite default + Postgres scale path. Concurrency becomes a deployment choice, not an architecture rewrite. *Fixes Dig 1.*
3. **Source-of-truth separation** (gbrain markdown-as-truth) — a canonical store (human-readable) + a derived index (DB for query). Rebuildable. *Fixes Dig 3 fragmentation — one canonical, not 4 subsystems.*
4. **Scope-derived-not-stored** (headroom) — `scope_level` = function of which `*_id` slots are populated. No JOIN, no schema duplication. *Fixes Dig 4 role/agent scoping.*
5. **Tiered consolidation with gates** (gbrain/agentmemory) — working→episodic→semantic, promotion gated by count/age/similarity, NEVER-DELETE for audit tier. *Fixes Dig 2 log-vs-belief.*
6. **Temporal supersession** (headroom/mnemopi/mya-v1) — bitemporal `valid_from`/`valid_until`, atomic UPDATE-old+INSERT-new, point-in-time queries. *Fixes Dig 2-3 immortal contradictions.*
7. **Score-driven retention with real DELETE** (agentmemory) — `score = salience(type)·e^(-λ·age) + σ·Σ1/daysSinceAccess`, hard-DELETE below threshold + pin protection + audit. *Fixes Dig 7 (the user's catch).*
8. **Grounding via content-hash** (codebase-memory-mcp) — referent (file/entity) + hash → re-verify + self-expire. *Fixes Dig 6 (the only real grounding primitive found).*
9. **Trust/authority as data** (hermes holographic + mnemopi) — trust score OR Bayesian veracity, contradiction detection. *Fixes Dig 4 authority.*
10. **Multi-agent = DON'T share belief base** (pi-crew, universal) — mailbox + dependency-context + fresh-context. *The multi-agent answer.*

---

## The architecture (5 layers)

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 5 — APIs (1 core, many surfaces)                      │  headroom pattern
│  TUI /role · MCP server · gateway · bridge (markdown sync)   │
├─────────────────────────────────────────────────────────────┤
│  Layer 4 — Governance (trust + supersede + retention)        │  hermes+mnemopi+agentmemory
│  TrustScore · BayesianVeracity · ConflictDetect · Retention  │
├─────────────────────────────────────────────────────────────┤
│  Layer 3 — Tiers (consolidation pipeline)                    │  gbrain+agentmemory
│  working → episodic → semantic, gated promotion, audit-forever│
├─────────────────────────────────────────────────────────────┤
│  Layer 2 — Core orchestrator (MemoryEngine)                  │  headroom HierarchicalMemory
│  composes ports · scope-derived · bubbling · supersede       │
├─────────────────────────────────────────────────────────────┤
│  Layer 1 — Ports (swappable backends)                        │  headroom 6 Protocols
│  Store · Vector · Text · Embedder · Cache · Graph            │
│  └─ engine knob: SQLite (default) ─── Postgres (scale)       │  gbrain BrainEngine
└─────────────────────────────────────────────────────────────┘
```

### Layer 1 — Ports (the swappability seam)

Adopt headroom's 6-port hexagon verbatim (it's the cleanest):

```typescript
interface MemoryStore { save, saveBatch, get, delete, query(filter), supersede(oldId, newMemory), getHistory(id), clearScope(scope) }
interface VectorIndex { index, search(filter), remove, dimension, size }
interface TextIndex   { index, search(filter), remove }              // FTS5/BM25
interface Embedder    { embed(text), embedBatch, dimension, modelName }
interface MemoryCache { get, put, invalidate(id), invalidateScope(scope) }
interface GraphStore  { upsertEntity, upsertEdge, subgraph(roots, hops) }
```

**Engine knob (from gbrain)**: `MemoryStore` has 2 implementations — `SQLiteStore` (default, zero-config, WAL) and `PostgresStore` (scale path, MVCC + `FOR UPDATE SKIP LOCKED`). Same interface, same SQL dialect where possible. Consumers never branch. *This is the single most portable idea — start SQLite, scale Postgres, zero consumer rewrite.*

**Grounding port (from codebase-memory-mcp)**: add a 7th concern — `ReferentStore` tracking `(memory_id, referent_path, sha256, mtime, size)`. Recall re-verifies via `metadata_match`/`metadata_changed`. *The only real grounding primitive found; fixes Dig 6.*

### Layer 2 — Core orchestrator (MemoryEngine)

Headroom's `HierarchicalMemory` pattern — composes the 6 ports, owns:

- **Scope-derived** (Dig 4 fix): `scope_level` is a property over populated IDs:
  ```typescript
  get scopeLevel(): ScopeLevel {
    if (this.turnId) return "turn";
    if (this.agentId) return "agent";      // ← role-scoped
    if (this.sessionId) return "session";
    return "user";                          // ← common/shared
  }
  ```
  No JOIN. SQL renders scope as null-presence patterns. **This IS the user's 3-tier proposal (common/role/session) done right — derived, not stored.**

- **Bubbling** (headroom): `importance ≥ 0.7` auto-promotes session→user (copy with cleared narrow IDs, lineage via `promoted_from`). The host never thinks "remember this long-term" — high importance self-promotes.

- **Temporal supersede** (headroom + mya-v1 conflict.rs): atomic transaction UPDATEs old `valid_until` + INSERTs new, maintains `supersedes`/`superseded_by` chain. Point-in-time queries `[valid_from, valid_until)`. **Re-adopt mya-v1's `conflict.rs` (cosine/jaccard detect → supersede) — it's mya's own proven code, dropped in the rewrite.**

- **Singleflight init + cancellation-safe reset** (headroom): embedder cache (process-wide) + backend LRU + per-backend double-checked lock + CancelledError reset. N project DBs share 1 embedder.

### Layer 3 — Tiers (consolidation pipeline)

gbrain + agentmemory hybrid — 3 tiers with explicit gates:

| Tier | Purpose | Promotion gate | Retention |
|---|---|---|---|
| **working** (L0) | raw capture, session-scoped | — | TTL (e.g. 7d) + LRU cap |
| **episodic** (L1) | consolidated clusters | ≥3 working facts, ≥24h old, cosine≥0.85 cluster (gbrain consolidate) | score-threshold DELETE |
| **semantic** (L2) | cross-session synthesized | ≥5 episodic summaries, LLM-merge (agentmemory) | **NEVER DELETE** (audit-forever carve-out, gbrain invariant) |

**NEVER-DELETE for semantic** = the audit trail. **score-DELETE for episodic** = the curation. **TTL for working** = the churn. Three distinct retention concerns, finally separated (mya conflates all 3).

### Layer 4 — Governance (the epistemic layer — fixes Digs 2,3,4)

This is what mya is most missing. Combine the strongest governance patterns:

- **Trust scoring (hermes holographic)**: every memory has `trust: float [0,1]`. Feedback deltas: +0.05 helpful, -0.10 unhelpful. Retrieval `score = relevance × trust`. **Contradiction detection**: facts sharing entities with divergent content vectors → surfaced. ~100 lines. Novel authority via feedback, not source-weight.

- **Bayesian veracity (mnemopi)**: `bayesianUpdate(confidence, veracity)` per mention, weighted by `VERACITY_WEIGHTS` (stated=1.0/inferred=0.7/tool=0.5/imported=0.6). Auto `recordConflict` on (s,p,o) clash.

- **Conflict resolution = re-adopt mya-v1 `conflict.rs`**: cosine/jaccard similarity vs existing Core memories → `superseded_by`. Cheapest fix — it's mya's own code.

- **Retention sweep (agentmemory)**: `score = salience(type)·e^(-λ·age) + σ·Σ1/daysSinceAccess`, hard-DELETE below `cold` threshold (0.15), `pinned` protected, every DELETE audited. **This is the Dig 7 fix the user demanded.**

**Pick ONE governance philosophy explicitly** (gbrain lesson: a working system doesn't need full TMS — compiled-truth + recency + human-in-loop suffices). For mya personal-use: **trust scoring (hermes) + temporal supersede (headroom) + score-retention (agentmemory)**. Defer full Bayesian TMS unless contradictions pain.

### Layer 5 — APIs (1 core, many surfaces)

Headroom's "5 APIs over 1 core" — same `MemoryEngine` exposed through:
- **TUI `/role`** — role overlay (existing, now actually filters tools after e125df6)
- **MCP server** — `memory_search`/`memory_save` tools for external agents (codebase-memory-mcp pattern)
- **Gateway** — HTTP API with role-scoped reads
- **Bridge** — markdown ↔ DB sync (gbrain markdown-as-truth; headroom MemoryBridge) — human-readable canonical

---

## How this fixes mya's 7 digs

| Dig | Fix | Source pattern |
|---|---|---|
| 1 single-writer | engine knob (SQLite→Postgres) | gbrain BrainEngine |
| 2 log-not-belief | tiered consolidation + governance | gbrain+agentmemory |
| 3 dead TMS | ports unify 4 subsystems + re-adopt conflict.rs | headroom ports + mya-v1 |
| 4 authority/scope | scope-derived + trust scoring | headroom + hermes |
| 5 capture source-blind | structural speaker fields + MemoryTaint | agentmemory + openhuman |
| 6 ungrounded | ReferentStore + content-hash re-verify | codebase-memory-mcp |
| 7 no retention | score-driven DELETE + per-tier TTL | agentmemory |

## Multi-agent stance (unchanged, reaffirmed)

**DON'T share the belief base across agents.** Every system confirms this. For mya multi-agent:
- Shared layer = **read-only common (user-scope) + AGENTS.md/knowledge.md** (gbrain markdown-as-truth, pi-crew knowledge.md)
- Per-agent = **ephemeral working memory (session/turn scope)**, dies with session
- Inter-agent transfer = **dependency-context data handoff** (pi-crew `<dependency-context>`), NOT shared belief reads
- Subagent = **fresh-context spawn, returns result, main agent (single writer) commits** (Claude Code + Option A)

The belief base (Layer 3-4) is **single-writer** (the main agent / cycle). Multi-agent = coordination via messages, not shared mutable beliefs.

---

## Migration path from current mya (pragmatic, phased)

Don't boil the ocean. Phase it by ROI:

**Phase 1 — Retention (fixes Dig 7, user's catch, ~80 lines)**: add `retention_score` column + sweep that hard-DELETEs below threshold (agentmemory formula). Set `valid_until` at capture per-type TTL so existing `purgeExpired` fires. *Highest urgency — brain degrades over time regardless of correctness.*

**Phase 2 — Re-adopt mya-v1 conflict.rs (fixes Dig 2-3, ~150 lines)**: port the cosine/jaccard conflict detection + supersede. mya's OWN code, dropped in rewrite. Wires temporal `valid_until` for real.

**Phase 3 — Scope-derived (fixes Dig 4, ~100 lines)**: add `agent_id`/`session_id`/`turn_id` columns, derive scope_level, update recall filter to `WHERE scope IN (common, role:X, own-session)`. Implements the user's 3-tier proposal correctly.

**Phase 4 — Ports (fixes Dig 1,3 fragmentation, larger)**: extract `MemoryStore` interface, keep SQLite impl, enable future Postgres. Unifies the 4 dead subsystems behind one contract.

**Phase 5 — Governance + grounding (fixes Dig 4 authority, Dig 6, larger)**: trust scoring (hermes) + ReferentStore content-hash (codebase-memory-mcp). The epistemic polish.

**Defer**: full Bayesian TMS, Postgres migration (until >50K memories or multi-user), multi-agent shared-brain (never — use pi-crew pattern instead).

---

## What this architecture deliberately does NOT do (honesty)

- **No full truth-maintenance system** — gbrain proves you don't need one (compiled-truth + recency + human-in-loop). Bayesian TMS is research-grade; defer.
- **No reality re-verification of beliefs** — only observations (via ReferentStore). Beliefs are trust-on-write + TTL. (No reference does belief re-verification; it's unsolved.)
- **No shared belief base across agents** — ever. Multi-agent = mailbox (pi-crew).
- **No multi-user** — until Postgres + RLS (gbrain heavy-mode threshold: >50K or multi-user).

---

## The one-sentence verdict

**mya's best memory architecture = headroom's 6-port hexagon + gbrain's engine-knob & source-of-truth + agentmemory's score-retention + codebase-memory-mcp's content-hash grounding + hermes's trust scoring + re-adopted mya-v1 conflict.rs — with multi-agent done via pi-crew mailbox, NOT shared brain.** Phase it: retention first (urgent), then re-adopt mya-v1 conflict (cheap, own code), then scope-derived, then ports, then governance+grounding.

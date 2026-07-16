# Memory Architecture Deep-Dive — Findings

**Status**: Pre-reference-study consolidation. Captures 7 cumulative source-verified digs into mya's memory system, the user's 3-tier proposal, and open questions to resolve against reference implementations.

**Date**: 2026-07-16
**Origin**: Investigation started from "can roles → multi-agent?" → led to dissecting the shared-brain obstacle.

---

## Context

- **Trigger**: User asked whether `roles` (the mya feature: prompt+tools+model overlay, switched via `/role`) could serve as a foundation for a multi-agent system.
- **Hypothesis**: Roles already solve persona/tools/model (3 of 4 agent axes); only lifecycle+identity missing.
- **Method**: 7 sequential digs, each verified against mya source (file:line), going one layer deeper each time.
- **Outcome**: Discovered mya's memory is broken at 7 layers (1 epistemic stack + 1 operational). Multi-agent-on-shared-brain is not viable without rebuilding the epistemic stack. This doc preserves findings before studying reference implementations (mnemopi, agentmemory, gbrain, openclaw, pi-crew, Claude Code).

---

## The 7 Digs (cumulative, each verified)

### Dig 1 — WAL single-writer assumption (concurrency)

**Evidence**: `packages/memory/src/sqlite-db.ts:2` docstring: `"WAL mode for concurrent readers + single writer"`; `PRAGMA busy_timeout = 5000`.

**Finding**: mya's memory is **architected for 1 writer**. WAL allows N concurrent readers + 1 writer; a 2nd concurrent writer waits 5s then FAILS (not queued). Multi-agent (N concurrent writers) **violates the core assumption** at the storage layer.

**Breaks**: any multi-agent design that lets agents write the shared brain concurrently.

---

### Dig 2 — brain = evidence LOG, not belief BASE (resolution)

**Evidence**:
- `packages/memory/src/dream-cycle.ts:248` `basicSummarizeSqlite` body: groups rows by `memory_type`, outputs `"preference(3), fact(2)"` — **counts only, zero content resolution**.
- `sqlite-recall.ts` veracity is a **weight** (`stated=1.0, inferred=0.7, tool=0.5, false=0.0`), NOT a filter — contradictory facts both recalled, just scored differently.
- `supersede` exists but only for consolidation merge (group by `source,type,scope`), **not semantic contradiction detection**.

**Finding**: mya's brain accumulates evidence (append + decay) but has **no resolution engine**. Contradictions are **immortal** — both stored, both recalled, LLM must resolve ad-hoc. A log is fine for 1 writer (curate your own); a log shared by N writers = chaos.

**Reframe**: "brain" is misnamed — it's an **evidence log**, not a belief base. Belief bases resolve; logs accumulate.

---

### Dig 3 — TMS half-built, dead-wired (the biggest reframe)

**Evidence**:
- `sqlite-schema.ts` `triples` table has `valid_from`, `valid_until`, `confidence`, `source` — a **bi-temporal belief-base / TMS data model**. But grep `INSERT INTO triples` / `addTriple` → **NEVER written, NEVER recalled**. Dead schema.
- `brain.ts` has `recordFact`, `backlinks()` (dependency graph!), `consolidate`, `purge` — a belief-graph. But mya-bridge **never reads it** (only dream-cycle writes; agent recall path bypasses).
- `facts` table IS written (`recordFact`) and `recallFacts` exists, but mya-bridge **never calls recallFacts** — facts layer disconnected from agent loop.

**Finding**: mya has **4 parallel memory subsystems**:
| Subsystem | Type | Agent reads? | Ever written? |
|---|---|---|---|
| SQLite working/episodic | evidence log | ✅ **only this** | autoCapture |
| SQLite facts (L2) | structured | ❌ recallFacts unused | recordFact |
| SQLite triples (L2+) | **bi-temporal belief-base** | ❌ | ❌ **dead** |
| Brain.ts in-memory graph | belief graph + backlinks | ❌ write-only | dream-cycle |

→ **TMS is NOT missing — it's half-built and dead-wired.** The migration belief-graph → SQLite-log **stalled mid-way**: old system alive but write-only, new system incomplete. mya is stuck at the worst spot (2 systems, neither complete).

**Reframes Dig 2**: ceiling isn't "build TMS from scratch" — it's "finish the half-built TMS" (wire recall triples + valid_until supersede + backlink invalidation).

---

### Dig 4 — authority vacuum (epistemic, below TMS)

**Evidence**:
- `auto-capture.ts:284` — every autoCapture hardcodes `veracity: "inferred"`. No discrimination.
- grep `confirm|ratify|approve` → **no user-ratification gate**. Capture → fact, straight through. User never confirms.
- `remember` tool = agent decides what's worth saving (not user-confirmed).

**Finding**: mya's brain **conflates 3 epistemically distinct things** into one "fact" type:
| Kind | Example | True authority for resolution |
|---|---|---|
| OBSERVATION | "auth module has 200 lines" | REALITY (tool re-verify) |
| CLAIM | user says "I prefer tabs" | SPEAKER (user re-confirms) |
| BELIEF | "user prefers tabs" | POLICY (TMS: recency/trust/vote) |

All three stored identically (veracity 0.7). TMS resolves **same-authority beliefs**, but facts span 3 authority classes needing **different resolution**. Wiring TMS without an authority model = resolving user-claims by vote (epistemically wrong).

**Deeper**: persisting CLAIMS = importing the authority vacuum. Reference systems avoid persistent memory partly to avoid this debt.

---

### Dig 5 — capture is the single point of failure (below authority)

**Evidence**:
- `auto-capture.ts:158` `classify(text: string)` — takes ONLY text, **no speaker param**. Source-blind.
- mya-bridge runs autoCapture twice with **same classifier**: `auto:user` (minConf 0.55) + `auto:assistant` (minConf 0.85). `source` is metadata recorded after; classification is identical.
- Regex `\b(i prefer)\b` matches "I prefer" of user OR assistant — classifier can't tell. Assistant role-playing "I prefer tabs" → stored as `preference`, source=`auto:assistant`.
- `recall` (Dig 2) doesn't filter/score by source → assistant-origin preference competes equally with user's. **Authority inverted** (agent's utterances become user's beliefs).
- `classify()` output = `memory_type` (domain) + confidence. **No modality (observation/claim/belief), no speaker, no authority.**

**Finding**: the capture classifier is **structurally incapable** of producing the typed, speaker-attributed, modality-tagged input that ANY downstream resolution (authority model, TMS) requires. **Dig 4's authority field cannot be populated** — no signal to populate it. Capture is upstream of everything; polishing memory (Digs 1-4) without fixing capture = polishing garbage.

**Meta-tradeoff**: reliable classification needs understanding = LLM = expensive. mya chose regex-cheap/always-on = inherited noise. Multi-agent amplifies: N agents × noisy capture = noise².

---

### Dig 6 — ungrounded symbols (symbol grounding — true bedrock)

**Evidence**:
- `sqlite-schema.ts` `working_memory.content` = sentence TEXT. `metadata_json` = `'{}'`. Only reality-ish link is `facts.source_msg_id` = **provenance** (which message), NOT **referent** (which file/entity/reality).
- mya-bridge recall inject: `hits.map(h => \`- [${h.tier}] ${h.content.slice(0,200)}\`)` — injects **only tier + content**. Strips source, veracity, confidence, timestamp, authority. LLM sees recalled facts as flat authoritative context.
- `triples` (structured, more groundable — subject could link to entity) is DEAD (Dig 3); `working_memory` (ungrounded sentence) is ALIVE.

**Finding**: facts are **ungrounded symbols** (sentences) detached from referents. Brain cannot map "auth is at src/auth" → filesystem to re-verify → Dig 4's "observation → reality wins" is **impossible** (no reality-link). **Confidence laundering** at injection: uncertain inputs become confident-looking context.

**Metaphor**: mya's brain = **photocopier of reality** (captured once, decays, never re-grounds). Claude Code (fresh-context) = **live view** (re-observes each spawn). **Shared brain shares stale photocopies, not reality.** That's the deepest reason shared brain obstructs multi-agent: N agents share stale copies, amplify staleness.

**This is the classic AI symbol-grounding problem — true bedrock.** Below this is only philosophy.

---

### Dig 7 — no effective RETENTION (operational — the user's catch)

**Evidence**:
- `sqlite-consolidate.ts:147` `degradeOldMemories` → `UPDATE episodic_memory SET tier=3` — **cosmetic relabel, row stays**.
- `sqlite-store.ts:168` `purgeExpired` → `DELETE WHERE valid_until IS NOT NULL AND valid_until < ?` — only fires if `valid_until` is set.
- grep `valid_until =` / `SET valid_until` in SQLite path → **only the type def (sqlite-store:60)**. **Nothing sets valid_until in the SQLite path.** purgeExpired is a no-op.
- Brain.ts path HAS real purge (`lifecycle.ts:31` `PURGE_THRESHOLD=0.05` → `brain.purge()`) but it's **disconnected** (Dig 3 — agent reads SQLite, not Brain graph).

**Finding**: the memory the agent actually reads (SQLite working/episodic) is **append-only — no effective deletion path**. `degradeOldMemories` is cosmetic; `purgeExpired` never fires. **Grows unbounded.**

**Nuance**: FTS5 BM25 `MATCH+ORDER BY+LIMIT` stays reasonably fast at scale (inverted index, LIMIT-capped). The real cost is: storage bloat, consolidation scans, and **recall quality degrades** (weak tier-degraded facts still in the pool competing). Unbounded growth is operationally unsound regardless of recall latency.

**Why this prefixes everything**: a brain that's epistemically perfect still collapses if it grows without shrinking. This is the most URGENT issue (degrades over time regardless of correctness).

---

## Cross-cutting themes

1. **Fragmentation everywhere**: 4 memory subsystems (log/facts/triples/graph), 4 multi-X primitives (roles/council/subagent/workflow) — **none compose**. mya isn't missing multi-agent; it has fragmented multi-X that don't connect.
2. **Dead-wired infrastructure**: TMS schema (triples) scaffolded but unused; `memoryScope` field exists but unread (0 consumers); Brain.ts belief-graph alive but write-only. Migration stalled mid-way repeatedly.
3. **Single-writer assumptions baked in**: WAL (Dig 1) + global brain (Dig 4) both assume 1 active writer.
4. **Ungrounded**: symbols (sentences) detached from referents (Dig 6); the grounded rep (triples) is dead.
5. **No retention**: append-only with cosmetic degradation (Dig 7); no effective DELETE.
6. **Authority vacuum**: claims stored as beliefs, no ratification, no authority model (Dig 4), and the classifier can't even populate one (Dig 5).

---

## The user's 3-tier proposal + my retention admission

### Proposal (user)
Split the single shared brain into tiers:
- **common** — shared, validated facts (current "global" but curated)
- **role:X** — per-role memory (role-specialized, isolated)
- **session** — task-private (already exists as `scope=session`)

### My refinement
**Default-private, explicit-shared**:
- explicit `remember` tool → `common` (high-authority, validated)
- auto-capture (regex, noisy) → `role:X` (contained noise)

This **inverts the current default** (auto-capture → global = noise floods shared brain). Effect: common brain becomes small + validated → Digs 1/3 (concurrency/TMS) become tractable because they operate on a small set, not a noisy flood.

### What it fixes vs doesn't
| Dig | 3-tier fixes? |
|---|---|
| 4 cross-role contamination | ✅ contained |
| 5 capture noise | ✅ partial (contained per-role, no propagation) |
| 1 concurrency | ✅ partial (writers partition across role DBs) |
| 2 log vs belief | ❌ within-role still a log |
| 3 TMS | ❌ within-role still needs; but common brain smaller → easier |
| 6 grounding | ❌ within-role still ungrounded |
| **7 retention** | ❌ **WORSENED if no retention** — N role memories each grow unbounded |

### My admission (user caught this)
I proposed the 3-tier split **without retention** → would multiplicatively worsen unbounded growth. **Valid only with TTL+DELETE per tier.** Should be framed as: "common (validated, long TTL) + role:X (auto-captured, short TTL, contained) + session (shortest TTL)" — each tier needs real deletion.

---

## Open questions for reference study

Before recommending any mya redesign, study how references actually solve each hard problem:

1. **Retention (Dig 7)**: How do mnemopi / agentmemory / gbrain / openclaw actually DELETE? TTL at capture? strength-threshold→DELETE? max-rows cap? Do they set `valid_until`-equivalents?
2. **Multi-agent memory model**: Shared DB / per-agent DB / mailbox / no-memory? How do they avoid the single-writer + authority + grounding problems?
3. **Capture classification (Dig 5)**: regex / LLM / explicit-only? How reliable? Do they distinguish speaker (user vs agent)?
4. **Authority / TMS (Dig 3-4)**: Any belief-revision? How resolve contradictions? valid_until supersede? Do they have an authority model?
5. **Grounding (Dig 6)**: Do they link facts to referents (files/entities)? Re-verify against reality? Or accept ungrounded + short TTL?
6. **Concurrency (Dig 1)**: Single SQLite / per-process / Postgres? WAL? How handle concurrent writers?
7. **Tier/scope model**: Do they have common/role/session split? How decide what goes where?

### Reference sources to study (verified paths)
- `source/oh-my-pi/packages/mnemopi` — dedicated memory system (typed-memory, db, beam schema)
- `source/agentmemory` — dedicated agent memory
- `source/gbrain` + `source/.learned/GBRAIN-HEAVY-MODE.md` — gbrain (heavy mode = Postgres scaling)
- `source/openclaw/extensions/{memory-core,memory-lancedb,active-memory,memory-wiki}` — openclaw memory variants
- `source/hermes-agent/plugins/memory` — hermes memory
- `/home/bom/source/my_pi/pi-crew` — pi-crew (mailbox, multi-agent coordination)
- `source/system_prompts_leaks/{Anthropic,Cursor,Misc}` — Claude Code / Cursor / OpenCode / Devin (how they handle or avoid memory)

---

## Working verdict (pre-reference, to be revised)

mya's memory is broken at 7 layers. The first 6 are **epistemic** (concurrency → log → TMS → authority → capture → grounding); the 7th is **operational** (no retention). Multi-agent-on-shared-brain is not viable without rebuilding the epistemic stack AND adding retention.

The 3-tier proposal is epistemically sound (containment) but **operationally unsound without retention**. The realistic path for mya personal-use multi-agent is likely NOT "fix all 7 layers" but either:
- **Option A**: single-writer delegation (main agent = sole writer/resolver; subagents read-shared + return messages) — sidesteps Digs 1,3,4,5 for the shared layer
- **Option C (revised)**: finish half-built TMS (wire triples + valid_until) + add retention (TTL per tier) + authority-aware capture — full rebuild, large effort
- **Reference-guided**: copy whatever pattern mnemopi/agentmemory/gbrain actually use (TBD by study)

**Next step**: study references deeply (parallel), then revise this verdict with evidence.

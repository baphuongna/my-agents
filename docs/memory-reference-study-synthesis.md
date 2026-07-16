# Memory Reference Study — Synthesis

**Status**: Cross-reference synthesis from 4 parallel deep-reads (mnemopi, agentmemory, gbrain, openclaw, pi-crew, Claude Code/Cursor/OpenCode/Devin). Companion to `docs/memory-deep-dive-findings.md` (the 7-dig problem analysis).

**Date**: 2026-07-16

---

## 🎯 The convergent finding (most important)

**NO shipping system uses a shared persistent belief-base across agents.** Every studied system avoids it. This is a convergent industry answer that directly contradicts mya's shared-brain design.

The universal pattern (all 6+ systems):
- **(a) No persistence** by default — Claude Code, Cursor, OpenCode are session-bound (context window only)
- **(b) Message-passing / return-values**, not shared mutable state — pi-crew mailbox, Claude Code Workflow `pipeline()`
- **(c) Fresh-context-per-spawn** — Claude Code ("a new Agent call starts fresh"), pi-crew (`contextMode:"fresh"` default)
- **(d) Ephemeral working memory** — all systems; long contexts are summarized/compacted, never indexed into a queryable shared belief base
- **(e) At most ONE small human-owned knowledge file** — pi-crew `.crew/knowledge.md`, Devin `AGENTS.md`, Claude Code `CLAUDE.md`

**What this tells mya**: a shared persistent belief-base across agents is an **anti-pattern every shipping system rejected**. It reintroduces single-writer contention, log-vs-belief confusion, authority/grounding drift, capture noise, and unbounded retention *by construction*. mya's user instinct ("roles > multi-agent for personal use") was **correct** — the reference study confirms it.

---

## Per-problem borrow map (mya's 7 digs → reference solution)

| mya dig (problem) | Best reference | Specific borrowable pattern | File |
|---|---|---|---|
| **7. No retention** ⭐ | **agentmemory** | Score-driven eviction: `score = salience(type)·e^(-λ·age) + σ·Σ1/daysSinceAccess`, hard-DELETE below `cold` threshold + audit + index cleanup. 3 DELETE paths (TTL-at-capture, score-evict, max-rows-LRU). | `functions/retention.ts`, `evict.ts`, `auto-forget.ts` |
| 7 (alt) | gbrain | Soft-delete + 72h TTL purge for pages/sources; **beliefs NEVER deleted** (audit-trail-forever carve-out) | `postgres-engine.ts:1095`, `cycle.ts:1274` |
| 7 (warning) | mnemopi | Working memory has TTL+LRU cap (real DELETE), **but episodic has NO purge — same bug as mya** (degradation≠deletion) | `core/beam/consolidate.ts:552` |
| **2-3. Log-not-belief / dead TMS** | **mnemopi** | Bitemporal triples: supersede-by-closing-valid_until + as-of query. **Real TMS mya has dead-wired.** | `core/triples.ts:261-300` |
| **4. Authority vacuum** | **mnemopi** | `VERACITY_WEIGHTS` (stated=1.0/inferred=0.7/tool=0.5/imported=0.6) + `bayesianUpdate` per source mention + `recordConflict` auto-detection | `core/veracity-consolidation.ts` |
| 4 (alt) | agentmemory | NO authority — supersede by recency+jaccard only (negative example) | `functions/remember.ts` |
| **5. Capture source-blind** | **agentmemory** | Structural fields distinguish speaker: `hookType`/`toolName`/`userPrompt` on observation (tool vs user vs assistant) | `functions/observe.ts:130-170` |
| 5 (alt) | gbrain | LLM-driven extraction (Sonnet, strict-JSON) + injection-sanitization, not regex | `facts/extract.ts` |
| **6. Grounding** | **openclaw memory-core** | Short-term recall entries point to `path`+`startLine`+`endLine` + **re-verify source file exists** (`fs.stat`) before use | `short-term-promotion.ts:130,970` |
| 6 (note) | **neither** reference does reality re-verification of beliefs — both are trust-on-write. mya must build this if it wants it. | — |
| **1. Single-writer concurrency** | **gbrain** | Dual-engine (`kind:'sqlite'|'postgres'`) — concurrency as deployment knob. Postgres buys MVCC + `FOR UPDATE SKIP LOCKED` job claims + row-TTL locks surviving PgBouncer. PGLite/SQLite = single-writer. | `engine.ts:651`, `GBRAIN-HEAVY-MODE.md` F.3 |
| Multi-agent coordination | **pi-crew** | Mailbox (actor model) + `<dependency-context>` data handoff (prompt-injection-hardened) + worktree isolation + role permissions. **NO shared belief base.** | `state/mailbox.ts`, `prompt-builder.ts` |

---

## The 2 paths for mya

### Path A — Fix the PERSONAL brain (single-user, the realistic goal)

mya's shared brain is fine **for 1 user** (the use-case it was designed for). Fix the 2 most urgent operational/epistemic breaks:

1. **Retention (Dig 7, user's catch)** — borrow agentmemory's score-driven eviction. Concretely: add a `retention_score` column, a sweep that hard-DELETEs below threshold + cleans FTS index + audit. Set `valid_until` at capture (per-type TTL) so the existing `purgeExpired` actually fires. This is the **most urgent** fix — the brain degrades over time regardless of correctness.
   - ~80 lines, borrows `score = salience(type)·e^(-λ·age) + σ·Σ1/daysSinceAccess`.

2. **TMS/authority (Dig 2-4, optional)** — if mya wants the brain to actually resolve contradictions (not just log them), wire mnemopi's bitemporal triples + Bayesian veracity. mya ALREADY has the dead `triples` schema (Dig 3) — this is "finish the half-built TMS", not build from scratch.
   - Larger effort; defer unless contradictions become painful.

### Path B — Multi-agent: DON'T share the brain (the convergent answer)

If mya wants multi-agent, **do NOT extend the shared brain to multiple agents.** Every reference rejects it. Instead copy pi-crew's model:

1. **One human-owned knowledge file** (shared, read-mostly, injected into all roles) — like pi-crew's `knowledge.md` / Devin's `AGENTS.md`. mya already has AGENTS.md — treat it as the shared context, not memory.db.
2. **Per-role working memory = ephemeral** (session-scoped, dies with session). mya already has `scope=session`.
3. **Inter-role knowledge transfer = explicit data handoff**, NOT shared belief reads. A subagent receives prior findings as a `<dependency-context>` data block (prompt-injection-hardened), never live access to another role's belief store.
4. **Fresh-context-per-spawn** by default. Continuity is opt-in.
5. **Subagent = fresh process, returns result, main agent (single writer) decides what to commit.** (This is "Option A" from the deep-dive — the references confirm it.)

**This means**: mya's subagent should NOT read/write the shared brain. It runs fresh, receives a task + dependency-context, returns a result. The main agent captures salient findings. No concurrent writers, no shared-belief contamination.

---

## What NO reference solves (mya's remaining gap)

**Reality re-verification (Dig 6 grounding)** — even openclaw (strongest) only re-checks that a *source file exists* (`fs.stat`), not that a *belief is still true*. mnemopi, agentmemory, gbrain are all trust-on-write. If mya wants observations to auto-expire when reality changes (e.g. "auth is at src/auth" invalidated when the file moves), **no reference does this** — mya would have to build a `grounding_check` that re-resolves file/entity references. Likely not worth it for personal use (short TTL + manual `forget` is the pragmatic substitute all references use).

---

## Concrete recommendation (revised verdict)

**Revokes the earlier "Option C: finish TMS" recommendation.** The reference study shows:

1. **For personal mya**: Path A. Fix retention (agentmemory pattern) — that's the single highest-value change. The TMS (mnemopi pattern) is optional polish, not urgent for 1 user.

2. **For multi-agent mya**: Path B. Do NOT share the brain. Copy pi-crew: knowledge.md (shared read-only) + ephemeral per-role working memory + dependency-context handoff + fresh-context subagents. The "roles → multi-agent" question's answer is: **roles stay as in-session overlays; multi-agent = subagents with fresh context + data handoff, NOT shared-brain roles.**

3. **The user's earlier instinct was right**: roles > multi-agent for personal use. The references confirm shared-brain-multi-agent is an anti-pattern. mya should NOT try to make the brain multi-agent-safe; it should make multi-agent brain-free (pi-crew model).

**Net**: the 6-dig epistemic stack (concurrency→TMS→authority→capture→grounding) is largely **moot for mya's actual use case** — because the right multi-agent design avoids sharing the brain entirely. Only **retention (Dig 7)** is urgent and universally applicable. Fix that; treat the rest as "personal brain polish" (optional) or "don't share" (the multi-agent answer).

---

## Reference credibility notes

- **agentmemory** retention: strongest, 3 real DELETE paths, audited. `functions/retention.ts` is directly portable.
- **mnemopi** TMS+authority: bitemporal triples + Bayesian veracity is a genuine belief-base. `core/triples.ts` + `veracity-consolidation.ts` directly portable.
- **gbrain**: deliberately WEAK TMS (human-in-loop) — evidence that a working system does NOT need full TMS. Dual-engine (SQLite↔Postgres) is the concurrency-knob pattern.
- **openclaw**: composable multi-tier (active=working, core=episodic, lancedb=vector, wiki=knowledge). memory-core's signal-driven promotion scoring is borrowable for "what deserves to persist".
- **pi-crew**: mailbox actor model + dependency-context — the multi-agent coordination reference. Radically downsized memory (1 markdown file) = "simple = trustworthy".
- **Claude Code / Cursor / OpenCode / Devin**: no persistence / append-to-rules-file — the anti-memory baseline. Validates that memory is optional, not load-bearing.

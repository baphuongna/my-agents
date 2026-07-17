# mem0 vs mya Memory — Architecture Comparison

> Source: `source/mem0/` (mem0 v2.0.12, Python core) vs mya `packages/memory/`
> (post-5-phase-redesign, better-sqlite3).
> Date: 2026-07-17. Read-only research; no code changed.

## TL;DR

These are **two different philosophies** built for different contexts:

| | **mem0** | **mya** |
|---|---|---|
| Designed for | Multi-user SaaS / managed platform | Personal, offline, single-user, multi-role agent |
| Core engine | **LLM extraction** + **vector embeddings** (semantic search) | **Regex auto-capture** + **FTS5 keyword** (BM25 search) |
| Capture | LLM call on every `add()` (extracts facts from messages) | Regex classify (no LLM) + explicit `remember` tool |
| Conflict | **Append-only forever** (V3 ADD-only — old + new coexist) | **Newest-wins supersession** (jaccard > 0.7, scope-aware) |
| Retention | `expiration_date` (logical hide only, no decay, no purge) | **Weibull decay** + TTL ceiling + score-driven purge + pin |
| Scoping | `user_id`/`agent_id`/`run_id` (flat filters) | **3-tier scope** (common / role / session) with hard isolation |
| Graph | Entity-backlink collection (no typed edges, no traversal) | `facts`/`triples` tables (L2 structured, legacy-unused) |
| Dependencies | OpenAI default (LLM + embeddings), Qdrant, telemetry ON | **Zero external** — better-sqlite3 only, fully offline |
| Trust/governance | None | Feedback-driven trust scoring + referent grounding |

**Bottom line:** mem0 wins on *extraction quality* (LLM) and *semantic recall*
(embeddings) at the cost of *latency, cost, offline-unfriendliness, and conflict
accumulation*. mya wins on *speed, privacy, deliberate forgetting, conflict
resolution, and role isolation* at the cost of *weaker semantic matching* (FTS5
keyword vs. dense vectors).

---

## 1. Capture / extraction

| | mem0 | mya |
|---|---|---|
| **Mechanism** | LLM call (`ADDITIVE_EXTRACTION_PROMPT`) extracts rich contextual facts from messages | Regex `autoCapture` (classify → type + confidence ≥ 0.55) + explicit `remember` tool |
| **Cost per add** | 1 LLM call + N embedding calls (default OpenAI `gpt-5-mini` + `text-embedding-3-small`) | 0 LLM calls, 0 network — pure regex + SQLite insert |
| **Quality** | High — LLM produces self-contained "contextually rich" memories (15–80 words), captures transitions, motivations, assistant recommendations | Mechanical — captures exact phrases meeting regex patterns; misses nuance the regex doesn't encode |
| **Latency** | ~0.9–1.1s per `add()` (managed; OSS adds LLM round-trip) | <5ms (SQLite insert) |
| **Attribution** | LLM tags `attributed_to: user|assistant` | `source`: `auto:user` \| `auto:assistant` \| `tui` \| `consolidation` |
| **Offline** | Possible (Ollama/HF/LM Studio) but OpenAI is default; models may auto-download | Fully offline by design |

**Insight:** mem0's extraction is genuinely better at *understanding* a
conversation. mya's is better at *predictable, free, instant* capture. For a
personal agent running on every turn, mya's zero-cost capture is defensible;
for a multi-user platform, mem0's richer extraction differentiates the product.

---

## 2. Storage & search

| | mem0 | mya |
|---|---|---|
| **Primary store** | Vector DB (embedded Qdrant default, `/tmp/qdrant`, 1536-dim) — 24 backends pluggable | SQLite (WAL mode, better-sqlite3) — single file at `~/.mya/memory/memory.db` |
| **Search** | **Hybrid**: dense semantic + native BM25 (Qdrant sparse) + entity-link boost + optional reranker | **FTS5 BM25** + Weibull temporal + veracity + trust weighting |
| **Candidate pool** | Semantic-only (BM25/entity can only *re-score* semantic hits, not introduce new ones) | FTS5 MATCH (keyword) |
| **Normalization** | spaCy lemmatization (optional, may fail-open) | SQLite FTS5 built-in tokenizer |
| **Ranking** | `min((semantic + bm25 + entity) / max_possible, 1.0)` | `bm25×0.5 + importance×0.2 + weibull×0.2 + veracity×0.1` then `× trust` |

**Insight:** mem0's semantic search finds *conceptually similar* memories even
with zero keyword overlap (synonyms, paraphrase). mya's FTS5 requires shared
terms. This is mem0's biggest technical edge for recall relevance. mya
compensates with **temporal decay** (recent ranks higher) and **trust** (feedback
re-ranks) — signals mem0 lacks entirely.

**mya gap worth noting:** the recall scoring mixes BM25 with `importance`/
`weibull`/`veracity`/`trust` — but has no dense-vector signal. A memory worded
very differently from the query but semantically equivalent will be missed.

---

## 3. Conflict resolution

| | mem0 | mya |
|---|---|---|
| **Strategy** | **None (append-only)**. V3 explicitly dropped ADD/UPDATE/DELETE. "Memories accumulate; nothing is overwritten." | **Newest-wins supersession**. On store, `checkAndResolveConflicts` finds same-scope memories with jaccard > 0.7 and different content → `old.superseded_by = new.id` |
| **Contradiction** | Both old + new persist; may link via shared entity | Old is marked superseded (hidden from recall), newest is authoritative |
| **Scope-aware** | No (flat `user_id` filter) | Yes — coder cannot supersede reviewer's memory (3-tier isolation) |
| **Auto vs manual** | Manual `update()`/`delete()` only | Automatic supersession + manual `/contradict` (surface-only, human-in-loop) |

**Insight:** This is **mya's strongest advantage** for a long-running personal
agent. mem0's append-only design means contradictions accumulate indefinitely
("User prefers tabs" + "User now prefers spaces" both rank high). mem0's own
README markets this as a feature ("captures transitions") but for *acting on*
current truth, mya's supersession is materially better. mem0's legacy code still
contains the ADD/UPDATE/DELETE/NONE logic (`DEFAULT_UPDATE_MEMORY_PROMPT`) but
V3 no longer calls it.

---

## 4. Retention / forgetting

| | mem0 | mya |
|---|---|---|
| **Decay** | None (no recency signal in scoring) | **Weibull** `e^(-(age/eta)^k)` per-type (21 curves) |
| **TTL** | `expiration_date` — logical **hide** only (record stays in DB; `get()` still returns it; no reaper deletes) | `valid_until` set at capture per-type — hard expiry, physically purged |
| **Purge** | None automatic; `delete()` keeps full text in `history.db` (`is_deleted=1`) | **3 paths**: TTL ceiling + score-driven (`strength < 0.05`) + pin-protected; every DELETE audited in `purge_log` |
| **Reinforcement** | None | `accessBoost = min(0.5, log1p(recall_count)×0.1)` — frequently-recalled survive longer |
| **Consolidation** | None (append-only) | working → episodic (grouped by source/type/scope/agent, ≥3 items, ≥24h) → tier degrade (content compressed) |

**Insight:** mya has a **deliberate forgetting model**; mem0 has none. For a
personal agent that runs forever, mya's is essential — unbounded append-only
guarantees eventual noise. mem0's `expiration_date` is weak (hide-only, no
cleanup). mya's consolidation + DreamCycle (deep compaction every 4h) is
architecturally beyond anything in mem0 OSS.

---

## 5. Scoping & isolation

| | mem0 | mya |
|---|---|---|
| **Dimensions** | `user_id`, `agent_id`, `run_id` (flat vector filters; conjunction) | **3-tier**: `global` (common) / `role`+`agent_id` / `session`+`session_id` |
| **Physical isolation** | None — all scopes share one collection by default | Same SQLite file (WAL), but logical isolation verified (3 roles, 0 contamination) |
| **Authorization** | **Bypassable** — `get`/`update`/`delete`/`history` take only memory ID, no scope check (wrapping service must enforce) | Recall filter is SQL WHERE clause — can't read out-of-scope via recall |
| **Capture policy** | Caller supplies scope explicitly | **"Default-private, explicit-shared"** — autoCapture → role/session; explicit `remember` → global |

**Insight:** mya's 3-tier model (common/role/session) is purpose-built for the
**"one agent, multiple hats" roles architecture** — the coder role's
preferences don't leak to the reviewer role, but both share common knowledge.
mem0's flat `agent_id` is simpler but doesn't model role specialization. mem0's
direct-ID authorization bypass is a **real security gap** for multi-user; mya
doesn't have it (single-user), but its recall is scope-enforced regardless.

---

## 6. Graph / entities

| | mem0 | mya |
|---|---|---|
| **Implementation** | "Entity backlink collection" — second vector store of entity rows (`PROPER`/`QUOTED`/`TOPIC`/`IDENTIFIER`) each with `linked_memory_ids` | `facts` table (subject/predicate/object + FTS5) + `triples` (bitemporal — **legacy, unused**) |
| **Typed edges** | None — "conceptual bipartite graph", no `Alice --works_at--> Acme` | `facts` has structured triples but no traversal engine |
| **Used in recall** | Yes — entity-boost (≤0.5 weight, penalizes hubs) | No (facts table exists but not in recall pipeline) |
| **Extraction** | spaCy NER (optional, fails-open) | Manual via `remember` |

**Insight:** Neither has a *real* knowledge graph. mem0's entity collection is
the more mature of the two (actually boosts recall). mya's `facts`/`triples` are
vestigial. **Both acknowledge relational memory is unsolved** — mya explicitly
defers it; mem0 removed Neo4j/Kuzu integration in favor of the simpler backlink
model.

---

## 7. Governance & grounding

| | mem0 | mya |
|---|---|---|
| **Trust** | None | Feedback-driven `trust ∈ [0,1]` — `/trust <id> up|down` adjusts, recall weights `score × trust` |
| **Grounding** | None | **Referent tracking** — sha256+mtime+size for file-referenced observations; `/stale` flags changed/gone files |
| **Contradiction detection** | None | `/contradict` surfaces jaccard-similar pairs (human-in-loop, no auto-resolve) |

**Insight:** This is **mya-exclusive territory** — mem0 has nothing comparable.
For a *coding* agent (mya's domain), referent grounding is valuable: a memory
"file X uses pattern Y" becomes stale when X changes. mem0 (chat-focused) has no
notion of this. mya's trust model (down-weight unhelpful memories) is a simple
but real governance layer mem0 lacks.

---

## 8. Dependencies & privacy

| | mem0 | mya |
|---|---|---|
| **Defaults** | OpenAI (LLM + embeddings), Qdrant, **telemetry ON** (`posthog`, `us.i.posthog.com`) | better-sqlite3 only |
| **Network** | Default config requires OpenAI API key; local stack possible but models auto-download | None — fully offline |
| **Mandatory deps** | qdrant-client, openai, sqlalchemy, posthog, protobuf, pytz | better-sqlite3 |
| **Data location** | `/tmp/qdrant` (default!) + `~/.mem0/history.db` | `~/.mya/memory/memory.db` |

**Insight:** For a **personal/offline** agent, mya is categorically better:
no network, no telemetry, no API key, no model downloads, no `/tmp` data.
mem0's `/tmp/qdrant` default and always-on telemetry are hostile to that use
case (though both are configurable). mem0's strength (managed platform) is also
its privacy weakness for self-hosting.

---

## What mya could adopt from mem0 (worth considering)

1. **Optional LLM extraction for the `remember` tool.** mya's regex autoCapture
   is cheap but misses nuance. A *low-frequency* LLM extraction pass (e.g., on
   explicit `remember`, or in DreamCycle) could produce richer, self-contained
   memories — without paying the cost on every turn. **This is the highest-value
   borrow.**
2. **Optional dense-vector recall signal.** mya's FTS5 keyword matching misses
   paraphrase/synonym hits. A pluggable local embedder (e.g., FastEmbed /
   transformers.js) computing embeddings at capture, fused with BM25 at recall,
   would close mem0's biggest technical edge — **fully offline**. The `embed_text`
   column already exists in mya's schema (currently unused) — this was anticipated.
3. **Lemmatization at index time.** mem0's spaCy lemmatization (noun/verb
   canonicalization) improves keyword recall. mya's FTS5 tokenizer is simpler; a
   lightweight lemmatizer (no spaCy dep) could help without the spaCy weight.

## What mem0 could adopt from mya

1. **Conflict supersession** (not append-only). mem0's V3 regression on conflict
   handling is a real product weakness. mya's jaccard-based newest-wins, scope-aware
   supersession is cheap and materially better for *acting on current truth*.
2. **Deliberate forgetting** (Weibull decay + purge + pin). mem0's unbounded
   append-only + hide-only expiration means memory noise grows forever.
3. **Feedback trust weighting.** A simple `trust` field re-ranked by user
   up/down feedback is a governance layer mem0 entirely lacks.
4. **3-tier scope** for role specialization. mem0's flat `agent_id` doesn't model
   "same agent, different capabilities/permissions."

---

## Verdict (for mya's use case)

For a **personal, offline, single-user, multi-role coding agent**, mya's design
is **better-fit overall**:

- ✅ Offline + zero-cost capture (no LLM round-trip per turn)
- ✅ Deliberate forgetting (bounded memory growth)
- ✅ Conflict resolution (current truth, not accumulation)
- ✅ Role isolation (3-tier scope)
- ✅ Governance + grounding (trust + referents) — coding-specific value

The **one real gap** vs. mem0 is **semantic recall** (dense vectors). mem0's
hybrid semantic+BM25 finds conceptually-similar memories mya's keyword FTS5
will miss. mya's schema already has `embed_text` (unused) — adding an optional
local embedder is the single most impactful upgrade if recall relevance becomes
a bottleneck.

The **second gap** is extraction richness — but mya's regex autoCapture is a
deliberate speed/cost tradeoff, and the explicit `remember` tool can be upgraded
to LLM extraction independently if desired.

**Recommendation: do not adopt mem0's architecture wholesale.** Borrow the two
signals (embeddings + optional LLM extraction) as opt-in enhancements; keep
mya's retention, conflict, scope, and governance as-is — those are where mya is
architecturally ahead.

## Reference links

- mem0 OSS: `source/mem0/` (cloned 2026-07-17, v2.0.12)
- mem0 upstream: <https://github.com/mem0ai/mem0>
- mya memory: `packages/memory/` + `docs/memory-system-v2.md`

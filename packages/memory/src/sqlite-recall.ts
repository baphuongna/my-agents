/**
 * @my-agent/memory/sqlite-recall — FTS5-powered recall pipeline.
 *
 * Following mnemopi/src/core/beam/recall.ts pattern. Uses SQLite's native
 * FTS5 BM25 ranking — no in-memory index needed.
 *
 * Pipeline:
 *   1. FTS5 MATCH search on fts_working + fts_episodes (UNION ALL)
 *   2. JOIN with base tables for metadata
 *   3. Filter: superseded_by IS NULL, valid_until > now
 *   4. Score: bm25(rank) + importance + weibull temporal decay
 *   5. Veracity weight: stated=1.0, inferred=0.7, tool=0.5, false=0.0
 *   6. Update recall_count + last_recalled
 */
import type { SqliteDatabase } from "./sqlite-db.js";
import { weibullBoost } from "./weibull.js";
import { recordRecall } from "./sqlite-store.js";
import { getCachedQueryVec, warmQueryVec, bufferToVec, cosine, embeddingDim, type Vec } from "./embeddings.js";

// ── Types ─────────────────────────────────────────────────────────────────

export interface RecallOptions {
  topK?: number;
  sessionId?: string;
  scope?: string;
  includeEpisodic?: boolean;
  /**
   * When true, exclude other sessions' session-scoped memories.
   * Returns: all global memories + only THIS session's session-scoped memories.
   * This prevents context leak between parallel roles.
   * Requires sessionId to be set.
   */
  sessionAware?: boolean;
  /**
   * When true, skip the recall_count/last_recalled side-effect (recordRecall).
   * Use for INTERNAL callers (e.g. conflict detection) that must not pollute
   * the access-frequency metric or the access-reinforcement retention boost.
   */
  internal?: boolean;
  /**
   * Phase 3 scope-derived: when set with sessionAware, recall ALSO includes
   * this role's memories (scope='role' AND agent_id=agentId). Implements the
   * 3-tier isolation: a role sees common (global) + own-role + own-session.
   */
  agentId?: string;
}

export interface MemoryHit {
  id: string;
  content: string;
  source: string;
  tier: "working" | "episodic";
  score: number;
  importance: number;
  veracity: string;
  memory_type: string;
  timestamp: string;
  /** Phase 3: scope + agent_id for same-scope conflict filtering. */
  scope?: string;
  agent_id?: string | null;
  /** Phase 5: trust score [0,1] — recall multiplies score by trust. */
  trust?: number;
}

// ── Veracity weights (mnemopi pattern) ────────────────────────────────────

const VERACITY_WEIGHTS: Record<string, number> = {
  stated: 1.0,
  true: 1.0,
  likely_true: 1.0,
  unknown: 0.8,
  inferred: 0.7,
  imported: 0.6,
  tool: 0.5,
  false: 0.0,
};

function veracityWeight(veracity: string): number {
  return VERACITY_WEIGHTS[veracity] ?? 0.8;
}

// ── FTS5 query sanitizer ──────────────────────────────────────────────────

/**
 * Sanitize a user query for FTS5 MATCH.
 * FTS5 requires special syntax for OR, AND, NOT, prefix queries.
 * We use simple token-based MATCH with OR between tokens for recall.
 */
function sanitizeQuery(query: string): string {
  const tokens = query
    .trim()
    .toLowerCase()
    .match(/[\p{L}\p{N}_]+/gu);
  if (!tokens || tokens.length === 0) return "";
  // Filter very short tokens + join with OR (FTS5 default is AND)
  const filtered = tokens.filter((t) => t.length >= 2);
  if (filtered.length === 0) return "";
  // Quote each token to prevent FTS5 syntax injection
  return filtered.map((t) => `"${t.replace(/"/g, '""')}"`).join(" OR ");
}

// ── Recall pipeline ───────────────────────────────────────────────────────

/**
 * Recall memories matching a query. Uses FTS5 BM25 native ranking + Weibull
 * temporal decay + veracity weighting + importance boosting.
 *
 * Pipeline:
 *   1. FTS5 MATCH on fts_working (L0)
 *   2. FTS5 MATCH on fts_episodes (L1) if includeEpisodic
 *   3. Score composition: normalize(bm25) + importance + weibull + veracity
 *   4. Merge + sort by score
 *   5. Update recall_count for hits
 */
export function recall(db: SqliteDatabase, query: string, options?: RecallOptions): MemoryHit[] {
  const topK = options?.topK ?? 10;
  const ftsQuery = sanitizeQuery(query);
  if (!ftsQuery) return [];

  const now = new Date();
  const hits: MemoryHit[] = [];

  // ── Search working_memory (L0) via FTS5 ──────────────────────────────
  const sessionAware = options?.sessionAware && options?.sessionId;
  // Phase 3: 3-tier scope clause. sessionAware returns common(global) + own-role
  // (if agentId set) + own-session. Without sessionAware, fall back to legacy.
  const roleClause = options?.agentId ? `OR (wm.scope = 'role' AND wm.agent_id = ?)` : "";
  const workingSql = `
    SELECT wm.id, wm.content, wm.source, wm.timestamp, wm.importance,
           wm.veracity, wm.memory_type, wm.scope, wm.agent_id, wm.trust, wm.embedding,
           bm25(fts_working) AS bm25_rank
    FROM fts_working
    JOIN working_memory wm ON wm.id = fts_working.id
    WHERE fts_working MATCH ?
      AND wm.superseded_by IS NULL
      AND (wm.valid_until IS NULL OR wm.valid_until > ?)
      ${sessionAware
        ? `AND (wm.scope = 'global' OR (wm.scope = 'session' AND wm.session_id = ?) ${roleClause})`
        : options?.sessionId
          ? "AND wm.session_id = ?"
          : options?.scope
            ? "AND wm.scope = ?"
            : ""}
    ORDER BY bm25_rank
    LIMIT ?
  `;

  const workingParams: (string | number)[] = [ftsQuery, now.toISOString()];
  if (sessionAware) {
    workingParams.push(options!.sessionId!);
    if (options?.agentId) workingParams.push(options.agentId);
  } else if (options?.sessionId) {
    workingParams.push(options.sessionId);
  } else if (options?.scope) {
    workingParams.push(options.scope);
  }
  workingParams.push(topK * 2);

  const workingRows = db.prepare(workingSql).all(...workingParams) as Array<{
    id: string; content: string; source: string; timestamp: string;
    importance: number; veracity: string; memory_type: string; bm25_rank: number;
    scope: string; agent_id: string | null; trust: number; embedding: Buffer | null;
  }>;

  // ── Search episodic_memory (L1) via FTS5 ───────────────────────────────
  let episodicRows: Array<{
    id: string; content: string; source: string; timestamp: string;
    importance: number; veracity: string; memory_type: string; bm25_rank: number;
    scope: string; agent_id: string | null; trust: number; embedding: Buffer | null;
  }> = [];
  if (options?.includeEpisodic !== false) {
    const episodicRoleClause = options?.agentId ? `OR (em.scope = 'role' AND em.agent_id = ?)` : "";
    const episodicSql = `
      SELECT em.id, em.content, em.source, em.timestamp, em.importance,
             em.veracity, em.memory_type, em.scope, em.agent_id, em.trust, em.embedding,
             bm25(fts_episodes) AS bm25_rank
      FROM fts_episodes
      JOIN episodic_memory em ON em.rowid = fts_episodes.rowid
      WHERE fts_episodes MATCH ?
        AND em.superseded_by IS NULL
        AND (em.valid_until IS NULL OR em.valid_until > ?)
        ${sessionAware
          ? `AND (em.scope = 'global' OR (em.scope = 'session' AND em.session_id = ?) ${episodicRoleClause})`
          : options?.sessionId
            ? "AND em.session_id = ?"
            : options?.scope
              ? "AND em.scope = ?"
              : ""}
      ORDER BY bm25_rank
      LIMIT ?
    `;

    const episodicParams: (string | number)[] = [ftsQuery, now.toISOString()];
    if (sessionAware) {
      episodicParams.push(options!.sessionId!);
      if (options?.agentId) episodicParams.push(options.agentId);
    } else if (options?.sessionId) {
      episodicParams.push(options.sessionId);
    } else if (options?.scope) {
      episodicParams.push(options.scope);
    }
    episodicParams.push(topK);

    episodicRows = db.prepare(episodicSql).all(...episodicParams) as Array<{
      id: string; content: string; source: string; timestamp: string;
      importance: number; veracity: string; memory_type: string; bm25_rank: number;
      scope: string; agent_id: string | null; trust: number; embedding: Buffer | null;
    }>;
  }

  // ── Vector arm (action #3, docs/embeddings-cross-system.md) ──────────────
  // fastembed is async; recall is sync (called from the sync before_agent_start
  // hook) → the query vector is served from a process-wide LRU cache
  // (warmQueryVec). A COLD query → FTS-only (current behavior) + async warm for
  // the next recall. Stored vectors are background-embedded on capture and read
  // here directly from the `embedding` BLOB (sync). Semantic-only candidates
  // (paraphrases that miss FTS) are added via brute-force cosine.
  const qvec: Vec | null = getCachedQueryVec(query);
  const dim = qvec ? embeddingDim() : 0;
  const cosOf = (emb: Buffer | null): number | null => {
    if (!qvec || !emb) return null;
    const v = bufferToVec(emb, dim);
    return v ? Math.max(0, cosine(qvec, v)) : null;
  };
  if (!qvec) void warmQueryVec(query); // fire-and-forget warm for next time

  // Semantic-only candidates: embedded rows in scope, NOT in FTS results, ranked
  // by cosine (brute-force — personal scale; openhuman: "~100K vectors fast enough").
  type RowLite = { id: string; content: string; source: string; timestamp: string;
    importance: number; veracity: string; memory_type: string;
    scope: string; agent_id: string | null; trust: number; };
  const vecOnly: Array<RowLite & { tier: "working" | "episodic"; cosine: number }> = [];
  if (qvec) {
    const seen = new Set<string>([...workingRows.map((r) => r.id), ...episodicRows.map((r) => r.id)]);
    const arms: Array<[string, string, "working" | "episodic"]> = [["working_memory", "wm", "working"]];
    if (options?.includeEpisodic !== false) arms.push(["episodic_memory", "em", "episodic"]);
    for (const [table, alias, tier] of arms) {
      const roleClause = options?.agentId ? `OR (${alias}.scope = 'role' AND ${alias}.agent_id = ?)` : "";
      const scopeSql = sessionAware
        ? `AND (${alias}.scope = 'global' OR (${alias}.scope = 'session' AND ${alias}.session_id = ?) ${roleClause})`
        : options?.sessionId ? `AND ${alias}.session_id = ?`
        : options?.scope ? `AND ${alias}.scope = ?` : "";
      const params: (string | number)[] = [now.toISOString()];
      if (sessionAware) { params.push(options!.sessionId!); if (options?.agentId) params.push(options.agentId); }
      else if (options?.sessionId) params.push(options.sessionId);
      else if (options?.scope) params.push(options.scope);
      try {
        const rows = db.prepare(
          `SELECT ${alias}.id, ${alias}.content, ${alias}.source, ${alias}.timestamp,
                  ${alias}.importance, ${alias}.veracity, ${alias}.memory_type,
                  ${alias}.scope, ${alias}.agent_id, ${alias}.trust, ${alias}.embedding
           FROM ${table} ${alias}
           WHERE ${alias}.embedding IS NOT NULL
             AND ${alias}.superseded_by IS NULL
             AND (${alias}.valid_until IS NULL OR ${alias}.valid_until > ?)
             ${scopeSql}
             LIMIT 5000`,
        ).all(...params) as Array<RowLite & { embedding: Buffer | null }>;
        for (const r of rows) {
          if (seen.has(r.id)) continue;
          const c = cosOf(r.embedding);
          if (c === null || c < 0.3) continue; // similarity floor → skip noise
          seen.add(r.id);
          const { embedding: _drop, ...lite } = r;
          void _drop;
          vecOnly.push({ ...lite, tier, cosine: c });
        }
      } catch { /* old DB without embedding column → skip vector arm (FTS-only) */ }
    }
  }

  // ── Normalize BM25 per-query (global min-max across FTS rows) ────────────
  // SQLite FTS5 bm25() returns negative values where MORE NEGATIVE = BETTER.
  // Min-max normalize so the best candidate → 1.0, worst → 0.0, before blending
  // with importance/temporal/veracity/trust. This fixes the prior Math.exp(bm25)
  // inversion (docs/mem0-comparison-deepdive.md Finding A).
  const allRanks = [
    ...workingRows.map((r) => r.bm25_rank),
    ...episodicRows.map((r) => r.bm25_rank),
  ];
  const bestRank = allRanks.length ? Math.min(...allRanks) : 0;   // most negative = best
  const worstRank = allRanks.length ? Math.max(...allRanks) : 0;  // least negative = worst
  const rankSpan = worstRank - bestRank;                          // >0 (best < worst)

  const buildHit = (
    row: RowLite,
    tier: "working" | "episodic",
    bm25Rank: number | null,
    vectorRel: number | null,
  ): MemoryHit => {
    const relevance = bm25Rank === null ? 0
      : (rankSpan > 1e-9 ? (worstRank - bm25Rank) / rankSpan : 1.0);
    const temporalBoost = weibullBoost(row.timestamp, now, row.memory_type);
    const base = composeScore(relevance, vectorRel, row.importance, temporalBoost, veracityWeight(row.veracity));
    const score = base * (row.trust ?? 0.5); // Phase 5 governance
    return {
      id: row.id, content: row.content, source: row.source, tier,
      score, importance: row.importance, veracity: row.veracity,
      memory_type: row.memory_type, timestamp: row.timestamp,
      scope: row.scope, agent_id: row.agent_id, trust: row.trust,
    };
  };

  for (const row of workingRows) hits.push(buildHit(row, "working", row.bm25_rank, cosOf(row.embedding)));
  for (const row of episodicRows) hits.push(buildHit(row, "episodic", row.bm25_rank, cosOf(row.embedding)));
  for (const row of vecOnly) hits.push(buildHit(row, row.tier, null, row.cosine));

  // ── Merge + sort + topK ────────────────────────────────────────────────
  hits.sort((a, b) => b.score - a.score);
  const top = hits.slice(0, topK);

  // ── Update recall_count for hits ───────────────────────────────────────
  const workingIds = top.filter((h) => h.tier === "working").map((h) => h.id);
  const episodicIds = top.filter((h) => h.tier === "episodic").map((h) => h.id);
  if (!options?.internal) {
    if (workingIds.length > 0) recordRecall(db, workingIds, "working_memory");
    if (episodicIds.length > 0) recordRecall(db, episodicIds, "episodic_memory");
  }

  return top;
}

/**
 * Compose final score from BM25 relevance, optional vector similarity, importance,
 * temporal boost, and veracity.
 *
 * `relevance` ∈ [0,1] — pre-normalized per-query min-max over FTS5 bm25 ranks.
 * `vectorRel` ∈ [0,1] — cosine similarity to the query embedding, or NULL when
 * embeddings are unavailable (cold query / disabled / row not yet embedded).
 *
 * When `vectorRel` is present, blend semantic + lexical (openclaw-style
 * 0.45/0.25) with compressed metadata signals. When NULL, use the FTS-only
 * weights (unchanged from the pre-embedding design) so disabling embeddings
 * is a clean no-op — never a regression.
 */
function composeScore(relevance: number, vectorRel: number | null, importance: number, temporalBoost: number, veracity: number): number {
  if (vectorRel !== null) {
    return 0.45 * vectorRel + 0.25 * relevance + importance * 0.1 + temporalBoost * 0.1 + veracity * 0.1;
  }
  return relevance * 0.5 + importance * 0.2 + temporalBoost * 0.2 + veracity * 0.1;
}

/** Recall structured facts (L2) via FTS5. */
export function recallFacts(
  db: SqliteDatabase,
  query: string,
  options?: { topK?: number },
): Array<{ fact_id: string; subject: string; predicate: string; object: string; score: number }> {
  const ftsQuery = sanitizeQuery(query);
  if (!ftsQuery) return [];
  const rows = db.prepare(`
    SELECT f.fact_id, f.subject, f.predicate, f.object, bm25(fts_facts) AS rank
    FROM fts_facts
    JOIN facts f ON f.rowid = fts_facts.rowid
    WHERE fts_facts MATCH ?
    ORDER BY rank
    LIMIT ?
  `).all(ftsQuery, options?.topK ?? 5) as Array<{
    fact_id: string; subject: string; predicate: string; object: string; rank: number;
  }>;
  if (rows.length === 0) return [];
  // Per-query min-max normalize bm25 (more-negative = better → best = 1.0).
  // Fixes the prior `1 - (...)` inversion that scored the best fact as 0.
  const factRanks = rows.map((r) => r.rank);
  const factBest = Math.min(...factRanks);
  const factWorst = Math.max(...factRanks);
  const factSpan = factWorst - factBest;
  return rows.map((r) => ({
    fact_id: r.fact_id, subject: r.subject, predicate: r.predicate, object: r.object,
    score: factSpan > 1e-9 ? (factWorst - r.rank) / factSpan : 1.0,
  }));
}

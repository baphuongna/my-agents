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
           wm.veracity, wm.memory_type, wm.scope, wm.agent_id, wm.trust,
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
    scope: string; agent_id: string | null; trust: number;
  }>;

  for (const row of workingRows) {
    const temporalBoost = weibullBoost(row.timestamp, now, row.memory_type);
    const base = composeScore(row.bm25_rank, row.importance, temporalBoost, veracityWeight(row.veracity));
    // Phase 5 governance: multiply by trust so low-trust memories rank lower.
    const score = base * (row.trust ?? 0.5);
    hits.push({
      id: row.id, content: row.content, source: row.source, tier: "working",
      score, importance: row.importance, veracity: row.veracity,
      memory_type: row.memory_type, timestamp: row.timestamp,
      scope: row.scope, agent_id: row.agent_id, trust: row.trust,
    });
  }

  // ── Search episodic_memory (L1) via FTS5 ───────────────────────────────
  if (options?.includeEpisodic !== false) {
    const episodicRoleClause = options?.agentId ? `OR (em.scope = 'role' AND em.agent_id = ?)` : "";
    const episodicSql = `
      SELECT em.id, em.content, em.source, em.timestamp, em.importance,
             em.veracity, em.memory_type, em.scope, em.agent_id, em.trust,
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

    const episodicRows = db.prepare(episodicSql).all(...episodicParams) as Array<{
      id: string; content: string; source: string; timestamp: string;
      importance: number; veracity: string; memory_type: string; bm25_rank: number;
      scope: string; agent_id: string | null; trust: number;
    }>;

    for (const row of episodicRows) {
      const temporalBoost = weibullBoost(row.timestamp, now, row.memory_type);
      const base = composeScore(row.bm25_rank, row.importance, temporalBoost, veracityWeight(row.veracity));
      // Phase 5 governance: multiply by trust (H1 fix — was missing for episodic).
      const score = base * (row.trust ?? 0.5);
      hits.push({
        id: row.id, content: row.content, source: row.source, tier: "episodic",
        score, importance: row.importance, veracity: row.veracity,
        memory_type: row.memory_type, timestamp: row.timestamp,
        scope: row.scope, agent_id: row.agent_id, trust: row.trust,
      });
    }
  }

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
 * Compose final score from BM25 rank, importance, temporal boost, and veracity.
 *
 * BM25 returns negative values (more negative = better). We normalize to [0, 1].
 * Final: (1 - normalized_bm25) * 0.5 + importance * 0.2 + temporal * 0.2 + veracity * 0.1
 */
function composeScore(bm25Rank: number, importance: number, temporalBoost: number, veracity: number): number {
  // BM25 returns negative values (more negative = better). Normalize per-query
  // using exponential decay: e^(bm25) maps [-inf, 0] → [0, 1] smoothly.
  // This preserves ranking discrimination even for very relevant docs.
  const normalizedBm25 = Math.exp(bm25Rank); // [0, 1], higher = better
  return normalizedBm25 * 0.5 + importance * 0.2 + temporalBoost * 0.2 + veracity * 0.1;
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
  return rows.map((r) => ({
    fact_id: r.fact_id, subject: r.subject, predicate: r.predicate, object: r.object,
    score: 1 - (-Math.max(-10, Math.min(0, r.rank)) / 10),
  }));
}
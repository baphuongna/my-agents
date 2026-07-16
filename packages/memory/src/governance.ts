/**
 * @my-agent/memory/governance — Trust scoring + contradiction detection (Phase 5).
 *
 * Hermes-holographic pattern: every memory has a trust score [0,1]. Feedback
 * adjusts it (+0.05 helpful / -0.10 unhelpful). Recall multiplies score by trust
 * (wired in sqlite-recall.ts) so low-trust memories rank lower. Contradiction
 * detection surfaces (does NOT auto-resolve) facts sharing entities with
 * divergent content — the human-in-loop model (gbrain lesson: don't need full TMS).
 *
 * Fixes Dig 4 authority: trust is a feedback-driven authority signal (not
 * source-weight). Low-trust memories sink without being deleted.
 */
import type { SqliteDatabase } from "./sqlite-db.js";
import { recall } from "./sqlite-recall.js";

export const TRUST_HELPFUL_DELTA = 0.05;
export const TRUST_UNHELPFUL_DELTA = -0.10;
export const TRUST_DEFAULT = 0.5;

/** Apply feedback: helpful boosts trust, unhelpful lowers it. Clamped [0, 1]. */
export function applyFeedback(
  db: SqliteDatabase,
  memoryId: string,
  table: "working_memory" | "episodic_memory",
  helpful: boolean,
): number | null {
  const row = db.prepare(`SELECT trust FROM ${table} WHERE id = ?`).get(memoryId) as { trust: number } | undefined;
  if (!row) return null;
  const delta = helpful ? TRUST_HELPFUL_DELTA : TRUST_UNHELPFUL_DELTA;
  const next = Math.max(0, Math.min(1, (row.trust ?? TRUST_DEFAULT) + delta));
  db.prepare(`UPDATE ${table} SET trust = ? WHERE id = ?`).run(next, memoryId);
  return next;
}

/** Recall weight = base score × trust (used by sqlite-recall.ts at hit-push). */
export function recallWeight(baseScore: number, trust: number): number {
  return baseScore * trust;
}

/**
 * Detect contradictions: brain-type memories sharing high content overlap but
 * divergent text. SURFACES them (returns the pairs) — does NOT auto-resolve.
 * The Phase 2 conflict check auto-supersedes; this governance layer lets an
 * operator/user REVIEW contradictions before action (human-in-loop, gbrain model).
 */
export function detectContradictions(
  db: SqliteDatabase,
  opts: { topK?: number; similarityThreshold?: number } = {},
): Array<{ a: string; b: string; aContent: string; bContent: string; similarity: number }> {
  const topK = opts.topK ?? 50;
  const threshold = opts.similarityThreshold ?? 0.6;
  // Scan recent brain-type memories, pairwise jaccard. Bounded by topK.
  const rows = db.prepare(`
    SELECT id, content, memory_type FROM working_memory
    WHERE superseded_by IS NULL AND memory_type IN
      ('preference','decision','fact','relationship','learning','instruction','entity','artifact')
    ORDER BY timestamp DESC LIMIT ?
  `).all(topK) as Array<{ id: string; content: string; memory_type: string }>;

  const pairs: Array<{ a: string; b: string; aContent: string; bContent: string; similarity: number }> = [];
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const sim = jaccard(rows[i]!.content, rows[j]!.content);
      // High overlap BUT not identical = potential contradiction.
      if (sim > threshold && rows[i]!.content.trim().toLowerCase() !== rows[j]!.content.trim().toLowerCase()) {
        pairs.push({
          a: rows[i]!.id, b: rows[j]!.id,
          aContent: rows[i]!.content, bContent: rows[j]!.content,
          similarity: sim,
        });
      }
    }
  }
  return pairs.sort((x, y) => y.similarity - x.similarity);
}

function jaccard(a: string, b: string): number {
  const wa = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
  const wb = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));
  if (wa.size === 0 || wb.size === 0) return 0;
  let inter = 0;
  for (const w of wa) if (wb.has(w)) inter++;
  return inter / (wa.size + wb.size - inter);
}

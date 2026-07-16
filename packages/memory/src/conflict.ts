/**
 * @my-agent/memory/conflict — Conflict detection + supersession for memory.
 *
 * Ported from mya-v1 `crates/mya-memory/src/conflict.rs` (mya's own predecessor,
 * dropped in the SQLite rewrite — this re-adopts it). Fixes Dig 2-3:
 * without this, contradictory memories are immortal (both recalled, LLM must
 * resolve ad-hoc). With this, storing a conflicting brain memory supersedes the
 * old one (sets superseded_by); recall already filters superseded_by IS NULL.
 *
 * Policy (faithful to mya-v1):
 *   - Only check "brain" / long-term types (preference/decision/fact/...).
 *     Session-scoped types (context/goal/error/event/...) are ephemeral — skip.
 *   - A conflict = HIGH text similarity (jaccard) BUT different content.
 *   - Same content (case/whitespace-insensitive) = update, not conflict.
 *   - Resolution = newest wins: old row gets superseded_by = newId.
 *
 * Phase-2 review fixes applied:
 *   - Case-folded identical check (HIGH-1: case-only diff no longer false-supersedes).
 *   - Transaction around supersede loop (HIGH-2: no partial state on throw).
 *   - recall(internal:true) — skips recall_count side-effect (MEDIUM-3).
 *   - Tier-aware supersede (table from hit.tier, not hardcoded working_memory).
 *   - artifact added to BRAIN_TYPES (MEDIUM-1).
 */
import { recall, type MemoryHit } from "./sqlite-recall.js";
import { supersede } from "./sqlite-store.js";
import { transaction } from "./sqlite-db.js";
import type { SqliteDatabase } from "./sqlite-db.js";

/** Long-term "brain" types worth conflict-checking (the "Core" category in mya-v1). */
export const BRAIN_TYPES = new Set([
  "preference", "decision", "fact", "relationship", "learning", "instruction", "entity", "artifact",
]);

/** Whether a memory type should be conflict-checked (brain types only). */
export function isBrainType(memoryType: string | undefined): boolean {
  return memoryType !== undefined && BRAIN_TYPES.has(memoryType);
}

/** Normalize content for the identical-check (trim + case-fold). */
function normalize(s: string): string {
  return s.trim().toLowerCase();
}

/** Jaccard similarity over word sets (token-overlap, no embeddings needed). */
export function jaccardSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));
  if (wordsA.size === 0 && wordsB.size === 0) return 1.0;
  if (wordsA.size === 0 || wordsB.size === 0) return 0.0;
  let intersection = 0;
  for (const w of wordsA) if (wordsB.has(w)) intersection++;
  const union = wordsA.size + wordsB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Find existing brain-type memories that conflict with new content.
 * A conflict = jaccard > threshold AND content differs case-insensitively
 * (identical content = update, not conflict). Pure function.
 */
export function findTextConflicts(
  hits: MemoryHit[],
  newContent: string,
  threshold: number,
): MemoryHit[] {
  const normalizedNew = normalize(newContent);
  return hits
    .filter((h) => isBrainType(h.memory_type))
    .filter((h) => jaccardSimilarity(h.content, newContent) > threshold)
    .filter((h) => normalize(h.content) !== normalizedNew); // identical = update, not conflict
}

/**
 * Check for conflicting brain memories and supersede them with the new one.
 * Mirrors mya-v1 `check_and_resolve_conflicts`. Returns the superseded IDs.
 * No-op for non-brain types. Supersede loop is wrapped in a transaction (atomic).
 */
export function checkAndResolveConflicts(
  db: SqliteDatabase,
  newId: string,
  newContent: string,
  newMemoryType: string | undefined,
  threshold = 0.7,
  topN = 50,
): string[] {
  if (!isBrainType(newMemoryType)) return [];

  // internal:true avoids polluting recall_count / access-reinforcement (this is
  // an internal scan, not a user retrieval). topN raised from 10 → 50 to avoid
  // missing conflicts in stores with >10 brain memories.
  const hits = recall(db, newContent, { topK: topN, internal: true });
  const candidates = hits.filter((h) => h.id !== newId);
  const conflicts = findTextConflicts(candidates, newContent, threshold);

  if (conflicts.length === 0) return [];

  const superseded: string[] = [];
  // Atomic: all supersedes commit together, or none (no partial state on throw).
  transaction(db, () => {
    for (const h of conflicts) {
      const table = h.tier === "episodic" ? "episodic_memory" : "working_memory";
      supersede(db, table, h.id, newId);
      superseded.push(h.id);
    }
  });
  return superseded;
}

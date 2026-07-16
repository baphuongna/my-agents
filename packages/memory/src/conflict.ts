/**
 * @my-agent/memory/conflict — Conflict detection + supersession for memory.
 *
 * Ported from mya-v1 `crates/mya-memory/src/conflict.rs` (mya's own predecessor,
 * dropped in the SQLite rewrite — this re-adopts it). Fixes Dig 2-3:
 * without this, contradictory memories are immortal. With this, storing a
 * conflicting brain memory supersedes the old one; recall filters superseded_by.
 *
 * Policy (faithful to mya-v1 + Phase 3 scope-aware):
 *   - Only check "brain" types (preference/decision/fact/...). Session types skip.
 *   - A conflict = HIGH jaccard BUT different content (case-insensitive).
 *   - Scope-aware (Phase 3): a memory only supersedes memories in the SAME scope
 *     (same role / same session / common). No cross-role/cross-session supersede.
 *   - Resolution = newest wins (old → superseded_by = newId).
 */
import { recall } from "./sqlite-recall.js";
import type { MemoryHit } from "./sqlite-recall.js";
import { supersede } from "./sqlite-store.js";
import { transaction } from "./sqlite-db.js";
import type { SqliteDatabase } from "./sqlite-db.js";

/** Long-term "brain" types worth conflict-checking (the "Core" category in mya-v1). */
export const BRAIN_TYPES = new Set([
  "preference", "decision", "fact", "relationship", "learning", "instruction", "entity", "artifact",
]);

export function isBrainType(memoryType: string | undefined): boolean {
  return memoryType !== undefined && BRAIN_TYPES.has(memoryType);
}

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

/** Find existing brain-type memories (same scope) that conflict. Pure function. */
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
 * Check for conflicting brain memories IN THE SAME SCOPE and supersede them.
 * Scope-aware (Phase 3): candidates are recall'd broadly (internal, no metric
 * side-effect) then filtered to the same (scope, agent_id) as the new memory.
 * No cross-role / cross-session supersession.
 */
export function checkAndResolveConflicts(
  db: SqliteDatabase,
  newId: string,
  newContent: string,
  newMemoryType: string | undefined,
  opts: { threshold?: number; topN?: number; scope?: string; agentId?: string; sessionId?: string } = {},
): string[] {
  if (!isBrainType(newMemoryType)) return [];
  const threshold = opts.threshold ?? 0.7;
  const topN = opts.topN ?? 50;
  const scope = opts.scope ?? "global";
  const agentId = opts.agentId;

  // Broad candidate recall (internal: no recall_count side-effect), then narrow
  // to same-scope. recall returns hits with scope+agent_id for the filter.
  const hits = recall(db, newContent, { topK: topN, internal: true });
  const sameScope = hits.filter((h) => {
    if (h.id === newId) return false;
    if ((h.scope ?? "global") !== scope) return false; // same scope only
    if (scope === "role" && agentId && (h.agent_id ?? null) !== agentId) return false; // same role
    return true;
  });
  const conflicts = findTextConflicts(sameScope, newContent, threshold);
  if (conflicts.length === 0) return [];

  const superseded: string[] = [];
  transaction(db, () => {
    for (const h of conflicts) {
      const table = h.tier === "episodic" ? "episodic_memory" : "working_memory";
      supersede(db, table, h.id, newId);
      superseded.push(h.id);
    }
  });
  return superseded;
}

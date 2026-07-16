/**
 * @my-agent/memory/grounding — Referent tracking + staleness detection (Phase 5).
 *
 * codebase-memory-mcp pattern: an observation that references a file/entity
 * carries a content hash. On recall, the hash is compared to the current
 * referent (metadata_match / metadata_changed) so stale facts can be flagged
 * or expired. This is the ONLY real re-verification primitive — all other
 * memory systems are trust-on-write.
 *
 * Fixes Dig 6 (ungrounded symbols): observations get grounded; recall can
 * detect when the referent moved/changed.
 *
 * Scope: observations only (tool outputs with file refs). Beliefs stay
 * trust-on-write + TTL (no reference does belief re-verification — unsolved).
 */
import type { SqliteDatabase } from "./sqlite-db.js";
import { existsSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

/** Record a referent for a memory (the file/entity it's about + a content hash). */
export function trackReferent(
  db: SqliteDatabase,
  memoryId: string,
  referentPath: string,
): void {
  let sha256: string | null = null;
  let mtimeMs: number | null = null;
  let size: number | null = null;
  try {
    const st = statSync(referentPath);
    if (st.isFile()) {
      mtimeMs = Math.floor(st.mtimeMs); // milliseconds — safe for JS Number (vs ns overflow)
      size = st.size;
      if (st.size < 256 * 1024) {
        sha256 = createHash("sha256").update(readFileSync(referentPath)).digest("hex");
      }
    }
  } catch {
    // referent doesn't exist (yet) — track the path with null hash; isStale will flag.
  }
  db.prepare(`
    INSERT INTO referents (memory_id, referent_path, sha256, mtime_ms, size)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(memory_id, referent_path) DO UPDATE SET
      sha256 = excluded.sha256, mtime_ms = excluded.mtime_ms, size = excluded.size,
      recorded_at = datetime('now')
  `).run(memoryId, referentPath, sha256, mtimeMs, size);
}

export type Staleness = "no_referent" | "match" | "changed" | "gone";

/**
 * Check whether a memory's referent is still current.
 * - no_referent: memory has no tracked referent (ungrounded — most memories).
 * - match: referent exists + hash/mtime unchanged (grounded + current).
 * - changed: referent exists but hash/mtime differ (STALE — fact may be wrong).
 * - gone: referent file no longer exists (fact is about something deleted).
 */
export function checkReferent(db: SqliteDatabase, memoryId: string): Staleness {
  const rows = db.prepare(`SELECT referent_path, sha256, mtime_ms, size FROM referents WHERE memory_id = ?`).all(memoryId) as Array<{
    referent_path: string; sha256: string | null; mtime_ms: number | null; size: number | null;
  }>;
  if (rows.length === 0) return "no_referent";
  for (const r of rows) {
    if (!existsSync(r.referent_path)) return "gone";
    try {
      const st = statSync(r.referent_path);
      if (r.mtime_ms !== null && r.size !== null) {
        if (Math.abs(Math.floor(st.mtimeMs) - r.mtime_ms) < 2 && st.size === r.size) {
          continue; // match for this referent
        }
      }
      // Mismatch → re-hash to confirm (if we have a stored hash).
      if (r.sha256 && st.isFile() && st.size < 256 * 1024) {
        const curHash = createHash("sha256").update(readFileSync(r.referent_path)).digest("hex");
        if (curHash === r.sha256) continue; // content same despite mtime change
      }
      return "changed";
    } catch {
      return "gone";
    }
  }
  return "match";
}

/** Memories whose referents have changed/gone (stale) — for a cleanup sweep. */
export function staleMemories(db: SqliteDatabase, limit = 100): Array<{ memory_id: string; staleness: Staleness }> {
  const rows = db.prepare(`SELECT DISTINCT memory_id FROM referents LIMIT ?`).all(limit) as Array<{ memory_id: string }>;
  const out: Array<{ memory_id: string; staleness: Staleness }> = [];
  for (const r of rows) {
    const s = checkReferent(db, r.memory_id);
    if (s === "changed" || s === "gone") out.push({ memory_id: r.memory_id, staleness: s });
  }
  return out;
}

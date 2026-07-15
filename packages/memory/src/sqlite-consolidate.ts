/**
 * @my-agent/memory/sqlite-consolidate — Consolidation + lifecycle management.
 *
 * Following mnemopi/src/core/beam/consolidate.ts pattern.
 *
 * Pipeline:
 *   1. Consolidation: working_memory (old, unconsolidated) → episodic_memory
 *   2. Tier degradation: episodic tier 1→2→3 (content compression)
 *   3. Weibull purge: remove memories below strength threshold
 */
import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { getUnconsolidated, markConsolidated, degradeTier } from "./sqlite-store.js";
import { weibullDecayFactor } from "./weibull.js";
import { transaction } from "./sqlite-db.js";

// ── Types ─────────────────────────────────────────────────────────────────

export interface ConsolidateResult {
  consolidated: number;
  episodicId: string | null;
  summaryPreview: string;
}

export interface DegradeResult {
  degraded: number;
}

export interface PurgeResult {
  purged: number;
}

// ── Constants (mnemopi pattern) ───────────────────────────────────────────

/** Hours before a working memory becomes eligible for consolidation. */
const CONSOLIDATION_AGE_HOURS = 1;

/** Min items per consolidation batch. */
const MIN_BATCH_SIZE = 2;

/** Tier degradation thresholds (days). */
const TIER2_AGE_DAYS = 30;
const TIER3_AGE_DAYS = 180;

/** Content truncation per tier. */
const TIER2_MAX_CHARS = 800;
const TIER3_MAX_CHARS = 300;

/** Strength threshold for Weibull purge. */
const PURGE_STRENGTH_THRESHOLD = 0.05;

// ── Consolidation ─────────────────────────────────────────────────────────

/**
 * Consolidate old unconsolidated working memories into episodic memories.
 *
 * Pipeline:
 *   1. SELECT unconsolidated working_memory older than threshold
 *   2. Group by (source, memory_type)
 *   3. For batches ≥ MIN_BATCH_SIZE: concatenate → episodic_memory INSERT
 *   4. Mark source items as consolidated
 */
export function consolidate(
  db: DatabaseSync,
  sessionId?: string,
): ConsolidateResult {
  const targetSession = sessionId ?? "default";
  const items = getUnconsolidated(db, targetSession, CONSOLIDATION_AGE_HOURS);
  if (items.length < MIN_BATCH_SIZE) {
    return { consolidated: 0, episodicId: null, summaryPreview: "" };
  }

  // Group by (source, memory_type)
  const groups = new Map<string, typeof items>();
  for (const item of items) {
    const key = `${item.source}|${item.memory_type}`;
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }

  let totalConsolidated = 0;
  let lastEpisodicId: string | null = null;
  let lastPreview = "";

  transaction(db, () => {
    for (const [, group] of groups) {
      if (group.length < MIN_BATCH_SIZE) continue;

      // Build summary: concatenate content from all items
      const contents = group.map((item) => item.content);
      const summary = contents.join(" / ").slice(0, 2000); // cap at 2KB
      const episodicId = randomUUID();

      // INSERT into episodic_memory
      db.prepare(`
        INSERT INTO episodic_memory
          (id, content, source, timestamp, session_id, importance, summary_of, memory_type, tier)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
      `).run(
        episodicId,
        summary,
        "consolidation",
        new Date().toISOString(),
        targetSession,
        Math.max(...group.map((g) => g.importance)),
        group.map((g) => g.id).join(","),
        group[0]!.memory_type,
      );

      // Mark source items as consolidated
      markConsolidated(db, group.map((g) => g.id), episodicId);

      // Log
      db.prepare(`
        INSERT INTO consolidation_log (session_id, items_consolidated, summary_preview)
        VALUES (?, ?, ?)
      `).run(targetSession, group.length, summary.slice(0, 200));

      totalConsolidated += group.length;
      lastEpisodicId = episodicId;
      lastPreview = summary.slice(0, 200);
    }
  });

  return {
    consolidated: totalConsolidated,
    episodicId: lastEpisodicId,
    summaryPreview: lastPreview,
  };
}

// ── Tier degradation ──────────────────────────────────────────────────────

/**
 * Degrade episodic memories: tier 1→2→3 based on age.
 * Content is truncated at each tier to save context window space.
 *
 * Tier 1 (fresh, <30 days):     full content
 * Tier 2 (compressed, 30-180d): content truncated to 800 chars
 * Tier 3 (key-signal, >180d):   content truncated to 300 chars
 */
export function degradeOldMemories(db: DatabaseSync): DegradeResult {
  let degraded = 0;
  const now = Date.now();

  transaction(db, () => {
    // Tier 1 → 2: older than 30 days
    const tier1Items = db.prepare(`
      SELECT id, content, timestamp FROM episodic_memory
      WHERE tier = 1 AND superseded_by IS NULL
    `).all() as Array<{ id: string; content: string; timestamp: string }>;

    for (const item of tier1Items) {
      const ageDays = (now - new Date(item.timestamp.replace("Z", "+00:00")).getTime()) / (24 * 3600_000);
      if (ageDays > TIER3_AGE_DAYS) {
        // Tier 1 → 3 (skip 2 if very old)
        db.prepare("UPDATE episodic_memory SET tier = 3, content = ?, degraded_at = ? WHERE id = ?")
          .run(item.content.slice(0, TIER3_MAX_CHARS), new Date().toISOString(), item.id);
        degraded++;
      } else if (ageDays > TIER2_AGE_DAYS) {
        // Tier 1 → 2
        db.prepare("UPDATE episodic_memory SET tier = 2, content = ?, degraded_at = ? WHERE id = ?")
          .run(item.content.slice(0, TIER2_MAX_CHARS), new Date().toISOString(), item.id);
        degraded++;
      }
    }

    // Tier 2 → 3: older than 180 days
    const tier2Items = db.prepare(`
      SELECT id, content, timestamp FROM episodic_memory
      WHERE tier = 2 AND superseded_by IS NULL
    `).all() as Array<{ id: string; content: string; timestamp: string }>;

    for (const item of tier2Items) {
      const ageDays = (now - new Date(item.timestamp.replace("Z", "+00:00")).getTime()) / (24 * 3600_000);
      if (ageDays > TIER3_AGE_DAYS) {
        db.prepare("UPDATE episodic_memory SET tier = 3, content = ?, degraded_at = ? WHERE id = ?")
          .run(item.content.slice(0, TIER3_MAX_CHARS), new Date().toISOString(), item.id);
        degraded++;
      }
    }
  });

  return { degraded };
}

// ── Weibull purge ─────────────────────────────────────────────────────────

/**
 * Purge memories whose Weibull strength has decayed below threshold.
 * Strength is computed per memory_type — profile types survive much longer
 * than event types.
 */
export function purgeWeakMemories(db: DatabaseSync): PurgeResult {
  let purged = 0;
  const now = Date.now();

  transaction(db, () => {
    // Check working_memory
    const workingItems = db.prepare(`
      SELECT id, timestamp, memory_type FROM working_memory
      WHERE consolidated_at IS NULL AND superseded_by IS NULL
    `).all() as Array<{ id: string; timestamp: string; memory_type: string }>;

    for (const item of workingItems) {
      const ageHours = (now - new Date(item.timestamp.replace("Z", "+00:00")).getTime()) / 3_600_000;
      const strength = weibullDecayFactor(ageHours, item.memory_type);
      if (strength < PURGE_STRENGTH_THRESHOLD) {
        db.prepare("DELETE FROM working_memory WHERE id = ?").run(item.id);
        purged++;
      }
    }

    // Check episodic_memory (higher threshold — they're consolidated)
    const episodicItems = db.prepare(`
      SELECT id, timestamp, memory_type FROM episodic_memory
      WHERE superseded_by IS NULL AND tier >= 3
    `).all() as Array<{ id: string; timestamp: string; memory_type: string }>;

    for (const item of episodicItems) {
      const ageHours = (now - new Date(item.timestamp.replace("Z", "+00:00")).getTime()) / 3_600_000;
      const strength = weibullDecayFactor(ageHours, item.memory_type);
      // Tier 3 memories need to be very weak before purge (threshold / 2)
      if (strength < PURGE_STRENGTH_THRESHOLD / 2) {
        db.prepare("DELETE FROM episodic_memory WHERE id = ?").run(item.id);
        purged++;
      }
    }
  });

  return { purged };
}

// ── Full lifecycle tick ───────────────────────────────────────────────────

/**
 * Run the full lifecycle: consolidate → degrade → purge.
 * Called on turn_end or DreamCycle timer.
 */
export function lifecycleTick(
  db: DatabaseSync,
  sessionId?: string,
): {
  consolidated: ConsolidateResult;
  degraded: DegradeResult;
  purged: PurgeResult;
} {
  return {
    consolidated: consolidate(db, sessionId),
    degraded: degradeOldMemories(db),
    purged: purgeWeakMemories(db),
  };
}
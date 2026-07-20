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
import type { SqliteDatabase } from "./sqlite-db.js";
import { randomUUID } from "node:crypto";
import { nowWallclock } from "@my-agent/core";
import { getUnconsolidated, markConsolidated, degradeTier, purgeExpired } from "./sqlite-store.js";
import { weibullDecayFactor, parseTimestamp } from "./weibull.js";
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

/**
 * Salience weight per memory type (agentmemory pattern).
 * High-value types (preference/decision) survive longer than low-value (event/context).
 * Multiplied into the Weibull strength so a preference decays slower than an event
 * of the same age. Popular memories also get an access-reinforcement boost below.
 */
const SALIENCE_BY_TYPE: Record<string, number> = {
  preference: 0.85,
  decision: 0.8,
  fact: 0.7,
  relationship: 0.7,
  learning: 0.7,
  instruction: 0.75,
  pattern: 0.6,
  setup: 0.6,
  entity: 0.6,
  artifact: 0.55,
  project: 0.5,
  profile: 0.5,
  goal: 0.45,
  observation: 0.4,
  context: 0.35,
  event: 0.3,
  error: 0.3,
  issue: 0.3,        // added: was silently 0.5 (same shape as error, eta 336)
  request: 0.25,     // added: was silently 0.5 (fastest-decaying, eta 72)
  commitment: 0.65,
  general: 0.45,
};
const DEFAULT_SALIENCE = 0.5;

/**
 * Access-reinforcement cap. Frequently-recalled memories get up to +50% strength
 * so popularity counteracts age (mirrors how human memory prioritizes referenced facts).
 * Derived from recall_count via log1p (agentmemory sigma=0.3 pattern).
 */
const ACCESS_BOOST_CAP = 0.5;
const ACCESS_BOOST_COEFF = 0.1;

function salienceFor(type: string): number {
  return SALIENCE_BY_TYPE[type] ?? DEFAULT_SALIENCE;
}

/**
 * Retention strength = Weibull temporal decay × salience(type) × (1 + accessBoost).
 * - Weibull: age-based decay (existing).
 * - Salience: type-based importance (NEW — preference > event).
 * - AccessBoost: recall-frequency reinforcement (NEW — popular survives).
 */
function retentionStrength(
  ageHours: number,
  memoryType: string,
  recallCount: number,
): number {
  const decay = weibullDecayFactor(ageHours, memoryType);
  const salience = salienceFor(memoryType);
  // Guard recall_count: SQLite INTEGER is unbounded but a defective/hostile
  // UPDATE could set negative or NULL. log1p(-1) = -Infinity → purges every
  // tick; log1p(NaN) = NaN → NaN < threshold is false → lives forever. Clamp.
  const safeRecall = Number.isFinite(recallCount) && recallCount > 0 ? recallCount : 0;
  const accessBoost = Math.min(ACCESS_BOOST_CAP, Math.log1p(safeRecall) * ACCESS_BOOST_COEFF);
  return decay * salience * (1 + accessBoost);
}

/** Parse a memory timestamp to epoch ms, robustly (handles Z, no-zone, datetime('now')). */
function tsToMs(timestamp: string): number | null {
  const d = parseTimestamp(timestamp);
  return d ? d.getTime() : null;
}

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
  db: SqliteDatabase,
  sessionId?: string,
): ConsolidateResult {
  const targetSession = sessionId ?? "default";
  const items = getUnconsolidated(db, targetSession, CONSOLIDATION_AGE_HOURS);
  if (items.length < MIN_BATCH_SIZE) {
    return { consolidated: 0, episodicId: null, summaryPreview: "" };
  }

  // Group by (source, memory_type, scope) — preserve scope isolation
  // so role-scoped memories don't mix across roles during consolidation.
  const groups = new Map<string, typeof items>();
  for (const item of items) {
    const key = `${item.source}|${item.memory_type}|${item.scope ?? "global"}|${item.agent_id ?? ""}`;
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
      // INSERT into episodic_memory (preserve scope from source items)
      const episodicScope = group[0]!.scope ?? "global";
      const episodicAgentId = group[0]!.agent_id ?? null;
      db.prepare(`
        INSERT INTO episodic_memory
          (id, content, source, timestamp, session_id, importance, summary_of, memory_type, tier, scope, agent_id, trust)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
      `).run(
        episodicId,
        summary,
        "consolidation",
        new Date().toISOString(),
        targetSession,
        Math.max(...group.map((g) => g.importance)),
        group.map((g) => g.id).join(","),
        group[0]!.memory_type,
        episodicScope,
        episodicAgentId,
        Math.max(...group.map((g) => g.trust ?? 0.5)), // propagate trust (deep-dive Finding 5)
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
export function degradeOldMemories(db: SqliteDatabase): DegradeResult {
  let degraded = 0;
  const now = nowWallclock();

  transaction(db, () => {
    // Tier 1 → 2: older than 30 days
    const tier1Items = db.prepare(`
      SELECT id, content, timestamp FROM episodic_memory
      WHERE tier = 1 AND superseded_by IS NULL LIMIT 1000
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
      WHERE tier = 2 AND superseded_by IS NULL LIMIT 1000
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
export function purgeWeakMemories(db: SqliteDatabase): PurgeResult {
  let purged = 0;
  const now = nowWallclock();

  transaction(db, () => {
    // Check working_memory — enhanced with salience(type) + access-reinforcement + pin protection.
    // Previously: pure Weibull decay (popular memories died same rate as unpopular).
    // Now: retentionStrength weights type importance + recall frequency, and pinned rows survive.
    const workingItems = db.prepare(`
      SELECT id, timestamp, memory_type, recall_count, pinned, content FROM working_memory
      WHERE consolidated_at IS NULL AND superseded_by IS NULL LIMIT 1000
    `).all() as Array<{ id: string; timestamp: string; memory_type: string; recall_count: number; pinned: number; content: string }>;

    const auditWorking = db.prepare(`
      INSERT INTO purge_log (source_table, row_id, memory_type, content_snippet, reason, strength_at_purge, pinned)
      VALUES ('working_memory', ?, ?, ?, 'weak_strength', ?, ?)
    `);
    const delWorking = db.prepare("DELETE FROM working_memory WHERE id = ?");

    for (const item of workingItems) {
      if (item.pinned) continue; // pin protection — never purge user-pinned memories
      const ms = tsToMs(item.timestamp);
      if (ms === null) continue; // unparseable timestamp — skip rather than mis-purge
      const ageHours = (now - ms) / 3_600_000;
      const strength = retentionStrength(ageHours, item.memory_type, item.recall_count ?? 0);
      if (strength < PURGE_STRENGTH_THRESHOLD) {
        auditWorking.run(item.id, item.memory_type, item.content.slice(0, 200), strength, item.pinned);
        delWorking.run(item.id);
        purged++;
      }
    }

    // Check episodic_memory (higher threshold — they're consolidated)
    const episodicItems = db.prepare(`
      SELECT id, timestamp, memory_type, recall_count, pinned, content FROM episodic_memory
      WHERE superseded_by IS NULL AND tier >= 3 LIMIT 1000
    `).all() as Array<{ id: string; timestamp: string; memory_type: string; recall_count: number; pinned: number; content: string }>;

    const auditEpisodic = db.prepare(`
      INSERT INTO purge_log (source_table, row_id, memory_type, content_snippet, reason, strength_at_purge, pinned)
      VALUES ('episodic_memory', ?, ?, ?, 'weak_strength', ?, ?)
    `);
    const delEpisodic = db.prepare("DELETE FROM episodic_memory WHERE id = ?");

    for (const item of episodicItems) {
      if (item.pinned) continue;
      const ms = tsToMs(item.timestamp);
      if (ms === null) continue;
      const ageHours = (now - ms) / 3_600_000;
      const strength = retentionStrength(ageHours, item.memory_type, item.recall_count ?? 0);
      // Tier 3 memories need to be very weak before purge (threshold / 2)
      if (strength < PURGE_STRENGTH_THRESHOLD / 2) {
        auditEpisodic.run(item.id, item.memory_type, item.content.slice(0, 200), strength, item.pinned);
        delEpisodic.run(item.id);
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
  db: SqliteDatabase,
  sessionId?: string,
): {
  consolidated: ConsolidateResult;
  degraded: DegradeResult;
  purged: PurgeResult;
  expired: number;
} {
  // Phase 1 (R17): run the hard TTL purge FIRST so expired rows (valid_until < now)
  // are removed regardless of strength. This is the ceiling that purgeExpired enforces;
  // before R17, valid_until was never set so purgeExpired was a no-op. Now storeWorking/
  // storeEpisodic set valid_until at capture per-type TTL, so this actually fires.
  const expired = purgeExpired(db, "working_memory") + purgeExpired(db, "episodic_memory");
  // Security review (mem0 deep-dive): bound the info-leak surface of the audit
  // tables — capture_audit persists previously-ephemeral conversation snippets.
  // Purged every tick so sensitive data (e.g. a key pasted in chat but never
  // "remembered") doesn't accumulate unbounded or outlive the memories.
  purgeStaleAuditLogs(db);
  return {
    consolidated: consolidate(db, sessionId),
    degraded: degradeOldMemories(db),
    purged: purgeWeakMemories(db),
    expired,
  };
}

/** Audit-table retention constants (days). capture_audit is short (ephemeral
 * debugging of skipped captures); conflict_audit is longer (supersession trail).
 * purge_log / consolidation_log are left intact — they predate this change and
 * their stated purpose is historical audit. */
export const CAPTURE_AUDIT_RETENTION_DAYS = 30;
export const CONFLICT_AUDIT_RETENTION_DAYS = 90;

/** Purge stale rows from the audit tables. Called from lifecycleTick. */
export function purgeStaleAuditLogs(db: SqliteDatabase): { capture: number; conflict: number } {
  const capture = db.prepare(
    "DELETE FROM capture_audit WHERE skipped_at < datetime('now', ?)",
  ).run(`-${CAPTURE_AUDIT_RETENTION_DAYS} days`).changes ?? 0;
  const conflict = db.prepare(
    "DELETE FROM conflict_audit WHERE superseded_at < datetime('now', ?)",
  ).run(`-${CONFLICT_AUDIT_RETENTION_DAYS} days`).changes ?? 0;
  return { capture, conflict };
}
/**
 * LaneBoard — liveness aggregator (§13).
 *
 * Subagents + cron + channel listeners emit heartbeats; the board classifies
 * each lane's freshness in ONE place. ComponentHealth tri-state (Healthy/Degraded/Failed).
 */
import type {
  ComponentHealth,
  LaneBoardEntry,
  LaneFreshness,
  LaneHeartbeat,
  LaneId,
} from "./types.js";
import { nowWallclock } from "./time.js";

const STALLED_AFTER_MS = 60_000;

/** Classify freshness from a heartbeat + the board's "now". */
export function classifyFreshness(
  hb: LaneHeartbeat,
  now: number = nowWallclock(),
): LaneFreshness {
  if (hb.blockedOn === "approval") return "AwaitingHuman";
  if (!hb.transportAlive) return "TransportDead";
  const age = now - hb.observedAt;
  if (age > STALLED_AFTER_MS) return "Stalled";
  return "Healthy";
}

export class LaneBoard {
  private lanes = new Map<LaneId, LaneBoardEntry>();

  upsert(entry: LaneBoardEntry): void {
    this.lanes.set(entry.taskId, entry);
  }

  observe(taskId: string, hb: LaneHeartbeat): void {
    const existing = this.lanes.get(taskId);
    const freshness = classifyFreshness(hb);
    if (existing) {
      existing.heartbeat = hb;
      existing.freshness = freshness;
    }
    // if no existing entry, the caller should upsert first
  }

  /** "Who's stuck?" — the one question the board answers. */
  stuck(): LaneBoardEntry[] {
    return [...this.lanes.values()].filter(
      (e) => e.freshness !== "Healthy",
    );
  }

  all(): LaneBoardEntry[] {
    return [...this.lanes.values()];
  }
}

/** Aggregate lane freshness → a single ComponentHealth (Degraded if any non-Healthy). */
export function laneBoardHealth(board: LaneBoard): ComponentHealth {
  const stuck = board.stuck();
  if (stuck.length === 0) return "Healthy";
  const hasFailed = stuck.some(
    (e) => e.freshness === "TransportDead",
  );
  return hasFailed ? "Failed" : "Degraded";
}

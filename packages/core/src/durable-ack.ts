/**
 * Honest durable ack — completion delivery classification + lifecycle.
 *
 * Ported from Hermes `_classify_completion_target` (deep-dive.md §6.4).
 *
 * Problem: a cron / async completion delivery can target a session that is:
 *  - **permanently gone** (deleted, non-compression ended) → if we keep
 *    replaying it as pending, the durable row stays pending forever (unbounded
 *    churn / wasted work).
 *  - **live** → deliver now.
 *  - **ended via compression** → the session has a continuation (the compression
 *    child). We should deliver to the tip. If the tip is uncertain (missing or
 *    also ended), release with bounded retry rather than dropping.
 *
 * Key insight from Hermes: "adapter acceptance is NOT proof of delivery — the
 * inner resolver can fail closed AFTER the adapter accepted, falsely
 * acknowledging the durable row as delivered."
 */

// ─── Classification ───────────────────────────────────────────────────────────

export type CompletionTargetClass = "terminal" | "retry" | "deliver";

export interface CompletionSession {
  id: string;
  /** Wallclock ms when the session ended, or null/undefined if still live. */
  endedAt?: number | null;
  /** Why the session ended (e.g. "compression", "user", "error"). */
  endReason?: string | null;
}

/**
 * Classify a completion delivery target.
 *
 * Decision tree (deep-dive.md §6.4):
 *  1. `parent === null`        → **terminal** (session gone → DROP, never replay)
 *  2. `!parent.endedAt`        → **deliver**  (session is live)
 *  3. `endReason !== compression` → **terminal** (permanently ended → DROP)
 *  4. Compression ended → check tip:
 *     - tip missing / ended → **retry** (transient uncertainty → RELEASE)
 *     - tip live            → **deliver**
 */
export function classifyCompletionTarget(
  parent: CompletionSession | null,
  tip?: CompletionSession | null,
): CompletionTargetClass {
  // 1. Parent session doesn't exist → permanently gone.
  if (parent === null) return "terminal";

  // 2. Parent is still live.
  if (!parent.endedAt) return "deliver";

  // 3. Parent ended but not via compression → permanently gone.
  if (parent.endReason !== "compression") return "terminal";

  // 4. Parent ended via compression → check the continuation tip.
  if (!tip || tip.endedAt) return "retry"; // tip missing or also ended
  return "deliver"; // tip is live — deliver to the continuation
}

// ─── DurableAckTracker ────────────────────────────────────────────────────────

/**
 * In-memory durable ack lifecycle tracker.
 *
 * State machine per (sessionId, deliveryId):
 * ```
 *   [pending] --claim--> [inflight] --complete--> [delivered] (terminal-success)
 *                                  \--release--> [pending]   (retry)
 *                                  \--drop----> [dropped]    (terminal-gone)
 * ```
 *
 * `claim` returns `false` if the delivery is already inflight or terminal
 * (delivered/dropped) — prevents double-processing.
 *
 * This is the in-memory bookkeeping; the durable row (SQLite / JSONL) is the
 * caller's responsibility. The tracker prevents duplicate in-process claims
 * within a single gateway lifetime.
 */
export class DurableAckTracker {
  /** sessionId → set of inflight delivery IDs. */
  private readonly inflight = new Map<string, Set<string>>();
  /** Terminal keys ("sessionId\0deliveryId") — delivered or dropped. */
  private readonly terminal = new Set<string>();

  private static key(sessionId: string, deliveryId: string): string {
    return `${sessionId}\0${deliveryId}`;
  }

  /**
   * Claim a delivery for in-flight processing.
   * @returns `false` if already inflight or terminal (delivered/dropped).
   */
  claim(sessionId: string, deliveryId: string): boolean {
    const k = DurableAckTracker.key(sessionId, deliveryId);
    if (this.terminal.has(k)) return false;
    let set = this.inflight.get(sessionId);
    if (set?.has(deliveryId)) return false;
    if (!set) {
      set = new Set<string>();
      this.inflight.set(sessionId, set);
    }
    set.add(deliveryId);
    return true;
  }

  /** Mark a delivery as successfully completed (terminal-success). */
  complete(sessionId: string, deliveryId: string): void {
    const k = DurableAckTracker.key(sessionId, deliveryId);
    this.terminal.add(k);
    this.removeFromInflight(sessionId, deliveryId);
  }

  /** Release a delivery back to pending (will be retried on the next sweep). */
  release(sessionId: string, deliveryId: string): void {
    this.removeFromInflight(sessionId, deliveryId);
  }

  /** Drop a delivery permanently (terminal — the target is gone; never retry). */
  drop(sessionId: string, deliveryId: string): void {
    const k = DurableAckTracker.key(sessionId, deliveryId);
    this.terminal.add(k);
    this.removeFromInflight(sessionId, deliveryId);
  }

  private removeFromInflight(sessionId: string, deliveryId: string): void {
    const set = this.inflight.get(sessionId);
    if (!set) return;
    set.delete(deliveryId);
    if (set.size === 0) this.inflight.delete(sessionId);
  }
}

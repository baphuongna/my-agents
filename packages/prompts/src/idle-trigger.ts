/**
 * Idle-compaction trigger site (P5 — shard 05).
 *
 * `shouldIdleCompact()` in compress.ts is a pure predicate with no caller. This
 * module wires the TRIGGER SITE: a function the turn prologue calls before each
 * turn to decide whether idle compaction should fire. It computes the idle gap,
 * checks the predicate, and (when true) runs a compression pass via a callback.
 *
 * Test surface (per task):
 *   - idle gap below threshold → no trigger
 *   - above threshold + tokens > floor → trigger
 *   - cooldown active → no trigger
 *   - floor check prevents over-summarization
 *
 * Source: research/shards/05-compression.md; Hermes idle-compaction trigger.
 */
import {
  shouldIdleCompact,
  type CompressionConfig,
  type CompressionState,
  type Message,
  type SummaryFn,
  compress,
} from "./compress.js";

/** The inputs to the idle-compaction trigger check. */
export interface IdleTriggerInput {
  /** Compression config (carries `enabled` + `idleCompactAfterSeconds`). */
  config: CompressionConfig;
  /** The anti-thrashing state (carries the cooldown). */
  state: CompressionState;
  /** Idle gap in seconds since the last turn completed. */
  idleGapSeconds: number;
  /** Current token estimate of the conversation. */
  currentTokens: number;
  /** Minimum tokens to trigger (floor — prevents over-summarization of a tiny
   * conversation after a long idle). Default: derived from the context floor. */
  floorTokens: number;
}

/** The trigger decision. */
export interface IdleTriggerDecision {
  /** Whether idle compaction should fire this prologue. */
  shouldCompact: boolean;
  /** Human-readable reason for the decision (for logging / tests). */
  reason: string;
}

/**
 * Check whether idle compaction should fire on this turn prologue.
 *
 * This is the **trigger site** — the pure decision function that wraps
 * `shouldIdleCompact` with a readable reason. It does NOT perform compression;
 * the caller uses `maybeIdleCompact` (or the decision directly) to run it.
 *
 * The floor check prevents over-summarization: even after a long idle gap, a
 * conversation below `floorTokens` is NOT compacted (compressing a tiny history
 * wastes a summary call and loses detail).
 */
export function checkIdleTrigger(input: IdleTriggerInput): IdleTriggerDecision {
  const { config, state, idleGapSeconds, currentTokens, floorTokens } = input;
  const cooldownActive = state.isBlocked();

  const should = shouldIdleCompact({
    enabled: config.enabled,
    idleAfterSeconds: config.idleCompactAfterSeconds,
    idleGapSeconds,
    tokens: currentTokens,
    floorTokens,
    cooldownActive,
  });

  if (should) {
    return {
      shouldCompact: true,
      reason: `idle gap ${idleGapSeconds}s ≥ ${config.idleCompactAfterSeconds}s and tokens ${currentTokens} ≥ floor ${floorTokens}`,
    };
  }

  // Provide a specific reason for why it did NOT fire.
  if (!config.enabled) return { shouldCompact: false, reason: "compression disabled" };
  if (config.idleCompactAfterSeconds <= 0) return { shouldCompact: false, reason: "idle compaction not configured (idleAfterSeconds=0)" };
  if (cooldownActive) return { shouldCompact: false, reason: "cooldown active (anti-thrashing)" };
  if (idleGapSeconds < config.idleCompactAfterSeconds) return { shouldCompact: false, reason: `idle gap ${idleGapSeconds}s < threshold ${config.idleCompactAfterSeconds}s` };
  if (currentTokens < floorTokens) return { shouldCompact: false, reason: `tokens ${currentTokens} < floor ${floorTokens} (over-summarization guard)` };
  return { shouldCompact: false, reason: "idle compaction conditions not met" };
}

/**
 * The turn-prologue trigger: check idle compaction, and if it should fire, run
 * a compression pass on the messages.
 *
 * @param input       The trigger inputs (config, state, idle gap, tokens, floor).
 * @param messages    The conversation messages to compress.
 * @param summaryFn   The LLM summary callback (or null for static fallback).
 * @returns           The trigger decision + the compressed messages (or the
 *                    original messages when no compaction fired).
 */
export async function maybeIdleCompact(
  input: IdleTriggerInput,
  messages: Message[],
  summaryFn: SummaryFn,
): Promise<{ decision: IdleTriggerDecision; messages: Message[] }> {
  const decision = checkIdleTrigger(input);
  if (!decision.shouldCompact) {
    return { decision, messages };
  }
  // Fire the compression pass. `force: true` bypasses the anti-thrashing block
  // for this explicit idle-triggered pass (the predicate already checked the
  // cooldown above; only a summary FAILURE cooldown would block, and we want to
  // respect that via the compress() internal guard instead).
  const compressed = await compress(messages, input.config, input.state, summaryFn, {
    force: true,
  });
  return { decision, messages: compressed };
}

/**
 * Context compression engine (§5 / Phase 2).
 *
 * Port of Hermes Agent's `context_compressor.py` (deep-dive-r2.md §2).
 *
 * Multi-phase pipeline:
 *   Phase 0: Guards + anti-thrashing state
 *   Phase 1: Cheap pre-pass — prune old tool results (NO LLM)
 *   Phase 2: Head/tail boundary split
 *   Phase 3: Summary generation (LLM via callback, or static fallback)
 *   Phase 4: Assembly + role selection (avoid consecutive same-role)
 *
 * All text crossing the summary boundary is redacted via
 * `redactSensitiveText(text, { force: true, redactUrlCredentials: true })`.
 * Uses `nowWallclock()` for time (invariant #10 — never Date.now()).
 */
import { createHash } from "crypto";
import { redactSensitiveText, nowWallclock } from "@my-agent/core";

// ─── Message type ────────────────────────────────────────────────────────────

/** A tool-call entry as found in assistant messages (OpenAI format). */
export interface ToolCallEntry {
  id: string;
  type: string;
  function: { name: string; arguments: string };
}

/**
 * Conversation message. Supports arbitrary metadata keys (e.g.
 * `_compressedSummary`) via the index signature.
 */
export interface Message {
  role: string;
  content: string;
  tool_calls?: ToolCallEntry[];
  tool_call_id?: string;
  name?: string;
  [meta: string]: unknown;
}

// ─── 2.1 Compression Config ─────────────────────────────────────────────────

export interface CompressionConfig {
  /** Master toggle. Default true. */
  enabled: boolean;
  /** Fraction of context window that triggers compression. Default 0.50. */
  threshold: number;
  /** Target output fraction for the summary. Default 0.20. */
  targetRatio: number;
  /** Messages protected from pruning at the tail (recent context). Default 20. */
  protectLastN: number;
  /** Messages protected at the head (system + early turns). Default 3. */
  protectFirstN: number;
  /** Max compression attempts on `finish:"length"`. Default 3 (hard-capped 10). */
  maxAttempts: number;
  /** Absolute token cap for triggering compression. `null` = use % only. */
  thresholdTokens: number | null;
  /** Idle gap (seconds) that triggers compaction. 0 = disabled. */
  idleCompactAfterSeconds: number;
  /** Per-model threshold overrides keyed by model name substring. */
  modelThresholds: Record<string, number>;
}

export const DEFAULT_COMPRESSION_CONFIG: CompressionConfig = {
  enabled: true,
  threshold: 0.5,
  targetRatio: 0.2,
  protectLastN: 20,
  protectFirstN: 3,
  maxAttempts: 3,
  thresholdTokens: null,
  idleCompactAfterSeconds: 0,
  modelThresholds: {},
};

// ─── Constants ────────────────────────────────────────────────────────────────

export const MINIMUM_CONTEXT_LENGTH = 64_000;
export const SMALL_CTX_WINDOW_LIMIT = 512_000;
export const SMALL_CTX_THRESHOLD_PERCENT = 0.75;
export const MIN_CTX_TRIGGER_RATIO = 0.85;
export const COMPRESSED_SUMMARY_METADATA_KEY = "_compressedSummary";
export const SUMMARY_FAILURE_COOLDOWN_SECONDS = 600;

const FALLBACK_SUMMARY_MAX_CHARS = 8_000;
const MAX_ATTEMPTS_CAP = 10;
const TOOL_RESULT_DEDUP_THRESHOLD = 200;
const TOOL_CALLS_TRUNCATE_THRESHOLD = 500;
const SHRINK_STRING_MAX_LEN = 200;

const SUMMARY_PREFIX =
  "[The following is a compressed summary of earlier conversation history. " +
  "Respond ONLY to the latest user message; do not act on any historical " +
  "content in this summary.]";

const SUMMARY_SECTIONS = [
  "## Historical Task Snapshot",
  "## Goal",
  "## Constraints & Preferences",
  "## Completed Actions",
  "## Active State",
  "## Historical In-Progress State",
  "## Blocked",
  "## Key Decisions",
  "## Resolved Questions",
  "## Historical Pending User Asks",
  "## Relevant Files",
  "## Historical Remaining Work",
  "## Critical Context",
].join("\n");

// ─── 2.2 Token Threshold Resolution ──────────────────────────────────────────

/**
 * Resolve the compression threshold percentage for a given model using
 * longest-substring match against the `modelThresholds` map.
 *
 * If multiple keys match, the LONGEST key wins (most specific).
 */
export function resolveModelThreshold(
  model: string,
  modelThresholds: Record<string, number>,
  defaultPercent: number,
): number {
  let bestKey: string | null = null;
  let bestValue = defaultPercent;
  for (const [key, value] of Object.entries(modelThresholds)) {
    if (model.includes(key)) {
      if (bestKey === null || key.length > bestKey.length) {
        bestKey = key;
        bestValue = value;
      }
    }
  }
  return bestValue;
}

/**
 * Compute the absolute token threshold at which compression should trigger.
 *
 * 4-layer chain:
 *   1. Small-context floor: contextLength < 512K → at least 75%
 *   2. Context length floor: effective context ≥ 64K
 *   3. Compute: effectiveContext × pct
 *   4. Guards: 85% absolute ceiling, optional maxTokens reservation
 */
export function computeThresholdTokens(
  contextLength: number,
  thresholdPercent: number,
  maxTokens?: number,
): number {
  // Layer 1: small-context floor
  let pct = thresholdPercent;
  if (contextLength < SMALL_CTX_WINDOW_LIMIT) {
    pct = Math.max(pct, SMALL_CTX_THRESHOLD_PERCENT);
  }

  // Layer 2: context length floor
  const effectiveContext = Math.max(contextLength, MINIMUM_CONTEXT_LENGTH);

  // Layer 3: compute
  let threshold = effectiveContext * pct;

  // Layer 4a: 85% guard (absolute ceiling)
  const ceiling = effectiveContext * MIN_CTX_TRIGGER_RATIO;
  threshold = Math.min(threshold, ceiling);

  // Layer 4b: maxTokens reservation
  if (maxTokens !== undefined) {
    threshold = Math.min(threshold, maxTokens);
  }

  return Math.floor(threshold);
}

// ─── 2.3 Idle Compaction Predicate ───────────────────────────────────────────

/**
 * Pure predicate: should we compact during an idle gap?
 *
 * Returns true only when ALL conditions hold:
 *   - idle compaction enabled
 *   - idleAfterSeconds > 0 (configured)
 *   - actual idle gap ≥ idleAfterSeconds
 *   - no cooldown active
 *   - current token usage ≥ floor
 */
export function shouldIdleCompact(opts: {
  enabled: boolean;
  idleAfterSeconds: number;
  idleGapSeconds: number;
  tokens: number;
  floorTokens: number;
  cooldownActive: boolean;
}): boolean {
  if (!opts.enabled) return false;
  if (opts.idleAfterSeconds <= 0) return false;
  if (opts.idleGapSeconds < opts.idleAfterSeconds) return false;
  if (opts.cooldownActive) return false;
  if (opts.tokens < opts.floorTokens) return false;
  return true;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Rough token estimate: ~4 chars per token (matches ranked-compaction.ts). */
function estimateMessageTokens(msg: Message): number {
  let chars = 0;
  if (typeof msg.content === "string") chars += msg.content.length;
  if (msg.tool_calls) {
    for (const tc of msg.tool_calls) {
      chars += tc.function.arguments.length;
      chars += tc.function.name.length;
    }
  }
  return Math.max(1, Math.floor(chars / 4));
}

/**
 * Recursively shrink string values in a parsed JSON structure to `maxLen`.
 * Mutates in place. Used by Pass 3 of pruneOldToolResults.
 */
function shrinkJsonStrings(obj: unknown, maxLen: number): void {
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      const val = obj[i];
      if (typeof val === "string") {
        if (val.length > maxLen) obj[i] = val.slice(0, maxLen) + "...[truncated]";
      } else {
        shrinkJsonStrings(val, maxLen);
      }
    }
    return;
  }
  if (obj !== null && typeof obj === "object") {
    const rec = obj as Record<string, unknown>;
    for (const key of Object.keys(rec)) {
      const val = rec[key];
      if (typeof val === "string") {
        if (val.length > maxLen) rec[key] = val.slice(0, maxLen) + "...[truncated]";
      } else {
        shrinkJsonStrings(val, maxLen);
      }
    }
  }
}

/** Extract the first non-empty line from a string (for tool-result summaries). */
function firstNonEmptyLine(text: string): string {
  const line = text.split("\n").find((l) => l.trim());
  return line ?? "";
}

// ─── 2.4 Prune Old Tool Results (3 passes, NO LLM) ──────────────────────────

/**
 * Cheap pre-pass that reduces tool output without an LLM.
 *
 * Pass 1: Dedup identical tool results (SHA-256 hash, >200 chars) — older
 *         dupes become a 1-line marker.
 * Pass 2: Replace remaining tool results >200 chars with a 1-line summary.
 * Pass 3: Truncate `tool_calls[].function.arguments` JSON >500 chars
 *         (parse → shrink string leaves → re-serialize; raw-slice fallback).
 *
 * Messages in the protected tail (last `protectTailCount`, or token-budgeted
 * via `protectTailTokens`) are never touched.
 */
export function pruneOldToolResults(
  messages: Message[],
  opts: { protectTailCount: number; protectTailTokens?: number },
): { messages: Message[]; prunedCount: number } {
  const result: Message[] = messages.map((m) => ({ ...m }));
  let prunedCount = 0;

  // Compute protection boundary
  let protectedStart: number;
  if (opts.protectTailTokens !== undefined) {
    // Walk backward with token budget + count floor
    let accumulated = 0;
    protectedStart = result.length;
    for (let i = result.length - 1; i >= 0; i--) {
      const msg = result[i];
      if (!msg) continue;
      const tokens = estimateMessageTokens(msg);
      if (
        accumulated + tokens > opts.protectTailTokens &&
        result.length - i >= opts.protectTailCount
      ) {
        protectedStart = i + 1;
        break;
      }
      accumulated += tokens;
      protectedStart = i;
    }
  } else {
    protectedStart = Math.max(0, result.length - opts.protectTailCount);
  }

  // Pass 1: Dedup identical tool results
  const seenHashes = new Set<string>();
  for (let i = 0; i < protectedStart; i++) {
    const msg = result[i];
    if (!msg || msg.role !== "tool") continue;
    if (typeof msg.content !== "string" || msg.content.length <= TOOL_RESULT_DEDUP_THRESHOLD)
      continue;
    const hash = sha256(msg.content);
    if (seenHashes.has(hash)) {
      result[i] = {
        ...msg,
        content: "[Duplicate tool output — same content as a more recent call]",
      };
      prunedCount++;
    } else {
      seenHashes.add(hash);
    }
  }

  // Pass 2: Replace >200 char tool results with 1-line summary
  for (let i = 0; i < protectedStart; i++) {
    const msg = result[i];
    if (!msg || msg.role !== "tool") continue;
    if (typeof msg.content !== "string" || msg.content.length <= TOOL_RESULT_DEDUP_THRESHOLD)
      continue;
    const line = firstNonEmptyLine(msg.content);
    result[i] = {
      ...msg,
      content: `[Truncated tool output] ${line.slice(0, 150)}`,
    };
    prunedCount++;
  }

  // Pass 3: Truncate tool_calls args JSON >500 chars
  for (let i = 0; i < protectedStart; i++) {
    const msg = result[i];
    if (!msg || msg.role !== "assistant" || !msg.tool_calls) continue;
    let modified = false;
    const newCalls = msg.tool_calls.map((tc) => {
      if (tc.function.arguments.length <= TOOL_CALLS_TRUNCATE_THRESHOLD) return tc;
      modified = true;
      try {
        const parsed: unknown = JSON.parse(tc.function.arguments);
        shrinkJsonStrings(parsed, SHRINK_STRING_MAX_LEN);
        return {
          ...tc,
          function: { ...tc.function, arguments: JSON.stringify(parsed) },
        };
      } catch {
        // Not valid JSON — raw-slice as fallback
        return {
          ...tc,
          function: {
            ...tc.function,
            arguments:
              tc.function.arguments.slice(0, TOOL_CALLS_TRUNCATE_THRESHOLD) +
              "...[truncated]",
          },
        };
      }
    });
    if (modified) {
      result[i] = { ...msg, tool_calls: newCalls };
      prunedCount++;
    }
  }

  return { messages: result, prunedCount };
}

// ─── 2.5 Summary Generation ──────────────────────────────────────────────────

/** Callback type: receive a prompt string, return a summary or null. */
export type SummaryFn = (prompt: string) => Promise<string | null>;

/**
 * Generate a structured checkpoint summary via the provided `summaryFn` callback.
 *
 * - First compaction: structured template with 13 sections.
 * - Rolling update: feeds `previousSummary` back so information is preserved.
 * - All text (input turns, previous summary, focus topic, memory context, and
 *   the output) is redacted through `redactSensitiveText` with `force: true`.
 *
 * Returns `null` if the callback throws or returns null (caller falls back).
 */
export async function generateSummary(
  turns: Message[],
  opts: {
    focusTopic?: string;
    memoryContext?: string;
    previousSummary?: string;
    summaryFn: SummaryFn;
  },
): Promise<string | null> {
  // Serialize turns into readable transcript
  const content = turns
    .map((t) => {
      const parts: string[] = [`[${t.role}]`];
      if (typeof t.content === "string" && t.content.length > 0) {
        parts.push(t.content);
      }
      if (t.tool_calls && t.tool_calls.length > 0) {
        parts.push(
          `(tool calls: ${t.tool_calls.map((tc) => tc.function.name).join(", ")})`,
        );
      }
      return parts.join(" ");
    })
    .join("\n\n");

  // Redact all inputs at the boundary
  const redactedContent = redactSensitiveText(content, {
    force: true,
    redactUrlCredentials: true,
  });
  const redactedPrevious = opts.previousSummary
    ? redactSensitiveText(opts.previousSummary, {
        force: true,
        redactUrlCredentials: true,
      })
    : undefined;
  const redactedFocus = opts.focusTopic
    ? redactSensitiveText(opts.focusTopic, {
        force: true,
        redactUrlCredentials: true,
      })
    : undefined;
  const redactedMemory = opts.memoryContext
    ? redactSensitiveText(opts.memoryContext, {
        force: true,
        redactUrlCredentials: true,
      })
    : undefined;

  // Build prompt
  let prompt: string;
  if (redactedPrevious) {
    // Rolling update template (re-compaction)
    prompt = [
      "PREVIOUS SUMMARY:",
      redactedPrevious,
      "",
      "NEW TURNS TO INCORPORATE:",
      redactedContent,
      "",
      "PRESERVE all existing information from the previous summary.",
      "ADD new completed actions and resolved questions.",
      'Move items from "In Progress" to "Completed" as appropriate.',
      "CRITICAL: Update ## Active State to reflect the user's most recent input.",
      "",
      "Use these sections:",
      SUMMARY_SECTIONS,
    ].join("\n");
  } else {
    // First compaction template
    prompt = [
      "TURNS TO SUMMARIZE:",
      redactedContent,
      "",
      "Create a structured checkpoint summary using these sections:",
      SUMMARY_SECTIONS,
      "",
      "Target approximately 2000 tokens. Be concise but preserve all critical information.",
    ].join("\n");
  }

  if (redactedFocus) {
    prompt += `\n\nFocus topic: ${redactedFocus}`;
  }
  if (redactedMemory) {
    prompt += `\n\nMemory context:\n${redactedMemory}`;
  }

  // Call the summary function
  let summary: string | null;
  try {
    summary = await opts.summaryFn(prompt);
  } catch {
    return null;
  }
  if (summary === null) return null;

  // Redact the output at the boundary
  return redactSensitiveText(summary, { force: true, redactUrlCredentials: true });
}

/**
 * Static fallback summary (no LLM). Template-based extraction of user/assistant
 * turns. Used when `generateSummary` returns null.
 */
function buildStaticFallback(turns: Message[]): string {
  const userTurns = turns.filter((m) => m.role === "user");
  const assistantTurns = turns.filter((m) => m.role === "assistant");

  const lines: string[] = [];
  lines.push("## Historical Task Snapshot");
  lines.push(`(Auto-generated fallback summary of ${turns.length} earlier messages)`);
  lines.push("");

  if (userTurns.length > 0) {
    const first = userTurns[0];
    lines.push("## Goal");
    lines.push((first?.content ?? "").slice(0, 500));
    lines.push("");
  }

  if (assistantTurns.length > 0) {
    lines.push("## Completed Actions");
    for (const a of assistantTurns) {
      lines.push(`- ${(a.content ?? "").slice(0, 200)}`);
    }
    lines.push("");
  }

  const last = turns[turns.length - 1];
  lines.push("## Active State");
  lines.push((last?.content ?? "").slice(0, 500));

  let summary = lines.join("\n");
  if (summary.length > FALLBACK_SUMMARY_MAX_CHARS) {
    summary = summary.slice(0, FALLBACK_SUMMARY_MAX_CHARS);
  }
  return redactSensitiveText(summary, { force: true, redactUrlCredentials: true });
}

// ─── 2.6 Assembly + Role Selection ──────────────────────────────────────────

/**
 * Assemble the compressed message list: `head + summary + tail`.
 *
 * Role selection rules (ported from Hermes §2.5):
 *   - Anthropic/Bedrock need user-first: force user if head is empty or ends
 *     with system.
 *   - Zero-user guard: if NO user-role survives in head+tail, force user.
 *   - Avoid consecutive same-role: if head ends with assistant/tool, summary
 *     becomes user; otherwise assistant.
 *   - Flip if summary role collides with the first tail message — but only
 *     when the flip doesn't collide with head.
 *
 * The summary message gets the `_compressedSummary: true` metadata key.
 */
export function assembleCompressed(
  head: Message[],
  summary: string,
  tail: Message[],
): Message[] {
  const lastHeadRole = head.length > 0 ? head[head.length - 1]?.role : undefined;
  const firstTailRole = tail.length > 0 ? tail[0]?.role : undefined;

  // Check if any user-role survives in head + tail
  const hasUser = [...head, ...tail].some((m) => m.role === "user");

  // Force user-leading for Anthropic when head is empty or ends with system
  let forceUserLeading = head.length === 0 || lastHeadRole === "system";

  // Zero-user guard (#58753): force user if NO user-role survives
  if (!forceUserLeading && !hasUser) {
    forceUserLeading = true;
  }

  // Choose summary role
  let summaryRole: string;
  if (lastHeadRole === "assistant" || lastHeadRole === "tool" || forceUserLeading) {
    summaryRole = "user";
  } else {
    summaryRole = "assistant";
  }

  // Flip if collides with tail (only when flip doesn't collide with head)
  if (firstTailRole !== undefined && summaryRole === firstTailRole) {
    const flipped = summaryRole === "user" ? "assistant" : "user";
    if (head.length === 0 || flipped !== lastHeadRole) {
      summaryRole = flipped;
    }
    // If both collide, accept the tail collision (rare edge case).
  }

  const summaryMsg: Message = {
    role: summaryRole,
    content: `${SUMMARY_PREFIX}\n\n${summary}`,
  };
  summaryMsg[COMPRESSED_SUMMARY_METADATA_KEY] = true;

  return [...head, summaryMsg, ...tail];
}

/** Check whether a message is a compressed-summary marker. */
export function isCompressedSummaryMessage(msg: Message): boolean {
  return msg[COMPRESSED_SUMMARY_METADATA_KEY] === true;
}

// ─── 2.7 Anti-Thrashing State ───────────────────────────────────────────────

/**
 * Mutable state tracking compression effectiveness across turns.
 *
 * The anti-thrashing verdict is provider-verified (NOT estimate-based): after
 * each turn, `updateFromResponse` checks the provider's real token count
 * against the threshold. If still over after compaction, the ineffective
 * counter increments.
 *
 * Compression is blocked when:
 *   - Cooldown is active (summary failure)
 *   - ineffectiveCount ≥ 2 (compaction isn't helping)
 *   - fallbackStreak ≥ 2 (LLM summary keeps failing)
 */
export class CompressionState {
  ineffectiveCount: number = 0;
  fallbackStreak: number = 0;
  cooldownUntil: number = 0; // wallclock ms

  /**
   * Preflight check using a rough token estimate.
   * Returns false if below threshold or blocked.
   */
  shouldCompress(tokens: number, thresholdTokens: number): boolean {
    if (tokens < thresholdTokens) return false;
    return !this.isBlocked();
  }

  /**
   * Provider-verified update. If the real token count is still ≥ threshold
   * after a compaction, increment the ineffective counter.
   */
  updateFromResponse(realTokens: number, thresholdTokens: number): void {
    if (realTokens >= thresholdTokens) {
      this.ineffectiveCount++;
    }
  }

  /** Is compression currently blocked by anti-thrashing? */
  isBlocked(): boolean {
    if (this.cooldownUntil > nowWallclock()) return true;
    if (this.ineffectiveCount >= 2) return true;
    if (this.fallbackStreak >= 2) return true;
    return false;
  }

  /** Set the summary-failure cooldown (default 600s). */
  setCooldown(seconds: number = SUMMARY_FAILURE_COOLDOWN_SECONDS): void {
    this.cooldownUntil = nowWallclock() + seconds * 1000;
  }

  /** Reset all counters (e.g. after a successful compression cycle). */
  reset(): void {
    this.ineffectiveCount = 0;
    this.fallbackStreak = 0;
    this.cooldownUntil = 0;
  }
}

// ─── 2.8 Main compress() Function ────────────────────────────────────────────

/**
 * Run the full compression pipeline on a message list.
 *
 * Phases:
 *   0. Guards: min-size, anti-thrashing, config enabled.
 *   1. Pre-pass: prune old tool results (no LLM).
 *   2. Boundaries: split into head (protectFirstN) / turns / tail (protectLastN).
 *   3. Summary: LLM via `summaryFn`; static fallback on null/error.
 *   4. Assembly: role selection + metadata.
 *
 * @param opts.force  Bypass config.enabled + anti-thrashing block.
 */
export async function compress(
  messages: Message[],
  config: CompressionConfig,
  state: CompressionState,
  summaryFn: SummaryFn,
  opts?: {
    force?: boolean;
    focusTopic?: string;
    memoryContext?: string;
    currentTokens?: number;
  },
): Promise<Message[]> {
  // Phase 0: guards
  if (opts?.force) {
    state.cooldownUntil = 0;
  }
  if (!config.enabled && !opts?.force) {
    return messages;
  }

  // Min-size guard: not enough messages to meaningfully compress
  const minSize = config.protectFirstN + 4;
  if (messages.length <= minSize) {
    if (!opts?.force) state.ineffectiveCount++;
    return messages;
  }

  // Anti-thrashing: check block
  if (!opts?.force && state.isBlocked()) {
    return messages;
  }

  // Phase 1: cheap pre-pass (no LLM)
  const pruned = pruneOldToolResults(messages, {
    protectTailCount: config.protectLastN,
  });
  const working = pruned.messages;

  // Phase 2: boundaries
  const headEnd = Math.min(config.protectFirstN, working.length);
  const tailStart = Math.max(headEnd + 1, working.length - config.protectLastN);

  // Check if there are turns to summarize
  if (tailStart - headEnd <= 0) {
    if (!opts?.force) state.ineffectiveCount++;
    return messages;
  }

  const head = working.slice(0, headEnd);
  const turns = working.slice(headEnd, tailStart);
  const tail = working.slice(tailStart);

  // Extract existing compressed summaries for rolling update.
  // Strip them from turns so they don't get re-summarized.
  const previousSummaries: string[] = [];
  const cleanTurns = turns.filter((m) => {
    if (isCompressedSummaryMessage(m)) {
      const text = typeof m.content === "string" ? m.content : String(m.content ?? "");
      previousSummaries.push(text);
      return false; // remove from turns
    }
    return true;
  });

  // Phase 3: summary generation
  let summary: string | null = null;
  try {
    summary = await generateSummary(cleanTurns, {
      focusTopic: opts?.focusTopic,
      memoryContext: opts?.memoryContext,
      previousSummary: previousSummaries.length > 0 ? previousSummaries.join("\n\n") : undefined,
      summaryFn,
    });
  } catch {
    summary = null;
  }

  if (summary === null) {
    // Fallback to static template (no LLM)
    summary = buildStaticFallback(cleanTurns);
    state.fallbackStreak++;
    state.setCooldown();
  } else {
    state.fallbackStreak = 0;
  }

  // Phase 4: assembly + role selection
  return assembleCompressed(head, summary, tail);
}

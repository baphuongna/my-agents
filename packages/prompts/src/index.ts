/**
 * @my-agent/prompts — 3-tier cache-stable prompt system (§5).
 *
 * assemblePrompt (memoized, cache-stable) · injection scanner · DriftGrader.
 */
export {
  assemblePrompt,
  rebuildStableTier,
  rebuildVolatile,
  markCompressed,
  buildVolatileTier,
  createPromptMutex,
  defaultStableTier,
  PROMPT_TIMING,
} from "./assembler.js";
export { scan, scanInject } from "./inject.js";
export { DriftGrader, identityCompressor } from "./drift.js";
export type { DriftGrade } from "./drift.js";
export { windowCompressor, summarizeCompressor, nativeContentCompressor, overflowRecovery } from "./compressors.js";
export { rankedCompact } from "./ranked-compaction.js";
export {
  compress,
  generateSummary,
  shouldIdleCompact,
  resolveModelThreshold,
  computeThresholdTokens,
  pruneOldToolResults,
  assembleCompressed,
  CompressionState,
  isCompressedSummaryMessage,
  DEFAULT_COMPRESSION_CONFIG,
  MINIMUM_CONTEXT_LENGTH,
  SMALL_CTX_WINDOW_LIMIT,
  SMALL_CTX_THRESHOLD_PERCENT,
  MIN_CTX_TRIGGER_RATIO,
  COMPRESSED_SUMMARY_METADATA_KEY,
  SUMMARY_FAILURE_COOLDOWN_SECONDS,
} from "./compress.js";
export type {
  CompressionConfig,
  Message,
  ToolCallEntry,
  SummaryFn,
} from "./compress.js";
export { apply_request_context } from "./request-context.js";
export type {
  RequestContext,
  RequestContextRebuilder,
  RequestContextResult,
} from "./request-context.js";
export { checkIdleTrigger, maybeIdleCompact } from "./idle-trigger.js";
export type { IdleTriggerInput, IdleTriggerDecision } from "./idle-trigger.js";

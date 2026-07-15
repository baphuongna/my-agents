/**
 * @my-agent/memory — Unified 5-layer memory pipeline.
 *
 * Architecture:
 *   Layer 1: INGEST     → capture() + compress + dedup
 *   Layer 2: STORE      → UnifiedStore (in-memory BM25 index + markdown durability)
 *   Layer 3: LIFECYCLE  → LifecycleManager (decay + consolidate + purge + supersede)
 *   Layer 4: RETRIEVE   → RetrievalEngine (unified pipeline)
 *   Layer 5: PERSIST    → snapshot + manifest
 */
export { InMemoryBackend, FileBackend } from "./backends.js";
export type { MemoryBackend } from "./backends.js";
export { MemoryManagerImpl, stubMemoryManager } from "./manager.js";
export type { MemoryManagerCtorOptions, MemoryFacade } from "./manager.js";
export { ArchivistRole, GoalsRole, cleanTurnToMarkdown } from "./roles.js";
export type { MemoryRole } from "./roles.js";

export type { RetrievalArm } from "./rrf.js";
export { Brain } from "./brain.js";
export type { Fact, Take, BrainPage, FactKind, FactVisibility } from "./brain.js";
export { reciprocalRankFuse, rrfRetrieve, bm25Arm, substringArm, vectorArm, graphArm } from "./rrf.js";
export { RagfsRouter, StaticContextSource, KnowledgeSource, parseRagfsUri, RAGFS_BLOCKED } from "./ragfs.js";
export { makeRagfsScanner, allowAllScanner, denyAllScanner } from "./ragfs-bridge.js";
export type { ContextSource, RagfsUri, RagfsScanner } from "./ragfs.js";
export { createRagfs } from "./ragfs-factory.js";
export { MemoryContextSource } from "./memory-source.js";
export { TypedGraph } from "./graph.js";
export type { KGEntity, KGRelation } from "./graph.js";

export { DreamCycle, DEFAULT_DREAM_INTERVAL_MS, STALE_SKILL_AFTER_DAYS } from "./dream-cycle.js";
export type { DreamResult, DreamCycleOptions, SkillCurator } from "./dream-cycle.js";

// ── Phase A: MemoryTree (L0/L1/L2) + MemoryDomain system ──────────────────
export { MemoryTree, L0_TTL_MS } from "./tree.js";
export type { Tier } from "./tree.js";

export type {
  MemoryDomain,
  MemoryDomainEntry,
  MemoryDomainOpts,
  ConsolidationReport,
} from "./domains/types.js";
// ── Tier-3: Unified pipeline modules ──
export { RetrievalEngine, FuzzyCache } from "./retrieve.js";
export type { RetrievalResult } from "./retrieve.js";
export { LifecycleManager } from "./lifecycle.js";
export type { LifecycleResult } from "./lifecycle.js";
export { UnifiedStore } from "./store.js";
export { BrainStore } from "./brain-store.js";
export type { BrainRecord, BrainSnapshot } from "./brain-store.js";

// ── Domains (backward compat — still exported for existing tests/wiring) ──
export { ArchivistDomain, archivistDomain } from "./domains/archivist.js";
export { TreeDomain, treeDomain } from "./domains/tree.js";
export { DiffDomain, diffDomain } from "./domains/diff.js";
export { GoalsDomain, goalsDomain } from "./domains/goals.js";
export { SyncDomain, syncDomain, compareHlc } from "./domains/sync.js";
export type { HlcTimestamp } from "./domains/sync.js";
export { GraphDomain, graphDomain } from "./domains/graph.js";
export { ConversationsDomain, conversationsDomain } from "./domains/conversations.js";
export { SearchDomain, searchDomain } from "./domains/search.js";
export { SourcesDomain, sourcesDomain } from "./domains/sources.js";
export { EntitiesDomain, entitiesDomain } from "./domains/entities.js";
export { StoreDomain, storeDomain } from "./domains/store.js";
export { ToolsDomain, toolsDomain } from "./domains/tools.js";
export { QueueDomain, queueDomain } from "./domains/queue.js";

// ── Phase 1: SQLite foundation ──
export { openDB, transaction, closeDB, checkpoint } from "./sqlite-db.js";
export type { DatabasePath } from "./sqlite-db.js";
export { initSchema, getSchemaVersion } from "./sqlite-schema.js";

// ── Phase 2: Store layer ──
export {
  storeWorking, storeEpisodic, storeFact,
  markConsolidated, recordRecall, supersede, degradeTier, purgeExpired,
  getUnconsolidated, getWorkingById, countTable,
} from "./sqlite-store.js";
export type { WorkingMemoryInput, EpisodicMemoryInput, FactInput, MemoryRecord } from "./sqlite-store.js";

// ── Phase 3: Recall pipeline + Weibull ──
export { recall, recallFacts } from "./sqlite-recall.js";
export type { RecallOptions, MemoryHit } from "./sqlite-recall.js";
export { weibullBoost, weibullDecayFactor, WEIBULL_PARAMS } from "./weibull.js";
export type { MemoryType, WeibullParams } from "./weibull.js";

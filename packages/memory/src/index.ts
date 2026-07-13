/**
 * @my-agent/memory — MemoryManager + per-role backends (§8).
 *
 * InMemoryBackend (BestEffort) · FileBackend (Durable, markdown write-through).
 * snapshot() is sync (cached); refresh() is async (called at tier boundaries).
 */
export { InMemoryBackend, FileBackend } from "./backends.js";
export type { MemoryBackend } from "./backends.js";
export { MemoryManagerImpl, stubMemoryManager } from "./manager.js";
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

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
export { reciprocalRankFuse, rrfRetrieve, bm25Arm, substringArm } from "./rrf.js";
export type { RetrievalArm } from "./rrf.js";
export { RagfsRouter, StaticContextSource, parseRagfsUri } from "./ragfs.js";
export type { ContextSource, RagfsUri } from "./ragfs.js";
export { Brain } from "./brain.js";
export type { Fact, Take, BrainPage, FactKind, FactVisibility } from "./brain.js";

/**
 * @my-agent/memory — MemoryManager + per-role backends (§8).
 *
 * InMemoryBackend (BestEffort) · FileBackend (Durable, markdown write-through).
 * snapshot() is sync (cached); refresh() is async (called at tier boundaries).
 */
export { InMemoryBackend, FileBackend } from "./backends.js";
export type { MemoryBackend } from "./backends.js";
export { MemoryManagerImpl, stubMemoryManager } from "./manager.js";
export { Brain } from "./brain.js";
export type { Fact, Take, BrainPage, FactKind, FactVisibility } from "./brain.js";

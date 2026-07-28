import { Brain } from "./brain.js";
import { SqliteBrainStore } from "./brain-sqlite-store.js";

/** Factory: construct a Brain from the memory-backend config.
 * Exported from @my-agent/memory so both the CLI/TUI path (print) and the SDK
 * path (agent) share the same config-gated factory without circular deps. */
export function createBrainFromConfig(
  memoryBackend: string | undefined,
  dbPath: string,
): { brain: Brain; close?: () => void } {
  if (memoryBackend === "sqlite") {
    const store = new SqliteBrainStore(dbPath);
    return { brain: new Brain(3, 0.85, store), close: () => store.close() };
  }
  return { brain: new Brain() };
}

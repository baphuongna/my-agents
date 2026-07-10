/**
 * Session + History — minimal Tier-0 implementations.
 *
 * History is an append-only log (JSONL tree in Tier 1; in-memory array here).
 */
import type { History, MemorySnapshot, ProviderProfile, Session } from "./types.js";

export class ArrayHistory implements History {
  private _entries: unknown[] = [];
  append(entry: unknown): void {
    this._entries.push(entry);
  }
  entries(): readonly unknown[] {
    return this._entries;
  }
}

/** Tier-0 MemoryManager stub: returns an empty snapshot (R29-6/M10). */
export function stubMemory(): Session["memory"] {
  return {
    snapshot: (): MemorySnapshot => ({ entries: [], generatedDay: 0 }),
    query: async () => [],
  };
}

/** Build a minimal Tier-0 session. */
export function createSession(opts: {
  profiles: ProviderProfile[];
  stableTier?: string;
  userMd?: string;
}): Session {
  return {
    profiles: opts.profiles,
    stableTier: opts.stableTier ?? "",
    ctxFiles: [],
    memory: stubMemory(),
    userMd: opts.userMd ?? "",
    history: new ArrayHistory(),
    skillSetDirty: false,
  };
}

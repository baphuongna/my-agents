/**
 * MemoryManager (§8) — aggregates per-role backends; serves snapshot() + query().
 *
 * snapshot() is SYNC (returns a cached snapshot) because the §5 prompt assembler
 * calls it synchronously at tier boundaries. The cache is refreshed ASYNC via
 * refresh() — the loop/transport calls refresh() when memory changes, then the
 * next assemblePrompt/rebuildVolatile picks up the fresh snapshot.
 *
 * Source: §8 Memory, R29-2 (buildVolatileTier), R25-15 (day-precision).
 */
import {
  today,
  type MemoryEntry,
  type MemoryHit,
  type MemoryManager,
  type MemoryQuery,
  type MemoryRoleId,
  type MemorySnapshot,
} from "@my-agent/core";
import { InMemoryBackend, type MemoryBackend } from "./backends.js";

export class MemoryManagerImpl implements MemoryManager {
  private byRole = new Map<MemoryRoleId, MemoryBackend>();
  private cached: MemorySnapshot = { entries: [], generatedDay: today() };

  /** Register a backend for a role. One backend per role (SSOT). */
  register(backend: MemoryBackend): void {
    if (this.byRole.has(backend.role)) {
      throw new Error(`memory backend already registered for role: ${backend.role}`);
    }
    this.byRole.set(backend.role, backend);
  }

  /** Ensure every role has a backend (default: InMemoryBackend). */
  ensureDefault(roles: readonly MemoryRoleId[]): void {
    for (const r of roles) {
      if (!this.byRole.has(r)) this.byRole.set(r, new InMemoryBackend(r));
    }
  }

  /** SYNC snapshot (§5 contract) — returns the cached snapshot. */
  snapshot(): MemorySnapshot {
    return this.cached;
  }

  /** Refresh the cached snapshot from all backends. Call when memory changes. */
  async refresh(): Promise<void> {
    const entries: MemoryHit[] = [];
    for (const backend of this.byRole.values()) {
      entries.push(...(await backend.read({ text: "", topK: 5 })));
    }
    this.cached = { entries, generatedDay: today() };
  }

  /** Query a specific role (or fan out to all). */
  async query(q: MemoryQuery): Promise<MemoryHit[]> {
    if (q.role) {
      const backend = this.byRole.get(q.role);
      return backend ? backend.read(q) : [];
    }
    const all: MemoryHit[] = [];
    for (const backend of this.byRole.values()) {
      all.push(...(await backend.read(q)));
    }
    return all.slice(0, q.topK ?? 10);
  }

  /** Write an entry to its role's backend, then refresh the snapshot. */
  async write(entry: MemoryEntry): Promise<void> {
    const backend = this.byRole.get(entry.role);
    if (backend) {
      await backend.write(entry);
      await this.refresh();
    }
  }

  /** Build a MemoryManager with all-default in-memory backends (Tier 1 default). */
  static withDefaults(): MemoryManagerImpl {
    const m = new MemoryManagerImpl();
    m.ensureDefault(["working", "archivist", "tree", "diff", "goals", "sync"]);
    return m;
  }
}

/** A no-op stub manager (the Tier-0 default; returns empty snapshot). */
export function stubMemoryManager(): MemoryManager {
  return {
    snapshot: () => ({ entries: [], generatedDay: today() }),
    query: async () => [],
  };
}

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
  nowWallclock,
  type MemoryEntry,
  type MemoryHit,
  type MemoryManager,
  type MemoryQuery,
  type MemoryRoleId,
  type MemorySnapshot,
} from "@my-agent/core";
import { InMemoryBackend, type MemoryBackend } from "./backends.js";
import type { MemoryRole } from "./roles.js";

export class MemoryManagerImpl implements MemoryManager {
  private byRole = new Map<MemoryRoleId, MemoryBackend>();
  private readonly rolesList: MemoryRole[] = [];
  private cached: MemorySnapshot = { entries: [], generatedDay: today() };
  /** §8 CC4: drainLock blocks prefetchAll while a syncAll drain is in flight. */
  private drainInFlight = false;
  private externalCount = 0;

  /** The registered lifecycle roles (§8 R27-4). */
  get roles(): MemoryRole[] { return this.rolesList; }

  /** The registered backends (§8 R27-4). */
  get backends(): MemoryBackend[] { return [...this.byRole.values()]; }

  /** Register a backend for a role. One backend per role (SSOT). §8 one-external-
   * provider rule: refuses a 2nd EXTERNAL backend (governs MemoryBackend only). */
  register(backend: MemoryBackend): void {
    if (this.byRole.has(backend.role)) {
      throw new Error(`memory backend already registered for role: ${backend.role}`);
    }
    if (backend.external) {
      if (this.externalCount >= 1) {
        throw new Error(`memory: one-external-provider rule violated (2nd external backend for ${backend.role})`);
      }
      this.externalCount++;
    }
    this.byRole.set(backend.role, backend);
  }

  /** Register a lifecycle role (§8 R27-4). */
  addRole(role: MemoryRole): void {
    this.rolesList.push(role);
  }

  /** §8: drive every role's prefetch for the upcoming turn. Blocks on drainLock
   * if a syncAll drain is in flight (CC4 — no prefetch races a draining shutdown). */
  async prefetchAll(ctx: import("@my-agent/core").TurnContext): Promise<void> {
    while (this.drainInFlight) await Promise.resolve();
    await Promise.all(this.rolesList.map((r) =>
      r.prefetch(this.byRole.get(r.id as MemoryRoleId) ?? new InMemoryBackend(r.id as MemoryRoleId), { text: "" }),
    ));
  }

  /** §8 R27-18: bounded shutdown drain — drive every role's syncTurn, bounded by
   * deadlineS. Returns completed/timedOut accounting. */
  async syncAll(ctx?: import("@my-agent/core").TurnContext, deadlineS = 5): Promise<{ completed: number; timedOut: number }> {
    this.drainInFlight = true;
    const deadline = nowWallclock() + deadlineS * 1000;
    let completed = 0;
    let timedOut = 0;
    const effectiveCtx = ctx ?? ({} as import("@my-agent/core").TurnContext);
    try {
      await Promise.all(this.rolesList.map(async (r) => {
        const store = this.byRole.get(r.id as MemoryRoleId) ?? new InMemoryBackend(r.id as MemoryRoleId);
        try {
          const p = r.syncTurn(store, effectiveCtx);
          p.catch(() => {}); // swallow late rejection if timeout wins (review M3)
          await Promise.race([
            p,
            new Promise((_, rej) => setTimeout(() => rej(new Error("drain-timeout")), Math.max(0, deadline - nowWallclock()))),
          ]);
          completed++;
        } catch {
          timedOut++;
        }
      }));
    } finally {
      this.drainInFlight = false;
    }
    return { completed, timedOut };
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

/**
 * MemoryManager (§8) — aggregates per-role backends; serves snapshot() + query().
 *
 * snapshot() is SYNC (returns a cached snapshot) because the §5 prompt assembler
 * calls it synchronously at tier boundaries. The cache is refreshed ASYNC via
 * refresh() — the loop/transport calls refresh() when memory changes, then the
 * next assemblePrompt/rebuildVolatile picks up the fresh snapshot.
 *
 * Phase A (Gaps 1-3): MemoryManager now ALSO integrates Brain + DreamCycle and
 * serves as the single front door (`record` / `recall` / `consolidate`). All
 * new entry points are no-op-compatible with the existing 0-arg ctor — see
 * D4 in source/.learned/GAP-IMPLEMENTATION-PLAN.md Stage 0.
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
import type { Brain, Fact } from "./brain.js";
import type { DreamCycle, DreamResult } from "./dream-cycle.js";
import type { ConsolidationReport, MemoryDomain, MemoryDomainEntry, MemoryDomainOpts } from "./domains/types.js";
import { BrainStore } from "./brain-store.js";
import type { Tier } from "./tree.js";

export interface MemoryManagerCtorOptions {
  brain?: Brain;
  dreamCycle?: DreamCycle;
  domains?: readonly MemoryDomain[];
}

/** Phase A facade interface for the new front-door methods. */
export interface MemoryFacade {
  /** Record a fact through Brain + notify every domain. */
  record(fact: Omit<Fact, "id" | "createdAt"> & { id?: string; tier?: "L0" | "L1" | "L2"; validUntil?: number }): Fact;
  /** Fan-out recall across every domain. */
  recall(query: string, opts?: MemoryDomainOpts): MemoryDomainEntry[];
  /** Drive the dream cycle. */
  consolidate(): Promise<DreamResult | { takesPromoted: number; factsConsumed: number; consolidation: ConsolidationReport[] }>;
}

export class MemoryManagerImpl implements MemoryManager {
  private byRole = new Map<MemoryRoleId, MemoryBackend>();
  private readonly rolesList: MemoryRole[] = [];
  private cached: MemorySnapshot = { entries: [], generatedDay: today() };
  /** §8 CC4: drainLock blocks prefetchAll while a syncAll drain is in flight. */
  private drainInFlight = false;
  private externalCount = 0;

  /** Phase A: Brain (fact store) — undefined unless `withBrain()` or new ctor opts were used. */
  private brain: Brain | undefined;
  /** Phase A: DreamCycle — undefined unless `withBrain()` was used. */
  private dreamCycle: DreamCycle | undefined;
  /** Phase A: List of MemoryDomains wired by `init()` then `onRecord()`/`recall`/`onConsolidate`. */
  private readonly domains: MemoryDomain[] = [];
  /** Phase A: When true, domains have been init()-ed with brain. Idempotent. */
  private domainsInited = false;
  /** Tier-3: Full-fidelity Brain persistence (facts + takes + pages + tier labels). */
  private brainStore: BrainStore | undefined;

  constructor(opts: MemoryManagerCtorOptions = {}) {
    this.brain = opts.brain;
    this.dreamCycle = opts.dreamCycle;
    if (opts.domains) {
      for (const d of opts.domains) this.domains.push(d);
    }
  }

  /** The registered lifecycle roles (§8 R27-4). */
  get roles(): MemoryRole[] { return this.rolesList; }

  /** The registered backends (§8 R27-4). */
  get backends(): MemoryBackend[] { return [...this.byRole.values()]; }

  /** Phase A: expose the wired Brain (read-only — undefined when not wired). */
  get wrappedBrain(): Brain | undefined { return this.brain; }
  /** Phase A: expose the wired DreamCycle (undefined when not wired). */
  get wrappedDreamCycle(): DreamCycle | undefined { return this.dreamCycle; }
  /** Phase A: list of registered MemoryDomains (snapshot — do not mutate). */
  get registeredDomains(): readonly MemoryDomain[] { return [...this.domains]; }

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

  // ── Phase A: facade methods (Brain + DreamCycle + Domains) ─────────────────

  /** Lazy-init domains against the wired Brain (idempotent). */
  private ensureDomainsInited(): void {
    if (this.domainsInited) return;
    if (!this.brain) return;
    for (const d of this.domains) d.init(this.brain);
    this.domainsInited = true;
  }

  /** Phase A: Record a fact through Brain + notify every domain. Throws when no
   * Brain is wired — callers must use `withBrain()` or pass `brain` via ctor
   * opts. */
  record(
    fact: Omit<Fact, "id" | "createdAt"> & { id?: string; tier?: "L0" | "L1" | "L2"; validUntil?: number },
  ): Fact {
    if (!this.brain) throw new Error("memory.record: no Brain wired (use withBrain() or ctor opts.brain)");
    this.ensureDomainsInited();
    // C1 fix: preserve validUntil (Fact field for TTL), strip only tier (tree-only metadata)
    const { tier: _tier, ...factRest } = fact;
    // Assign default 24h TTL for L0 facts (no explicit validUntil).
    const isL0 = !_tier || _tier === "L0";
    const now = nowWallclock();
    const withTtl = isL0 && fact.validUntil === undefined
      ? { ...factRest, validUntil: now + 86_400_000 }
      : factRest;
    const persisted = this.brain.recordFact(withTtl as Omit<Fact, "id" | "createdAt"> & { id?: string });
    for (const d of this.domains) d.onRecord(persisted);
    // Persist to BrainStore (full-fidelity: all Fact fields + tier label).
    if (this.brainStore) {
      void this.brainStore.persistFact(persisted, _tier ?? "L0");
    }
    return persisted;
  }

  /** Phase A: Fan-out recall across every domain. Returns one slice per domain. */
  recall(query: string, opts?: MemoryDomainOpts): MemoryDomainEntry[] {
    if (this.domains.length === 0) return [];
    this.ensureDomainsInited();
    return this.domains.map((d) => ({
      domain: d.name,
      hits: d.recall(query, opts),
    }));
  }

  /** Phase A: Drive the full consolidation lifecycle. Always runs domain
   * onConsolidate (purge + promote + reconcile), then optionally summarizes
   * via DreamCycle if wired. This fixes the double-consolidation bug (manager
   * no longer calls brain.consolidate() directly — treeDomain does it via
   * promote()) and ensures DreamCycle-wired managers still get domain lifecycle. */
  async consolidate(): Promise<DreamResult | { takesPromoted: number; factsConsumed: number; consolidation: ConsolidationReport[] }> {
    if (!this.brain) return { takesPromoted: 0, factsConsumed: 0, consolidation: [] };
    this.ensureDomainsInited();
    const now = nowWallclock();
    const consolidation: ConsolidationReport[] = [];
    // Phase 1: Domain lifecycle — archivist purges first, tree promotes second.
    for (const d of this.domains) consolidation.push(d.onConsolidate(now));
    // Phase 1b: Persist any newly-created Takes + updated Facts to BrainStore.
    // This ensures consolidated state survives restart.
    // Finding 2: skip when durable — SqliteBrainStore writes through on every
    // putFact/putTake (lifecycle.ts C-GATE-2 uses the same !isDurable gate).
    if (this.brainStore && !this.brain.isDurable) {
      const takes = this.brain.takes;
      if (takes.length > 0) {
        void this.brainStore.persistTakes(takes, "L1");
      }
      // Persist facts that were just consolidated (they got consolidatedAt set)
      for (const f of this.brain.allFacts.values()) {
        if (f.consolidatedAt !== undefined) {
          void this.brainStore.persistFact(f, "L1");
        }
      }
    }
    // Phase 2: Summarize via DreamCycle (if wired) — runs AFTER lifecycle.
    if (this.dreamCycle) {
      const dream = await this.dreamCycle.dream();
      return { ...dream, consolidation };
    }
    const takesPromoted = consolidation.reduce((s, r) => s + r.promoted, 0);
    const factsConsumed = consolidation.reduce((s, r) => s + r.consumed, 0);
    return { takesPromoted, factsConsumed, consolidation };
  }

  /** SYNC snapshot (§5 contract) — returns the cached snapshot. */
  snapshot(): MemorySnapshot {
    return this.cached;
  }

  /** Refresh the cached snapshot from all backends. Call when memory changes.
   * Backends are read in parallel (P0-perf: serial was 6 round-trips per turn
   * for the default 6-role setup). */
  async refresh(): Promise<void> {
    const all = await Promise.all(
      [...this.byRole.values()].map((b) => b.read({ text: "", topK: 5 })),
    );
    const entries: MemoryHit[] = [];
    for (const hits of all) entries.push(...hits);
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

  /** Phase A: factory that wires Brain + DreamCycle + Domains into the manager.
   * Existing call sites (agent loop / print bridge) keep using `withDefaults()`;
   * new wiring uses `withBrain()`. See D4 in
   * source/.learned/GAP-IMPLEMENTATION-PLAN.md Stage 0. */
  static withBrain(opts: {
    brain: Brain;
    dreamCycle?: DreamCycle;
    domains?: readonly MemoryDomain[];
    roleBackends?: readonly MemoryBackend[];
    defaultRoles?: readonly MemoryRoleId[];
    /** Tier-3: directory for BrainStore persistence (enables cross-session L1/L2). */
    persistenceDir?: string;
  }): MemoryManagerImpl {
    const m = new MemoryManagerImpl({ brain: opts.brain, dreamCycle: opts.dreamCycle, domains: opts.domains });
    for (const b of opts.roleBackends ?? []) m.register(b);
    m.ensureDefault(opts.defaultRoles ?? ["working", "archivist", "tree", "diff", "goals", "sync"]);
    // Tier-3: wire BrainStore for full-fidelity persistence of all tiers.
    // C-GATE-4 (Finding 2): skip JSONL BrainStore when Brain is durable —
    // SqliteBrainStore is its own durable store, and loadFromBrainStore would
    // clobber SQLite (deleteAll + rewrite from stale/empty JSONL).
    if (opts.persistenceDir && !opts.brain.isDurable) {
      m.brainStore = new BrainStore(opts.persistenceDir);
      void m.loadFromBrainStore();
    }
    return m;
  }

  /** Load persisted facts + takes + pages from BrainStore and re-hydrate Brain.
   * Full-fidelity: restores ALL fields including consolidatedAt, tier labels, etc. */
  private async loadFromBrainStore(): Promise<void> {
    if (!this.brain || !this.brainStore) return;
    try {
      const snapshot = await this.brainStore.load();
      // Phase A: delegate to Brain's public loadFromSnapshot() (storage seam).
      // The BrainSnapshot Maps are converted to iterables (Map.values()/entries()).
      this.brain.loadFromSnapshot({
        facts: snapshot.facts.values(),
        takes: snapshot.takes.values(),
        pages: snapshot.pages.values(),
        tombstones: snapshot.tombstones.entries(),
      });
    } catch {
      // Corrupt or missing file — start fresh
    }
  }
}

/** A no-op stub manager (the Tier-0 default; returns empty snapshot). */
export function stubMemoryManager(): MemoryManager {
  return {
    snapshot: () => ({ entries: [], generatedDay: today() }),
    query: async () => [],
  };
}

/**
 * @my-agent/memory/brain-storage — Storage seam for Brain's state (Dig 3 Phase A).
 *
 * Two implementations:
 * - InMemoryBrainStorage: current behavior (4 Maps), backward-compat.
 * - SqliteBrainStore (Phase B): write-through cache + SQLite WAL (durable).
 *
 * Design constraints:
 * - allFacts() / allTakes() / allPages() / allTombstones() return LIVE iterators
 *   over internal Map values (NOT copies). Brain's embed() and consolidate()
 *   mutate facts in-place via the iterator; a defensive copy would break this.
 * - Methods are SYNCHRONOUS to match current Map semantics. Brain's analysis
 *   phases are all sync; adding async would ripple through 700+ tests.
 *   SqliteBrainStore (Phase B) achieves sync semantics via WAL mode (~1ms writes).
 */
import type { Fact, Take, BrainPage } from "./brain.js";

export interface BrainStorage {
  // ── Facts ──
  getFact(id: string): Fact | undefined;
  putFact(fact: Fact): void;
  deleteFact(id: string): boolean;
  allFacts(): IterableIterator<Fact>;
  /** Count of live (non-tombstoned) facts. */
  readonly factCount: number;
  /** Live internal fact map (for Brain's public `allFacts` getter which returns
   * ReadonlyMap<string, Fact> — used by lifecycle.ts, manager.ts, 10+ tests).
   * SqliteBrainStore (Phase B) returns its in-memory cache map. */
  getFactMap(): ReadonlyMap<string, Fact>;

  // ── Takes ──
  getTake(id: string): Take | undefined;
  putTake(take: Take): void;
  allTakes(): IterableIterator<Take>;
  readonly takeCount: number;

  // ── Pages ──
  getPage(id: string): BrainPage | undefined;
  putPage(page: BrainPage): void;
  allPages(): IterableIterator<BrainPage>;

  // ── Tombstones (soft-delete with 72h recovery window) ──
  putTombstone(id: string, entry: { fact: Fact; deletedAt: number }): void;
  getTombstone(id: string): { fact: Fact; deletedAt: number } | undefined;
  deleteTombstone(id: string): boolean;
  allTombstones(): IterableIterator<[string, { fact: Fact; deletedAt: number }]>;
  readonly tombstoneCount: number;

  // ── Bulk hydration (for manager.loadFromBrainStore / SQLite load) ──
  loadFromSnapshot(snapshot: {
    facts: Iterable<Fact>;
    takes: Iterable<Take>;
    pages: Iterable<BrainPage>;
    tombstones: Iterable<[string, { fact: Fact; deletedAt: number }]>;
  }): void;
}

/**
 * Default implementation — exact behavioral replacement for Brain's current
 * 4 Maps. All existing tests pass with ZERO behavior change.
 */
export class InMemoryBrainStorage implements BrainStorage {
  private readonly facts = new Map<string, Fact>();
  private readonly takes = new Map<string, Take>();
  private readonly pages = new Map<string, BrainPage>();
  private readonly tombstones = new Map<string, { fact: Fact; deletedAt: number }>();

  getFact(id: string): Fact | undefined { return this.facts.get(id); }
  putFact(fact: Fact): void { this.facts.set(fact.id, fact); }
  deleteFact(id: string): boolean { return this.facts.delete(id); }
  allFacts(): IterableIterator<Fact> { return this.facts.values(); }
  get factCount(): number { return this.facts.size; }
  getFactMap(): ReadonlyMap<string, Fact> { return this.facts; }

  getTake(id: string): Take | undefined { return this.takes.get(id); }
  putTake(take: Take): void { this.takes.set(take.id, take); }
  allTakes(): IterableIterator<Take> { return this.takes.values(); }
  get takeCount(): number { return this.takes.size; }

  getPage(id: string): BrainPage | undefined { return this.pages.get(id); }
  putPage(page: BrainPage): void { this.pages.set(page.id, page); }
  allPages(): IterableIterator<BrainPage> { return this.pages.values(); }

  putTombstone(id: string, entry: { fact: Fact; deletedAt: number }): void { this.tombstones.set(id, entry); }
  getTombstone(id: string): { fact: Fact; deletedAt: number } | undefined { return this.tombstones.get(id); }
  deleteTombstone(id: string): boolean { return this.tombstones.delete(id); }
  allTombstones(): IterableIterator<[string, { fact: Fact; deletedAt: number }]> { return this.tombstones.entries(); }
  get tombstoneCount(): number { return this.tombstones.size; }

  loadFromSnapshot(snapshot: {
    facts: Iterable<Fact>;
    takes: Iterable<Take>;
    pages: Iterable<BrainPage>;
    tombstones: Iterable<[string, { fact: Fact; deletedAt: number }]>;
  }): void {
    this.facts.clear();
    this.takes.clear();
    this.pages.clear();
    this.tombstones.clear();
    for (const f of snapshot.facts) this.facts.set(f.id, f);
    for (const t of snapshot.takes) this.takes.set(t.id, t);
    for (const p of snapshot.pages) this.pages.set(p.id, p);
    for (const [id, ts] of snapshot.tombstones) this.tombstones.set(id, ts);
  }
}

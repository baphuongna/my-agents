/**
 * @my-agent/memory/brain-sqlite-store — Durable write-through BrainStorage (Dig 3 Phase B).
 *
 * Design:
 *   - Wraps an InMemoryBrainStorage as the read cache (sub-ms iteration for
 *     Brain's 10 analysis phases, which iterate ALL facts).
 *   - On every write op (putFact/putTake/putPage/putTombstone/deleteFact/
 *     deleteTombstone/loadFromSnapshot) ALSO writes/deletes to SQLite.
 *   - On construction, hydrates the cache from SQLite (load all brain_* rows).
 *   - All methods are SYNCHRONOUS (better-sqlite3 sync driver + WAL mode).
 *
 * This is OPT-IN: `new Brain()` defaults to InMemoryBrainStorage.
 * Constructed explicitly with a DB path for durable backing.
 */
import type { Fact, Take, BrainPage } from "./brain.js";
import { InMemoryBrainStorage } from "./brain-storage.js";
import type { BrainStorage } from "./brain-storage.js";
import {
  openDB,
  closeDB,
  checkpoint,
  transaction,
  type SqliteDatabase,
  type SqliteStatement,
  type DatabasePath,
} from "./sqlite-db.js";
import { initSchema } from "./sqlite-schema.js";

/** A brain fact row from the brain_facts table. */
interface BrainFactRow {
  id: string;
  kind: string;
  entity: string;
  content: string;
  visibility: string;
  notability: number;
  source: string;
  created_at: number;
  valid_from: number | null;
  valid_until: number | null;
  consolidated_at: number | null;
  consolidated_into: string | null;
  embedded: number;
  access_count: number | null;
  last_accessed_at: number | null;
  strength: number | null;
  hlc_json: string | null;
}

/**
 * Write-through BrainStorage backed by SQLite WAL. Reads are served from the
 * in-memory cache (hydrated on construction); writes update both cache and
 * SQLite so durability survives process restart.
 */
export class SqliteBrainStore implements BrainStorage {
  get durable(): boolean { return true; }
  private readonly db: SqliteDatabase;
  private readonly cache: InMemoryBrainStorage;

  // Prepared statements (created once, reused for performance).
  private readonly stmtUpsertFact: SqliteStatement;
  private readonly stmtDeleteFact: SqliteStatement;
  private readonly stmtUpsertTake: SqliteStatement;
  private readonly stmtUpsertPage: SqliteStatement;
  private readonly stmtUpsertTombstone: SqliteStatement;
  private readonly stmtDeleteTombstone: SqliteStatement;
  private readonly stmtDeleteAllFacts: SqliteStatement;
  private readonly stmtDeleteAllTakes: SqliteStatement;
  private readonly stmtDeleteAllPages: SqliteStatement;
  private readonly stmtDeleteAllTombstones: SqliteStatement;

  constructor(dbPath: DatabasePath) {
    this.db = openDB(dbPath);
    initSchema(this.db); // idempotent — creates brain_* tables if missing

    this.cache = new InMemoryBrainStorage();

    // Prepare all statements once in the constructor.
    this.stmtUpsertFact = this.db.prepare(`
      INSERT OR REPLACE INTO brain_facts
        (id, kind, entity, content, visibility, notability, source, created_at,
         valid_from, valid_until, consolidated_at, consolidated_into, embedded,
         access_count, last_accessed_at, strength, hlc_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.stmtDeleteFact = this.db.prepare("DELETE FROM brain_facts WHERE id = ?");
    this.stmtUpsertTake = this.db.prepare(`
      INSERT OR REPLACE INTO brain_takes (id, entity, text, synthesized_at, sources_json)
      VALUES (?, ?, ?, ?, ?)
    `);
    this.stmtUpsertPage = this.db.prepare(`
      INSERT OR REPLACE INTO brain_pages (id, slug, compiled_truth, source, created_at, version)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    this.stmtUpsertTombstone = this.db.prepare(`
      INSERT OR REPLACE INTO brain_tombstones (id, fact_json, deleted_at)
      VALUES (?, ?, ?)
    `);
    this.stmtDeleteTombstone = this.db.prepare("DELETE FROM brain_tombstones WHERE id = ?");
    this.stmtDeleteAllFacts = this.db.prepare("DELETE FROM brain_facts");
    this.stmtDeleteAllTakes = this.db.prepare("DELETE FROM brain_takes");
    this.stmtDeleteAllPages = this.db.prepare("DELETE FROM brain_pages");
    this.stmtDeleteAllTombstones = this.db.prepare("DELETE FROM brain_tombstones");

    // Hydrate the cache from SQLite.
    this.hydrate();
  }

  // ── Hydration ───────────────────────────────────────────────────────────

  private hydrate(): void {
    const factRows = this.db.prepare("SELECT * FROM brain_facts").all() as unknown as BrainFactRow[];
    for (const row of factRows) {
      this.cache.putFact(this.rowToFact(row));
    }

    const takeRows = this.db.prepare("SELECT * FROM brain_takes").all() as Array<{
      id: string; entity: string; text: string; synthesized_at: number; sources_json: string;
    }>;
    for (const row of takeRows) {
      this.cache.putTake({
        id: row.id,
        entity: row.entity,
        text: row.text,
        synthesizedAt: row.synthesized_at,
        sources: JSON.parse(row.sources_json) as string[],
      });
    }

    const pageRows = this.db.prepare("SELECT * FROM brain_pages").all() as Array<{
      id: string; slug: string; compiled_truth: string; source: string; created_at: number; version: number;
    }>;
    for (const row of pageRows) {
      this.cache.putPage({
        id: row.id,
        slug: row.slug,
        compiledTruth: row.compiled_truth,
        source: row.source,
        createdAt: row.created_at,
        version: row.version,
      });
    }

    const tombRows = this.db.prepare("SELECT * FROM brain_tombstones").all() as Array<{
      id: string; fact_json: string; deleted_at: number;
    }>;
    for (const row of tombRows) {
      this.cache.putTombstone(row.id, {
        fact: JSON.parse(row.fact_json) as Fact,
        deletedAt: row.deleted_at,
      });
    }
  }

  // ── Fact ↔ Row conversion ───────────────────────────────────────────────

  private rowToFact(row: BrainFactRow): Fact {
    const fact: Fact = {
      id: row.id,
      kind: row.kind as Fact["kind"],
      entity: row.entity,
      content: row.content,
      visibility: row.visibility as Fact["visibility"],
      notability: row.notability,
      source: row.source,
      createdAt: row.created_at,
      embedded: row.embedded === 1 ? true : undefined,
    };
    if (row.valid_from !== null) fact.validFrom = row.valid_from;
    if (row.valid_until !== null) fact.validUntil = row.valid_until;
    if (row.consolidated_at !== null) fact.consolidatedAt = row.consolidated_at;
    if (row.consolidated_into !== null) fact.consolidatedInto = row.consolidated_into;
    if (row.access_count !== null) fact.accessCount = row.access_count;
    if (row.last_accessed_at !== null) fact.lastAccessedAt = row.last_accessed_at;
    if (row.strength !== null) fact.strength = row.strength;
    if (row.hlc_json !== null) fact.hlc = JSON.parse(row.hlc_json) as { wall: number; counter: number; node: string };
    return fact;
  }

  /** Convert a Fact to positional parameter array for stmtUpsertFact. */
  private factParams(fact: Fact): unknown[] {
    return [
      fact.id,
      fact.kind,
      fact.entity,
      fact.content,
      fact.visibility,
      fact.notability,
      fact.source,
      fact.createdAt,
      fact.validFrom ?? null,
      fact.validUntil ?? null,
      fact.consolidatedAt ?? null,
      fact.consolidatedInto ?? null,
      fact.embedded ? 1 : 0,
      fact.accessCount ?? null,
      fact.lastAccessedAt ?? null,
      fact.strength ?? null,
      fact.hlc ? JSON.stringify(fact.hlc) : null,
    ];
  }

  // ── Facts ───────────────────────────────────────────────────────────────

  getFact(id: string): Fact | undefined { return this.cache.getFact(id); }

  putFact(fact: Fact): void {
    this.cache.putFact(fact);
    this.stmtUpsertFact.run(...this.factParams(fact));
  }

  deleteFact(id: string): boolean {
    const existed = this.cache.deleteFact(id);
    this.stmtDeleteFact.run(id);
    return existed;
  }

  allFacts(): IterableIterator<Fact> { return this.cache.allFacts(); }

  get factCount(): number { return this.cache.factCount; }

  getFactMap(): ReadonlyMap<string, Fact> { return this.cache.getFactMap(); }

  // ── Takes ───────────────────────────────────────────────────────────────

  getTake(id: string): Take | undefined { return this.cache.getTake(id); }

  putTake(take: Take): void {
    this.cache.putTake(take);
    this.stmtUpsertTake.run(take.id, take.entity, take.text, take.synthesizedAt, JSON.stringify(take.sources));
  }

  allTakes(): IterableIterator<Take> { return this.cache.allTakes(); }

  get takeCount(): number { return this.cache.takeCount; }

  // ── Pages ───────────────────────────────────────────────────────────────

  getPage(id: string): BrainPage | undefined { return this.cache.getPage(id); }

  putPage(page: BrainPage): void {
    this.cache.putPage(page);
    this.stmtUpsertPage.run(page.id, page.slug, page.compiledTruth, page.source, page.createdAt, page.version);
  }

  allPages(): IterableIterator<BrainPage> { return this.cache.allPages(); }

  // ── Tombstones ──────────────────────────────────────────────────────────

  putTombstone(id: string, entry: { fact: Fact; deletedAt: number }): void {
    this.cache.putTombstone(id, entry);
    this.stmtUpsertTombstone.run(id, JSON.stringify(entry.fact), entry.deletedAt);
  }

  getTombstone(id: string): { fact: Fact; deletedAt: number } | undefined {
    return this.cache.getTombstone(id);
  }

  deleteTombstone(id: string): boolean {
    const existed = this.cache.deleteTombstone(id);
    this.stmtDeleteTombstone.run(id);
    return existed;
  }

  allTombstones(): IterableIterator<[string, { fact: Fact; deletedAt: number }]> {
    return this.cache.allTombstones();
  }

  get tombstoneCount(): number { return this.cache.tombstoneCount; }

  // ── Bulk hydration ──────────────────────────────────────────────────────

  loadFromSnapshot(snapshot: {
    facts: Iterable<Fact>;
    takes: Iterable<Take>;
    pages: Iterable<BrainPage>;
    tombstones: Iterable<[string, { fact: Fact; deletedAt: number }]>;
  }): void {
    // Collect snapshot data first (it's an iterable — consume once).
    const facts = [...snapshot.facts];
    const takes = [...snapshot.takes];
    const pages = [...snapshot.pages];
    const tombstones = [...snapshot.tombstones];

    // Update cache + SQLite atomically in a single transaction.
    transaction(this.db, () => {
      this.cache.loadFromSnapshot({
        facts,
        takes,
        pages,
        tombstones,
      });

      // Clear SQLite tables and rewrite from the snapshot.
      this.stmtDeleteAllFacts.run();
      this.stmtDeleteAllTakes.run();
      this.stmtDeleteAllPages.run();
      this.stmtDeleteAllTombstones.run();

      for (const f of facts) this.stmtUpsertFact.run(...this.factParams(f));
      for (const t of takes) {
        this.stmtUpsertTake.run(t.id, t.entity, t.text, t.synthesizedAt, JSON.stringify(t.sources));
      }
      for (const p of pages) {
        this.stmtUpsertPage.run(p.id, p.slug, p.compiledTruth, p.source, p.createdAt, p.version);
      }
      for (const [id, ts] of tombstones) {
        this.stmtUpsertTombstone.run(id, JSON.stringify(ts.fact), ts.deletedAt);
      }
    });
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────

  /** Checkpoint WAL + close the database. Call on shutdown for durability. */
  close(): void {
    checkpoint(this.db);
    closeDB(this.db);
  }
}

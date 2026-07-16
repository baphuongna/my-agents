/**
 * @my-agent/memory/sqlite-manager — Unified memory manager (mnemopi pattern).
 *
 * SQLite IS the store. This is a thin wrapper that exposes the full memory
 * API: record, recall, consolidate, lifecycle.
 *
 * Replaces the old MemoryManagerImpl + Brain + MemoryTree + 13 domains.
 */
// DatabaseSync type — use any to avoid node:sqlite import at module eval time
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DatabaseSync = any;
import { openDB, closeDB, checkpoint, type DatabasePath } from "./sqlite-db.js";
import { initSchema } from "./sqlite-schema.js";
import {
  storeWorking, storeEpisodic, storeFact,
  type WorkingMemoryInput, type EpisodicMemoryInput, type FactInput,
} from "./sqlite-store.js";
import { recall, recallFacts, type RecallOptions, type MemoryHit } from "./sqlite-recall.js";
import { lifecycleTick, type ConsolidateResult, type DegradeResult, type PurgeResult } from "./sqlite-consolidate.js";

export interface SqliteMemoryManagerOptions {
  dbPath: DatabasePath;
}

export interface LifecycleResult {
  consolidated: ConsolidateResult;
  degraded: DegradeResult;
  purged: PurgeResult;
}

/**
 * Unified memory manager. SQLite IS the store.
 *
 * Usage:
 *   const mgr = new SqliteMemoryManager({ dbPath: "~/.mya/memory/memory.db" });
 *   mgr.record({ content: "Alice loves TypeScript", source: "user" });
 *   const hits = mgr.recall("What does Alice like?");
 *   mgr.lifecycle(); // consolidate + degrade + purge
 *   mgr.close();
 */
export class SqliteMemoryManager {
  private db: DatabaseSync;

  constructor(opts: SqliteMemoryManagerOptions) {
    this.db = openDB(opts.dbPath);
    initSchema(this.db);
  }

  /** Record a working memory (L0). */
  record(input: WorkingMemoryInput): string {
    return storeWorking(this.db, input);
  }

  /** Record an episodic memory (L1) — usually from consolidation. */
  recordEpisodic(input: EpisodicMemoryInput): string {
    return storeEpisodic(this.db, input);
  }

  /** Record a structured fact (L2). */
  recordFact(input: FactInput): string {
    return storeFact(this.db, input);
  }

  /** Recall memories matching a query (FTS5 BM25 + Weibull + veracity). */
  recall(query: string, options?: RecallOptions): MemoryHit[] {
    return recall(this.db, query, options);
  }

  /** Recall structured facts (L2). */
  recallFacts(query: string, options?: { topK?: number }): Array<{
    fact_id: string; subject: string; predicate: string; object: string; score: number;
  }> {
    return recallFacts(this.db, query, options);
  }

  /** Run lifecycle: consolidate + degrade + purge. */
  lifecycle(sessionId?: string): LifecycleResult {
    return lifecycleTick(this.db, sessionId);
  }

  /** Get the underlying database (for advanced operations). */
  getDatabase(): DatabaseSync {
    return this.db;
  }

  /** Close the database (WAL checkpoint + close). */
  close(): void {
    checkpoint(this.db);
    closeDB(this.db);
  }
}
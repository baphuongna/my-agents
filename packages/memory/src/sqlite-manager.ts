/**
 * @my-agent/memory/sqlite-manager — Unified memory manager (mnemopi pattern).
 *
 * SQLite IS the store. This is a thin wrapper that exposes the full memory
 * API: record, recall, consolidate, lifecycle.
 *
 * Replaces the old MemoryManagerImpl + Brain + MemoryTree + 13 domains.
 */
import type { SqliteDatabase } from "./sqlite-db.js";
import { openDB, closeDB, checkpoint, type DatabasePath } from "./sqlite-db.js";
import { initSchema } from "./sqlite-schema.js";
import {
  storeWorking, storeEpisodic, storeFact,
  type WorkingMemoryInput, type EpisodicMemoryInput, type FactInput,
} from "./sqlite-store.js";
import { recall, recallFacts, type RecallOptions, type MemoryHit } from "./sqlite-recall.js";
import { lifecycleTick, type ConsolidateResult, type DegradeResult, type PurgeResult } from "./sqlite-consolidate.js";
import { checkAndResolveConflicts } from "./conflict.js";
import type { MemoryStore } from "./ports.js";

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
export class SqliteMemoryManager implements MemoryStore {
  private db: SqliteDatabase;

  constructor(opts: SqliteMemoryManagerOptions) {
    this.db = openDB(opts.dbPath);
    initSchema(this.db);
  }

  /** Record a working memory (L0). */
  record(input: WorkingMemoryInput): string {
    const id = storeWorking(this.db, input);
    // Phase 2+3: detect + supersede conflicting brain memories IN THE SAME SCOPE.
    // Scope-aware: a role memory only supersedes same-role; no cross-role leak.
    // Best-effort — never break the write.
    try {
      checkAndResolveConflicts(this.db, id, input.content, input.memoryType, {
        scope: input.scope, agentId: input.agentId, sessionId: input.sessionId,
      });
    } catch (err) {
      console.warn(`[memory] checkAndResolveConflicts failed for ${id}:`, err);
    }
    return id;
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

  /** Check if a memory with this content hash already exists (dedup). */
  findByHash(hash: string): boolean {
    const row = this.db.prepare(
      `SELECT 1 FROM working_memory WHERE metadata_json LIKE ? LIMIT 1`
    ).get(`%"captureHash":"${hash}"%`);
    return row !== undefined;
  }

  /** Get the underlying database (for advanced operations). */
  getDatabase(): SqliteDatabase {
    return this.db;
  }

  /** Close the database (WAL checkpoint + close). */
  close(): void {
    checkpoint(this.db);
    closeDB(this.db);
  }
}
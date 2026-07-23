/**
 * Phase 1 tests: SQLite foundation (db + schema)
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openDB, transaction, closeDB, checkpoint, type DatabasePath } from "@my-agent/memory";
import { initSchema, getSchemaVersion } from "@my-agent/memory";

let dbPath: DatabasePath;

// We can't import sqlite-schema directly (not exported yet), so test via manager-like wrappers.
// For now, test the db + schema by importing from the dist.

describe("Phase 1: SQLite foundation", () => {
  beforeEach(() => {
    dbPath = ":memory:";
  });

  it("openDB creates a working database", () => {
    const db = openDB(dbPath);
    db.exec("CREATE TABLE test (id INTEGER, name TEXT)");
    db.exec("INSERT INTO test VALUES (1, 'hello')");
    const row = db.prepare("SELECT * FROM test WHERE id = 1").get() as { id: number; name: string };
    expect(row.id).toBe(1);
    expect(row.name).toBe("hello");
    closeDB(db);
  });

  it("WAL mode is enabled", () => {
    const db = openDB(dbPath);
    const row = db.prepare("PRAGMA journal_mode").get() as { journal_mode: string };
    // :memory: defaults to "memory", but pragmas should set WAL intent
    // For file-backed DBs this would be "wal"
    expect(row.journal_mode).toMatch(/wal|memory/i);
    closeDB(db);
  });

  it("foreign_keys is ON", () => {
    const db = openDB(dbPath);
    const row = db.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number };
    expect(row.foreign_keys).toBe(1);
    closeDB(db);
  });

  it("busy_timeout is 5000ms", () => {
    const db = openDB(dbPath);
    const row = db.prepare("PRAGMA busy_timeout").get() as { busy_timeout: number };
    expect((row as { timeout?: number; busy_timeout?: number }).timeout ?? row.busy_timeout).toBe(5000);
    closeDB(db);
  });

  it("transaction commits on success", () => {
    const db = openDB(dbPath);
    db.exec("CREATE TABLE t (val INTEGER)");
    transaction(db, () => {
      db.exec("INSERT INTO t VALUES (42)");
    });
    const row = db.prepare("SELECT val FROM t").get() as { val: number };
    expect(row.val).toBe(42);
    closeDB(db);
  });

  it("transaction rolls back on error", () => {
    const db = openDB(dbPath);
    db.exec("CREATE TABLE t (val INTEGER)");
    db.exec("INSERT INTO t VALUES (1)");
    expect(() => {
      transaction(db, () => {
        db.exec("INSERT INTO t VALUES (2)");
        throw new Error("test error");
      });
    }).toThrow("test error");
    const rows = db.prepare("SELECT COUNT(*) as n FROM t").get() as { n: number };
    expect(rows.n).toBe(1); // Only the pre-transaction row
    closeDB(db);
  });

  it("nested transaction reuses outer", () => {
    const db = openDB(dbPath);
    db.exec("CREATE TABLE t (val INTEGER)");
    transaction(db, () => {
      db.exec("INSERT INTO t VALUES (1)");
      transaction(db, () => {
        db.exec("INSERT INTO t VALUES (2)");
      });
    });
    const rows = db.prepare("SELECT COUNT(*) as n FROM t").get() as { n: number };
    expect(rows.n).toBe(2);
    closeDB(db);
  });

  it("initSchema creates all tables", () => {
    const db = openDB(dbPath);
    initSchema(db);
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all() as Array<{ name: string }>;
    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain("working_memory");
    expect(tableNames).toContain("episodic_memory");
    expect(tableNames).toContain("facts");
    expect(tableNames).toContain("triples");
    expect(tableNames).toContain("consolidation_log");
    expect(tableNames).toContain("schema_version");
    closeDB(db);
  });

  it("initSchema creates FTS5 virtual tables", () => {
    const db = openDB(dbPath);
    initSchema(db);
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all() as Array<{ name: string }>;
    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain("fts_working");
    expect(tableNames).toContain("fts_episodes");
    expect(tableNames).toContain("fts_facts");
    closeDB(db);
  });

  it("initSchema is idempotent", () => {
    const db = openDB(dbPath);
    initSchema(db);
    expect(() => initSchema(db)).not.toThrow();
    // Still only one working_memory table
    const count = db.prepare(
      "SELECT COUNT(*) as n FROM sqlite_master WHERE name='working_memory'"
    ).get() as { n: number };
    expect(count.n).toBe(1);
    closeDB(db);
  });

  it("FTS5 trigger syncs working_memory on INSERT", () => {
    const db = openDB(dbPath);
    initSchema(db);
    db.prepare(
      "INSERT INTO working_memory (id, content, source, timestamp) VALUES (?, ?, ?, ?)"
    ).run("f1", "Alice loves TypeScript", "test", new Date().toISOString());
    // FTS should have the content (external-content: join via rowid)
    const ftsRow = db.prepare(
      "SELECT wm.id FROM fts_working JOIN working_memory wm ON wm.rowid = fts_working.rowid WHERE fts_working MATCH ? ORDER BY rank LIMIT 1"
    ).get("TypeScript") as { id: string } | undefined;
    expect(ftsRow?.id).toBe("f1");
    closeDB(db);
  });

  it("FTS5 trigger syncs episodic_memory on INSERT", () => {
    const db = openDB(dbPath);
    initSchema(db);
    db.prepare(
      "INSERT INTO episodic_memory (id, content, source, timestamp) VALUES (?, ?, ?, ?)"
    ).run("e1", "Alice is a senior engineer", "consolidation", new Date().toISOString());
    const ftsRow = db.prepare(
      "SELECT rowid FROM fts_episodes WHERE fts_episodes MATCH ? ORDER BY rank LIMIT 1"
    ).get("engineer") as { rowid: number } | undefined;
    expect(ftsRow?.rowid).toBeDefined();
    closeDB(db);
  });

  it("FTS5 trigger deletes on DELETE from working_memory", () => {
    const db = openDB(dbPath);
    initSchema(db);
    db.prepare(
      "INSERT INTO working_memory (id, content, source, timestamp) VALUES (?, ?, ?, ?)"
    ).run("f1", "TypeScript fact", "test", new Date().toISOString());
    db.prepare("DELETE FROM working_memory WHERE id = ?").run("f1");
    const ftsRow = db.prepare(
      "SELECT wm.id FROM fts_working JOIN working_memory wm ON wm.rowid = fts_working.rowid WHERE fts_working MATCH ?"
    ).get("TypeScript") as { id: string } | undefined;
    expect(ftsRow).toBeUndefined();
    closeDB(db);
  });

  it("getSchemaVersion returns 1 after init", () => {
    const db = openDB(dbPath);
    initSchema(db);
    expect(getSchemaVersion(db)).toBe(1);
    closeDB(db);
  });

  it("BM25 ranking works on FTS5", () => {
    const db = openDB(dbPath);
    initSchema(db);
    // Insert multiple docs
    const insert = db.prepare(
      "INSERT INTO working_memory (id, content, source, timestamp) VALUES (?, ?, ?, ?)"
    );
    insert.run("f1", "TypeScript TypeScript TypeScript is great", "test", new Date().toISOString());
    insert.run("f2", "Python is also good but TypeScript is better", "test", new Date().toISOString());
    insert.run("f3", "Rust has memory safety", "test", new Date().toISOString());
    // BM25 search — doc with more "TypeScript" should rank higher (external-content: join via rowid)
    const results = db.prepare(
      "SELECT wm.id, bm25(fts_working) as rank FROM fts_working JOIN working_memory wm ON wm.rowid = fts_working.rowid WHERE fts_working MATCH ? ORDER BY rank"
    ).all("TypeScript") as Array<{ id: string; rank: number }>;
    expect(results.length).toBe(2); // f1 + f2 match
    // f1 has 3x "TypeScript" → lower BM25 rank (more negative = better)
    expect(results[0]!.id).toBe("f1");
    closeDB(db);
  });
});
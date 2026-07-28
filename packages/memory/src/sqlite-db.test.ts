/**
 * @my-agent/memory/sqlite-db — comprehensive edge-case tests for low-level ops.
 *
 * Complements phase1-sqlite.test.ts (schema + pragmas) and fts-repair.test.ts
 * (repair/probe) by exercising the sqlite-db surface directly: null-safety,
 * return-value propagation, reentrant-transaction depth tracking, checkpoint
 * idempotency, and file-backed lifecycle.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync, existsSync, statSync } from "node:fs";
import {
  openDB,
  transaction,
  closeDB,
  checkpoint,
  repairStaleIndexes,
  probeFts5Health,
  type DatabasePath,
  type SqliteDatabase,
} from "./sqlite-db.js";

let db!: SqliteDatabase;
let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "mya-sqlite-db-"));
});

afterEach(() => {
  closeDB(db);
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
});

// ── openDB ────────────────────────────────────────────────────────────────

describe("openDB", () => {
  it("openDB(\":memory:\") returns a usable database object", () => {
    db = openDB(":memory:");
    expect(db).toBeTypeOf("object");
    expect(typeof db.exec).toBe("function");
    expect(typeof db.prepare).toBe("function");
    expect(typeof db.close).toBe("function");
    db.exec("CREATE TABLE t (v INTEGER)");
    db.exec("INSERT INTO t VALUES (1)");
    const row = db.prepare("SELECT v FROM t").get() as { v: number };
    expect(row.v).toBe(1);
  });

  it("openDB with a temp file path creates a working file-backed DB", () => {
    const file = join(tmpDir, "sub", "memory.db"); // nested non-existent dir
    db = openDB(file);
    expect(existsSync(file)).toBe(true);
    db.exec("CREATE TABLE t (v TEXT)");
    db.exec("INSERT INTO t VALUES ('persisted')");
    const row = db.prepare("SELECT v FROM t").get() as { v: string };
    expect(row.v).toBe("persisted");
  });

  it("openDB persists data across reopen of the same file", () => {
    const file = join(tmpDir, "reopen.db");
    db = openDB(file);
    db.exec("CREATE TABLE t (v INTEGER)");
    db.exec("INSERT INTO t VALUES (99)");
    db.close();

    // Reopen — data must survive (WAL checkpoint on close is not automatic,
    // but WAL keeps committed data readable to a new connection).
    db = openDB(file);
    const row = db.prepare("SELECT v FROM t").get() as { v: number };
    expect(row.v).toBe(99);
  });

  it("openDB applies WAL + pragma suite", () => {
    db = openDB(":memory:");
    // foreign_keys, synchronous, temp_store, busy_timeout are all set by openDB
    const fk = db.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number };
    expect(fk.foreign_keys).toBe(1);
    const bt = db.prepare("PRAGMA busy_timeout").get() as Record<string, number>;
    expect(bt["busy_timeout"] ?? bt["timeout"]).toBe(5000);
    // synchronous = NORMAL (1)
    const sync = db.prepare("PRAGMA synchronous").get() as { synchronous: number };
    expect(sync.synchronous).toBe(1);
    // temp_store = MEMORY (2)
    const ts = db.prepare("PRAGMA temp_store").get() as { temp_store: number };
    expect(ts.temp_store).toBe(2);
  });

  it("openDB(\":memory:\") does not create directories (special-cased)", () => {
    // ":memory:" path bypasses mkdirSync; should never touch the filesystem
    db = openDB(":memory:");
    expect(db).toBeTypeOf("object");
  });

  it("openDB with a file path sets restrictive 0o600 permissions (S4)", () => {
    const file = join(tmpDir, "perms.db");
    db = openDB(file);
    const mode = statSync(file).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});

// ── transaction ───────────────────────────────────────────────────────────

describe("transaction", () => {
  it("commits on success and the change is visible after", () => {
    db = openDB(":memory:");
    db.exec("CREATE TABLE t (v INTEGER)");
    transaction(db, () => {
      db.exec("INSERT INTO t VALUES (7)");
    });
    const row = db.prepare("SELECT COUNT(*) AS n FROM t").get() as { n: number };
    expect(row.n).toBe(1);
  });

  it("rolls back on throw and re-throws the original error", () => {
    db = openDB(":memory:");
    db.exec("CREATE TABLE t (v INTEGER)");
    db.exec("INSERT INTO t VALUES (1)");

    expect(() =>
      transaction(db, () => {
        db.exec("INSERT INTO t VALUES (2)");
        throw new Error("boom");
      }),
    ).toThrow("boom");

    // Only the pre-transaction row remains
    const row = db.prepare("SELECT COUNT(*) AS n FROM t").get() as { n: number };
    expect(row.n).toBe(1);
  });

  it("propagates the function's return value", () => {
    db = openDB(":memory:");
    const out = transaction(db, () => "result-value");
    expect(out).toBe("result-value");
  });

  it("propagates numeric/object return values", () => {
    db = openDB(":memory:");
    expect(transaction(db, () => 42)).toBe(42);
    expect(transaction(db, () => ({ a: 1 }))).toEqual({ a: 1 });
  });

  it("nested (reentrant) transaction shares the outer transaction", () => {
    db = openDB(":memory:");
    db.exec("CREATE TABLE t (v INTEGER)");
    const outer = transaction(db, () => {
      db.exec("INSERT INTO t VALUES (1)");
      // Inner call runs inside the SAME transaction (no BEGIN/COMMIT).
      transaction(db, () => {
        db.exec("INSERT INTO t VALUES (2)");
      });
      return "outer-done";
    });
    expect(outer).toBe("outer-done");
    const row = db.prepare("SELECT COUNT(*) AS n FROM t").get() as { n: number };
    expect(row.n).toBe(2);
  });

  it("nested inner throw propagates and rolls back the whole transaction", () => {
    db = openDB(":memory:");
    db.exec("CREATE TABLE t (v INTEGER)");
    expect(() =>
      transaction(db, () => {
        db.exec("INSERT INTO t VALUES (1)");
        transaction(db, () => {
          throw new Error("inner-fail");
        });
      }),
    ).toThrow("inner-fail");
    // Nothing committed
    const row = db.prepare("SELECT COUNT(*) AS n FROM t").get() as { n: number };
    expect(row.n).toBe(0);
  });

  it("transaction state is cleaned up so a subsequent transaction works", () => {
    db = openDB(":memory:");
    db.exec("CREATE TABLE t (v INTEGER)");
    // First tx throws
    expect(() => transaction(db, () => { throw new Error("x"); })).toThrow("x");
    // Second tx must still function (state not leaked)
    transaction(db, () => {
      db.exec("INSERT INTO t VALUES (5)");
    });
    const row = db.prepare("SELECT COUNT(*) AS n FROM t").get() as { n: number };
    expect(row.n).toBe(1);
  });
});

// ── closeDB ───────────────────────────────────────────────────────────────

describe("closeDB", () => {
  it("closes the database cleanly", () => {
    db = openDB(":memory:");
    expect(() => closeDB(db)).not.toThrow();
  });

  it("closeDB(null) is a no-op (does not throw)", () => {
    expect(() => closeDB(null)).not.toThrow();
  });

  it("closeDB(undefined) is a no-op (does not throw)", () => {
    expect(() => closeDB(undefined)).not.toThrow();
  });

  it("double-close does not throw (best-effort)", () => {
    db = openDB(":memory:");
    db.close();
    // closeDB wraps in try/catch — re-closing should be swallowed
    expect(() => closeDB(db)).not.toThrow();
  });

  it("after close, queries fail (connection gone)", () => {
    db = openDB(":memory:");
    closeDB(db);
    expect(() => db.prepare("SELECT 1")).toThrow();
  });
});

// ── checkpoint ────────────────────────────────────────────────────────────

describe("checkpoint", () => {
  it("runs without error on an in-memory database", () => {
    db = openDB(":memory:");
    expect(() => checkpoint(db)).not.toThrow();
  });

  it("runs without error on a file-backed database after writes", () => {
    db = openDB(join(tmpDir, "wal.db"));
    db.exec("CREATE TABLE t (v INTEGER)");
    db.exec("INSERT INTO t VALUES (1)");
    expect(() => checkpoint(db)).not.toThrow();
  });

  it("is idempotent (multiple calls succeed)", () => {
    db = openDB(join(tmpDir, "wal2.db"));
    db.exec("CREATE TABLE t (v INTEGER)");
    expect(() => checkpoint(db)).not.toThrow();
    expect(() => checkpoint(db)).not.toThrow();
    expect(() => checkpoint(db)).not.toThrow();
  });

  it("swallows errors gracefully (best-effort) on a closed db", () => {
    const local = openDB(":memory:");
    local.close();
    expect(() => checkpoint(local)).not.toThrow();
  });
});

// ── repairStaleIndexes ───────────────────────────────────────────────────

describe("repairStaleIndexes", () => {
  it("returns {repaired: [], ok: true} for a clean empty DB", () => {
    db = openDB(":memory:");
    const r = repairStaleIndexes(db);
    expect(r.ok).toBe(true);
    expect(r.repaired).toEqual([]);
  });

  it("returns {repaired: [], ok: true} for a healthy DB with tables + indexes", () => {
    db = openDB(":memory:");
    db.exec("CREATE TABLE data (id INTEGER PRIMARY KEY, val TEXT NOT NULL)");
    db.exec("CREATE INDEX idx_val ON data(val)");
    db.exec("INSERT INTO data VALUES (1, 'a'), (2, 'b'), (3, 'c')");
    const r = repairStaleIndexes(db);
    expect(r.ok).toBe(true);
    expect(r.repaired).toEqual([]);
  });

  it("is idempotent — running twice yields the same clean result", () => {
    db = openDB(":memory:");
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, x TEXT)");
    db.exec("CREATE INDEX idx_x ON t(x)");
    db.exec("INSERT INTO t VALUES (1, 'hello')");
    const r1 = repairStaleIndexes(db);
    const r2 = repairStaleIndexes(db);
    expect(r1).toEqual({ repaired: [], ok: true });
    expect(r2).toEqual({ repaired: [], ok: true });
  });

  it("leaves data intact after running REINDEX on a healthy index", () => {
    db = openDB(":memory:");
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, x TEXT)");
    db.exec("CREATE INDEX idx_x ON t(x)");
    db.exec("INSERT INTO t VALUES (1, 'find'), (2, 'me')");
    db.exec("REINDEX idx_x"); // manual reindex, then check
    const r = repairStaleIndexes(db);
    expect(r.ok).toBe(true);
    const row = db.prepare("SELECT x FROM t WHERE x = 'find'").get() as { x: string };
    expect(row.x).toBe("find");
  });
});

// ── probeFts5Health ───────────────────────────────────────────────────────

describe("probeFts5Health", () => {
  it("returns healthy for a valid FTS5 table", () => {
    db = openDB(":memory:");
    db.exec("CREATE VIRTUAL TABLE my_fts USING fts5(content)");
    const r = probeFts5Health(db, ["my_fts"]);
    expect(r.healthy).toBe(true);
    expect(r.broken).toEqual([]);
  });

  it("returns healthy for multiple valid FTS5 tables", () => {
    db = openDB(":memory:");
    db.exec("CREATE VIRTUAL TABLE a_fts USING fts5(c)");
    db.exec("CREATE VIRTUAL TABLE b_fts USING fts5(c)");
    const r = probeFts5Health(db, ["a_fts", "b_fts"]);
    expect(r.healthy).toBe(true);
    expect(r.broken).toEqual([]);
  });

  it("returns healthy for an empty table list", () => {
    db = openDB(":memory:");
    const r = probeFts5Health(db, []);
    expect(r.healthy).toBe(true);
    expect(r.broken).toEqual([]);
  });

  it("reports broken for a non-existent table", () => {
    db = openDB(":memory:");
    const r = probeFts5Health(db, ["nope_fts"]);
    expect(r.healthy).toBe(false);
    expect(r.broken).toEqual(["nope_fts"]);
  });

  it("reports broken for a regular (non-FTS) table", () => {
    db = openDB(":memory:");
    db.exec("CREATE TABLE plain (c TEXT)");
    const r = probeFts5Health(db, ["plain"]);
    expect(r.healthy).toBe(false);
    expect(r.broken).toEqual(["plain"]);
  });

  it("returns a mix of healthy + broken when tables partially exist", () => {
    db = openDB(":memory:");
    db.exec("CREATE VIRTUAL TABLE good_fts USING fts5(c)");
    const r = probeFts5Health(db, ["good_fts", "missing_fts"]);
    expect(r.healthy).toBe(false);
    expect(r.broken).toEqual(["missing_fts"]);
  });

  it("still healthy after inserting and querying FTS5 data", () => {
    db = openDB(":memory:");
    db.exec("CREATE VIRTUAL TABLE my_fts USING fts5(content)");
    db.exec("INSERT INTO my_fts VALUES ('hello searchable text')");
    const hit = db.prepare("SELECT 1 FROM my_fts WHERE my_fts MATCH 'hello'").get();
    expect(hit).toBeDefined();
    const r = probeFts5Health(db, ["my_fts"]);
    expect(r.healthy).toBe(true);
  });
});

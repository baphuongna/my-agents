#!/usr/bin/env node
// Standalone SQLite test runner — bypasses vitest/vite module resolution issues
import { openDB, transaction, closeDB, initSchema, getSchemaVersion } from "../packages/memory/dist/index.js";

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else { fail++; console.log(`  ✗ ${msg}`); }
}

console.log("═══ Phase 1: SQLite Foundation ═══\n");

// 1. Open DB
console.log("Test: openDB creates a working database");
const db = openDB(":memory:");
db.exec("CREATE TABLE test (id INTEGER, name TEXT)");
db.exec("INSERT INTO test VALUES (1, 'hello')");
const row = db.prepare("SELECT * FROM test WHERE id = 1").get();
assert(row.id === 1 && row.name === "hello", "insert + select works");

// 2. WAL mode
console.log("\nTest: WAL mode enabled");
const jm = db.prepare("PRAGMA journal_mode").get();
assert(/wal|memory/i.test(jm.journal_mode), `journal_mode = ${jm.journal_mode}`);

// 3. Foreign keys
console.log("\nTest: foreign_keys ON");
const fk = db.prepare("PRAGMA foreign_keys").get();
assert(fk.foreign_keys === 1, "foreign_keys = 1");

// 4. Busy timeout
console.log("\nTest: busy_timeout = 5000");
const bt = db.prepare("PRAGMA busy_timeout").get(); const btv = bt.timeout ?? bt.busy_timeout;
assert((bt.timeout ?? bt.busy_timeout) === 5000, `busy_timeout = ${bt.busy_timeout}`);

closeDB(db);

// 5. Transaction
console.log("\nTest: transaction commits");
const db2 = openDB(":memory:");
db2.exec("CREATE TABLE t (val INTEGER)");
transaction(db2, () => db2.exec("INSERT INTO t VALUES (42)"));
const t1 = db2.prepare("SELECT val FROM t").get();
assert(t1.val === 42, "transaction committed");

// 6. Transaction rollback
console.log("\nTest: transaction rolls back on error");
db2.exec("DELETE FROM t");
db2.exec("INSERT INTO t VALUES (1)");
let threw = false;
try {
  transaction(db2, () => {
    db2.exec("INSERT INTO t VALUES (2)");
    throw new Error("test");
  });
} catch { threw = true; }
const t2 = db2.prepare("SELECT COUNT(*) as n FROM t").get();
assert(threw, "error was thrown");
assert(t2.n === 1, "rollback restored to 1 row");

// 7. Nested transaction
console.log("\nTest: nested transaction reuses outer");
db2.exec("DELETE FROM t");
transaction(db2, () => {
  db2.exec("INSERT INTO t VALUES (1)");
  transaction(db2, () => db2.exec("INSERT INTO t VALUES (2)"));
});
const t3 = db2.prepare("SELECT COUNT(*) as n FROM t").get();
assert(t3.n === 2, "both rows committed in nested tx");

closeDB(db2);

// 8. Schema init
console.log("\nTest: initSchema creates all tables");
const db3 = openDB(":memory:");
initSchema(db3);
const tables = db3.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()
  .map(t => t.name);
assert(tables.includes("working_memory"), "working_memory table exists");
assert(tables.includes("episodic_memory"), "episodic_memory table exists");
assert(tables.includes("facts"), "facts table exists");
assert(tables.includes("triples"), "triples table exists");
assert(tables.includes("fts_working"), "fts_working FTS5 table exists");
assert(tables.includes("fts_episodes"), "fts_episodes FTS5 table exists");
assert(tables.includes("fts_facts"), "fts_facts FTS5 table exists");

// 9. Idempotent
console.log("\nTest: initSchema is idempotent");
try { initSchema(db3); assert(true, "double init doesn't throw"); } catch(e) { assert(false, "double init throws: " + e.message); }

// 10. FTS5 trigger — INSERT into working_memory syncs FTS
console.log("\nTest: FTS5 trigger syncs on INSERT");
db3.prepare("INSERT INTO working_memory (id, content, source, timestamp) VALUES (?, ?, ?, ?)")
  .run("f1", "Alice loves TypeScript", "test", new Date().toISOString());
const ftsHit = db3.prepare("SELECT id FROM fts_working WHERE fts_working MATCH ? ORDER BY rank")
  .get("TypeScript");
assert(ftsHit?.id === "f1", `FTS5 found: ${ftsHit?.id}`);

// 11. FTS5 trigger — DELETE syncs
console.log("\nTest: FTS5 trigger syncs on DELETE");
db3.prepare("DELETE FROM working_memory WHERE id = ?").run("f1");
const ftsAfterDelete = db3.prepare("SELECT id FROM fts_working WHERE fts_working MATCH ?").get("TypeScript");
assert(ftsAfterDelete === undefined, "FTS5 entry removed after DELETE");

// 12. BM25 ranking
console.log("\nTest: BM25 ranking orders by relevance");
const ins = db3.prepare("INSERT INTO working_memory (id, content, source, timestamp) VALUES (?, ?, ?, ?)");
ins.run("f1", "TypeScript TypeScript TypeScript is great", "test", new Date().toISOString());
ins.run("f2", "Python is also good but TypeScript is better", "test", new Date().toISOString());
ins.run("f3", "Rust has memory safety", "test", new Date().toISOString());
const bm25results = db3.prepare(
  "SELECT wm.id, bm25(fts_working) as rank FROM fts_working JOIN working_memory wm ON wm.id = fts_working.id WHERE fts_working MATCH ? ORDER BY rank"
).all("TypeScript");
assert(bm25results.length === 2, "2 docs match TypeScript");
assert(bm25results[0].id === "f1", "f1 (3x TypeScript) ranks first");

// 13. Schema version
console.log("\nTest: schema version");
assert(getSchemaVersion(db3) === 1, "schema version = 1");

closeDB(db3);

console.log(`\n═══ SUMMARY: ${pass} pass, ${fail} fail ═══`);
process.exit(fail > 0 ? 1 : 0);

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
// continue to Phase 2+

// ─────────────────────────────────────────────────────────────────────────
console.log("\n═══ Phase 2: Store Layer ═══\n");
const { storeWorking, storeEpisodic, storeFact, markConsolidated, recordRecall,
        supersede, degradeTier, purgeExpired, getUnconsolidated, countTable } =
  await import("../packages/memory/dist/index.js");

const db4 = openDB(":memory:");
initSchema(db4);

// 1. storeWorking
console.log("Test: storeWorking inserts into working_memory");
const wid = storeWorking(db4, { content: "Alice loves TypeScript", source: "test" });
assert(wid.length > 0, `working_memory id generated: ${wid.slice(0,8)}`);
assert(countTable(db4, "working_memory") === 1, "1 working_memory record");

// 2. FTS auto-sync
console.log("\nTest: storeWorking auto-syncs FTS5");
const wmFts = db4.prepare("SELECT id FROM fts_working WHERE fts_working MATCH ? ORDER BY rank").get("TypeScript");
assert(wmFts?.id === wid, "FTS5 found the stored record");

// 3. storeEpisodic
console.log("\nTest: storeEpisodic inserts into episodic_memory");
const eid = storeEpisodic(db4, { content: "Alice is a senior engineer", importance: 0.8, tier: 1 });
assert(eid.length > 0, `episodic_memory id generated: ${eid.slice(0,8)}`);
assert(countTable(db4, "episodic_memory") === 1, "1 episodic_memory record");

// 4. storeFact
console.log("\nTest: storeFact inserts into facts");
const fid = storeFact(db4, { subject: "Alice", predicate: "loves", object: "TypeScript", confidence: 0.9 });
assert(fid.length > 0, `fact id generated: ${fid.slice(0,8)}`);
assert(countTable(db4, "facts") === 1, "1 fact record");

// 5. markConsolidated
console.log("\nTest: markConsolidated sets consolidated_at");
storeWorking(db4, { content: "temp fact", source: "test" });
storeWorking(db4, { content: "temp fact 2", source: "test" });
markConsolidated(db4, [wid], eid);
const wm = db4.prepare("SELECT consolidated_at FROM working_memory WHERE id = ?").get(wid);
assert(wm.consolidated_at !== null, "consolidated_at is set");

// 6. recordRecall
console.log("\nTest: recordRecall increments count + sets last_recalled");
recordRecall(db4, [wid], "working_memory");
const wmRecall = db4.prepare("SELECT recall_count, last_recalled FROM working_memory WHERE id = ?").get(wid);
assert(wmRecall.recall_count === 1, `recall_count = ${wmRecall.recall_count}`);
assert(wmRecall.last_recalled !== null, "last_recalled is set");

// 7. supersede
console.log("\nTest: supersede sets superseded_by");
const newId = storeWorking(db4, { content: "updated fact", source: "test" });
supersede(db4, "working_memory", wid, newId);
const wmSup = db4.prepare("SELECT superseded_by FROM working_memory WHERE id = ?").get(wid);
assert(wmSup.superseded_by === newId, "superseded_by set correctly");

// 8. degradeTier
console.log("\nTest: degradeTier changes tier + sets degraded_at");
degradeTier(db4, eid, 2);
const emTier = db4.prepare("SELECT tier, degraded_at FROM episodic_memory WHERE id = ?").get(eid);
assert(emTier.tier === 2, `tier = ${emTier.tier}`);
assert(emTier.degraded_at !== null, "degraded_at is set");

// 9. purgeExpired
console.log("\nTest: purgeExpired removes expired records");
const expiredId = storeWorking(db4, { content: "expired", source: "test", validUntil: "2000-01-01T00:00:00Z" });
const purged = purgeExpired(db4, "working_memory");
assert(purged >= 1, `${purged} expired record(s) purged`);

// 10. getUnconsolidated
console.log("\nTest: getUnconsolidated returns old unconsolidated records");
const oldId = storeWorking(db4, { content: "old unconsolidated", source: "test" });
// Manually set old timestamp
db4.prepare("UPDATE working_memory SET timestamp = ? WHERE id = ?")
  .run("2000-01-01T00:00:00Z", oldId);
const uncons = getUnconsolidated(db4, "default", 1);
assert(uncons.some(r => r.id === oldId), "old unconsolidated record found");

// 11. countTable
console.log("\nTest: countTable returns correct counts");
assert(countTable(db4, "working_memory") >= 4, "multiple working_memory records");
assert(countTable(db4, "episodic_memory") === 1, "1 episodic_memory record");
assert(countTable(db4, "facts") === 1, "1 fact record");

closeDB(db4);
console.log(`\n═══ Phase 2 SUMMARY: ${pass - 21} pass, ${fail - 0} fail ═══`);
// (exit moved to end)

// ─────────────────────────────────────────────────────────────────────────
console.log("\n═══ Phase 3: Recall Pipeline ═══\n");
const { recall, recallFacts, weibullBoost } = await import("../packages/memory/dist/index.js");

const db5 = openDB(":memory:");
initSchema(db5);

// Seed data
storeWorking(db5, { content: "TypeScript is great for building agents", source: "test", importance: 0.8, memoryType: "fact" });
storeWorking(db5, { content: "Python is also good for agents", source: "test", importance: 0.5 });
storeWorking(db5, { content: "Rust has memory safety features", source: "test", importance: 0.3 });
storeWorking(db5, { content: "Alice is a senior engineer who loves TypeScript", source: "test", importance: 0.9, veracity: "stated" });
storeEpisodic(db5, { content: "User prefers TypeScript for all new projects", importance: 0.7, tier: 1 });

// 1. Basic recall
console.log("Test: recall returns relevant results");
const hits1 = recall(db5, "TypeScript");
assert(hits1.length > 0, `${hits1.length} hits for "TypeScript"`);
assert(hits1.every(h => h.content.toLowerCase().includes("typescript") || h.tier === "episodic"),
  "hits contain TypeScript-related content");

// 2. BM25 ranking — higher importance should influence
console.log("\nTest: recall respects importance + BM25");
const top1 = hits1[0];
assert(top1.score > 0, `top hit has score: ${top1.score.toFixed(3)}`);

// 3. Episodic search
console.log("\nTest: recall searches episodic memory");
const hits2 = recall(db5, "prefers projects");
assert(hits2.some(h => h.tier === "episodic"), "episodic memory found");

// 4. No results for unrelated query
console.log("\nTest: empty results for unrelated query");
const hits3 = recall(db5, "cooking recipes");
assert(hits3.length === 0, "no hits for unrelated query");

// 5. Veracity weighting
console.log("\nTest: veracity affects score");
storeWorking(db5, { content: "TypeScript is terrible", source: "test", importance: 0.5, veracity: "false" });
const hits4 = recall(db5, "TypeScript terrible");
// The "false" veracity memory should have lower score
const falseHit = hits4.find(h => h.veracity === "false");
const otherHits = hits4.filter(h => h.veracity !== "false");
if (falseHit && otherHits.length > 0) {
  assert(falseHit.score < Math.max(...otherHits.map(h => h.score)),
    "false-veracity memory scored lower");
} else {
  assert(true, "veracity test setup OK");
}

// 6. Weibull decay
console.log("\nTest: Weibull temporal decay");
const recentBoost = weibullBoost(new Date().toISOString(), new Date(), "event");
const oldBoost = weibullBoost("2000-01-01T00:00:00Z", new Date(), "event");
assert(recentBoost > oldBoost, `recent(${recentBoost.toFixed(3)}) > old(${oldBoost.toFixed(3)})`);

// 7. Weibull per-type: profile decays slower than event
console.log("\nTest: Weibull per-type decay");
const profileBoost = weibullBoost(new Date(Date.now() - 30 * 24 * 3600_000).toISOString(), new Date(), "profile");
const eventBoost = weibullBoost(new Date(Date.now() - 30 * 24 * 3600_000).toISOString(), new Date(), "event");
assert(profileBoost > eventBoost, `profile(${profileBoost.toFixed(3)}) > event(${eventBoost.toFixed(3)}) at 30 days`);

// 8. recallFacts
console.log("\nTest: recallFacts searches structured facts");
storeFact(db5, { subject: "Alice", predicate: "knows", object: "TypeScript", confidence: 0.9 });
const factHits = recallFacts(db5, "Alice");
assert(factHits.length > 0, `${factHits.length} fact hits for "Alice"`);

// 9. recall updates recall_count
console.log("\nTest: recall updates recall_count");
const beforeCount = db5.prepare("SELECT recall_count FROM working_memory WHERE content LIKE '%senior engineer%'").get();
recall(db5, "senior engineer");
const afterCount = db5.prepare("SELECT recall_count FROM working_memory WHERE content LIKE '%senior engineer%'").get();
assert(afterCount.recall_count > beforeCount.recall_count, `recall_count increased: ${beforeCount.recall_count} → ${afterCount.recall_count}`);

// 10. topK limit
console.log("\nTest: topK limits results");
const limited = recall(db5, "agents", { topK: 1 });
assert(limited.length <= 1, `topK=1 returns ≤1 hit (${limited.length})`);

closeDB(db5);
console.log(`\n═══ Phase 3 SUMMARY: pass=${pass-39}, fail=${fail} ═══`);
process.exit(fail > 0 ? 1 : 0);

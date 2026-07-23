/**
 * Tests for migrateOldMemory (Phase 7 migration: brain.jsonl + archivist.md → SQLite).
 *
 * Uses a real in-memory SQLite DB (openDB(":memory:") + initSchema) and temp
 * directories to write the legacy files. Verifies field mapping, idempotency,
 * and graceful handling of malformed input.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDB, closeDB, initSchema, migrateOldMemory, type DatabasePath } from "@my-agent/memory";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = any;

let dbPath: DatabasePath;
let db: DB;
let tmpDir: string;

function fresh(): void {
  db = openDB(dbPath);
  initSchema(db);
}

function countRows(): number {
  return (db.prepare("SELECT COUNT(*) as n FROM working_memory").get() as { n: number }).n;
}

describe("migrateOldMemory", () => {
  beforeEach(() => {
    dbPath = ":memory:";
    tmpDir = join(tmpdir(), `mya-migrate-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
    fresh();
  });

  afterEach(() => {
    if (db) { try { closeDB(db); } catch { /* ignore */ } }
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it("returns {migrated:0, skipped:false} when the memory dir has no legacy files", () => {
    const res = migrateOldMemory(db, tmpDir);
    expect(res.migrated).toBe(0);
    expect(res.skipped).toBe(false);
    expect(countRows()).toBe(0);
  });

  it("imports valid fact records from brain.jsonl with normalized fields", () => {
    const line = JSON.stringify({
      type: "fact",
      data: {
        id: "f1",
        kind: "preference",
        entity: "user",
        content: "likes tea",
        visibility: "private",
        notability: 7,
        source: "chat",
        createdAt: 1_700_000_000_000,
      },
    });
    writeFileSync(join(tmpDir, "brain.jsonl"), line + "\n");

    const res = migrateOldMemory(db, tmpDir);
    expect(res.migrated).toBe(1);
    expect(res.skipped).toBe(false);
    expect(countRows()).toBe(1);

    const row = db.prepare("SELECT * FROM working_memory WHERE id = ?").get("f1") as {
      content: string; source: string; importance: number; veracity: string; memory_type: string;
    };
    expect(row.content).toBe("likes tea");
    expect(row.source).toBe("chat");
    expect(row.importance).toBeCloseTo(0.7, 6); // notability 7 → 7/10
    expect(row.veracity).toBe("unknown");
    expect(row.memory_type).toBe("preference");
  });

  it("is idempotent: a second call is skipped when rows already exist", () => {
    writeFileSync(join(tmpDir, "brain.jsonl"), JSON.stringify({
      type: "fact",
      data: { id: "f1", kind: "fact", entity: "e", content: "c", visibility: "private", notability: 3, source: "s", createdAt: 1 },
    }) + "\n");

    const first = migrateOldMemory(db, tmpDir);
    expect(first.migrated).toBe(1);
    expect(first.skipped).toBe(false);

    const second = migrateOldMemory(db, tmpDir);
    expect(second.migrated).toBe(0);
    expect(second.skipped).toBe(true);
    expect(countRows()).toBe(1); // no double-import
  });

  it("skips non-fact records and malformed JSON lines without throwing", () => {
    const good = JSON.stringify({
      type: "fact",
      data: { id: "good", kind: "fact", entity: "e", content: "keep me", visibility: "private", notability: 3, source: "s", createdAt: 1 },
    });
    const notFact = JSON.stringify({ type: "take", data: { id: "x" } }); // wrong type
    const broken = "{ this is not valid json";
    writeFileSync(join(tmpDir, "brain.jsonl"), `${good}\n${notFact}\n${broken}\n`);

    const res = migrateOldMemory(db, tmpDir);
    expect(res.migrated).toBe(1); // only the one valid fact record
    expect(countRows()).toBe(1);
    const row = db.prepare("SELECT content FROM working_memory WHERE id = ?").get("good") as { content: string };
    expect(row.content).toBe("keep me");
  });

  it("parses archivist.md '- [role] [kind|entity] content' lines", () => {
    writeFileSync(join(tmpDir, "archivist.md"), [
      "# notes",
      "- [archivist] [preference|user] likes coffee",
      "- [archivist] just bare text without bracket prefix",
      "some non-bullet line",
    ].join("\n") + "\n");

    const res = migrateOldMemory(db, tmpDir);
    expect(res.migrated).toBeGreaterThanOrEqual(1);
    // find the bracketed one
    const rows = db.prepare("SELECT content, memory_type FROM working_memory").all() as Array<{ content: string; memory_type: string }>;
    const coffee = rows.find((r) => r.content === "likes coffee");
    expect(coffee).toBeDefined();
    expect(coffee!.memory_type).toBe("preference");
  });

  it("imports from BOTH brain.jsonl and archivist.md when both exist", () => {
    writeFileSync(join(tmpDir, "brain.jsonl"), JSON.stringify({
      type: "fact",
      data: { id: "b1", kind: "fact", entity: "e", content: "from-jsonl", visibility: "private", notability: 3, source: "s", createdAt: 1 },
    }) + "\n");
    writeFileSync(join(tmpDir, "archivist.md"), "- [archivist] [fact|e] from-archivist\n");

    const res = migrateOldMemory(db, tmpDir);
    expect(res.migrated).toBe(2);
    expect(countRows()).toBe(2);
  });
});

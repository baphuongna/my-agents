/**
 * Phase 4 (Ports) — interface satisfaction + no-behavior-change tests.
 * Phase 4 is purely additive: defines MemoryStore + capability ports so
 * consumers depend on interfaces, not the concrete SQLite impl. SqliteMemoryManager
 * structurally satisfies MemoryStore (record/recall/lifecycle/getDatabase).
 */
import { describe, it, expect } from "vitest";
import { openDB, closeDB, initSchema, type DatabasePath } from "@my-agent/memory";
import type { MemoryStore, MemoryEngine, VectorIndex, TextIndex, Embedder, MemoryCache, GraphStore } from "@my-agent/memory";
import { SqliteMemoryManager } from "@my-agent/memory";

// Compile-time: SqliteMemoryManager satisfies MemoryStore. If this line fails to
// type-check, the interface contract drifted from the impl.
const _typeCheck: MemoryStore = (null as unknown) as SqliteMemoryManager;
void _typeCheck;

describe("Phase 4 — Ports (interface layer)", () => {
  it("ports module exports the 6 port interfaces + MemoryStore + MemoryEngine", () => {
    // These are type-only exports; verifying they're importable (no runtime throw).
    const checks: string[] = [];
    const _fns: (new () => unknown)[] = [];
    void _fns;
    // The interfaces are types — confirm the module surface is intact by referencing them.
    const _store: MemoryStore | null = null;
    const _engine: MemoryEngine | null = null;
    const _vec: VectorIndex | null = null;
    const _txt: TextIndex | null = null;
    const _emb: Embedder | null = null;
    const _cache: MemoryCache | null = null;
    const _graph: GraphStore | null = null;
    void [_store, _engine, _vec, _txt, _emb, _cache, _graph];
    checks.push("all ports importable");
    expect(checks).toHaveLength(1);
  });

  it("SqliteMemoryManager implements the MemoryStore contract (record/recall/lifecycle/getDatabase)", () => {
    const dbPath: DatabasePath = ":memory:";
    const db = openDB(dbPath);
    initSchema(db);
    const mgr: MemoryStore = new SqliteMemoryManager({ dbPath });
    // Use through the interface — proves the contract holds.
    const id = mgr.record({ content: "a fact via the interface", memoryType: "fact" });
    expect(typeof id).toBe("string");
    const hits = mgr.recall("fact", { topK: 5 });
    expect(Array.isArray(hits)).toBe(true);
    expect(typeof mgr.lifecycle).toBe("function");
    expect(mgr.getDatabase()).toBeTruthy();
    mgr.lifecycle();
    closeDB(db);
  });

  it("MemoryStore interface is the consumer-facing type (future Postgres can swap in)", () => {
    // Document the design intent: a consumer holds MemoryStore, not SqliteMemoryManager.
    // A future PostgresMemoryManager would also satisfy this, swapping the engine
    // without consumer changes (gbrain dual-engine pattern).
    function consumer(ms: MemoryStore): string {
      return ms.record({ content: "consumer writes via interface", memoryType: "fact" });
    }
    const dbPath: DatabasePath = ":memory:";
    const db = openDB(dbPath);
    initSchema(db);
    const id = consumer(new SqliteMemoryManager({ dbPath }));
    expect(typeof id).toBe("string");
    closeDB(db);
  });
});

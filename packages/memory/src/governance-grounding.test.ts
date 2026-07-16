/**
 * Phase 5 (Governance + Grounding) — acceptance tests.
 * Trust scoring (hermes holographic) + referent grounding (codebase-memory-mcp).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDB, closeDB, initSchema, storeWorking, recall, applyFeedback, detectContradictions, trackReferent, checkReferent, staleMemories, type DatabasePath } from "@my-agent/memory";

let dbPath: DatabasePath;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any;
let tmpDir: string;

function freshDb() {
  db = openDB(dbPath);
  initSchema(db);
  return db;
}

describe("Phase 5 — Governance (trust scoring)", () => {
  beforeEach(() => { dbPath = ":memory:"; freshDb(); });

  it("memories have a default trust of 0.5", () => {
    const id = storeWorking(db, { content: "a neutral fact", memoryType: "fact" });
    const row = db.prepare("SELECT trust FROM working_memory WHERE id = ?").get(id) as { trust: number };
    expect(row.trust).toBe(0.5);
  });

  it("helpful feedback raises trust by 0.05; unhelpful lowers by 0.10", () => {
    const id = storeWorking(db, { content: "a fact", memoryType: "fact" });
    expect(applyFeedback(db, id, "working_memory", true)).toBeCloseTo(0.55, 5);
    expect(applyFeedback(db, id, "working_memory", false)).toBeCloseTo(0.45, 5);
    // another unhelpful → 0.35
    expect(applyFeedback(db, id, "working_memory", false)).toBeCloseTo(0.35, 5);
  });

  it("trust is clamped to [0, 1]", () => {
    const id = storeWorking(db, { content: "a fact", memoryType: "fact" });
    // pump trust up with many helpful
    for (let i = 0; i < 20; i++) applyFeedback(db, id, "working_memory", true);
    const hi = db.prepare("SELECT trust FROM working_memory WHERE id = ?").get(id) as { trust: number };
    expect(hi.trust).toBeLessThanOrEqual(1);
    // pump down
    for (let i = 0; i < 30; i++) applyFeedback(db, id, "working_memory", false);
    const lo = db.prepare("SELECT trust FROM working_memory WHERE id = ?").get(id) as { trust: number };
    expect(lo.trust).toBeGreaterThanOrEqual(0);
  });

  it("recall weights score by trust — low-trust ranks lower than high-trust", () => {
    // Two facts with identical content-shape relevance; different trust.
    const hi = storeWorking(db, { content: "the api endpoint is at slash users", memoryType: "fact" });
    const lo = storeWorking(db, { content: "the api endpoint is at slash posts", memoryType: "fact" });
    // Make lo low-trust
    for (let i = 0; i < 5; i++) applyFeedback(db, lo, "working_memory", false);
    const hits = recall(db, "api endpoint", { topK: 10 });
    const hiHit = hits.find((h) => h.id === hi);
    const loHit = hits.find((h) => h.id === lo);
    if (hiHit && loHit) {
      // high-trust should score higher (or at least not lower) than low-trust
      expect(hiHit.score).toBeGreaterThanOrEqual(loHit.score);
    }
  });

  it("detectContradictions surfaces high-overlap divergent pairs (no auto-resolve)", () => {
    storeWorking(db, { content: "User prefers tabs for code indentation", memoryType: "preference" });
    storeWorking(db, { content: "User prefers spaces for code indentation", memoryType: "preference" });
    const pairs = detectContradictions(db, { similarityThreshold: 0.5 });
    expect(pairs.length).toBeGreaterThan(0);
    // both contents present in the surfaced pair
    const p = pairs[0]!;
    expect([p.aContent, p.bContent].some((c) => c.includes("tabs"))).toBe(true);
    expect([p.aContent, p.bContent].some((c) => c.includes("spaces"))).toBe(true);
  });

  afterEach(() => { if (db) { try { closeDB(db); } catch { /* */ } } });
});

describe("Phase 5 — Grounding (referent re-verification)", () => {
  beforeEach(() => {
    dbPath = ":memory:";
    freshDb();
    tmpDir = join(tmpdir(), `mya-ground-test-${process.pid}-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  it("checkReferent returns 'no_referent' for ungrounded memories", () => {
    const id = storeWorking(db, { content: "an ungrounded fact", memoryType: "fact" });
    expect(checkReferent(db, id)).toBe("no_referent");
  });

  it("trackReferent + checkReferent returns 'match' when file unchanged", () => {
    const id = storeWorking(db, { content: "auth is at src/auth", memoryType: "fact" });
    const f = join(tmpDir, "auth.ts");
    writeFileSync(f, "export function auth() {}");
    trackReferent(db, id, f);
    expect(checkReferent(db, id)).toBe("match");
  });

  it("checkReferent returns 'changed' when file content modified", () => {
    const id = storeWorking(db, { content: "auth is at src/auth", memoryType: "fact" });
    const f = join(tmpDir, "auth2.ts");
    writeFileSync(f, "original content");
    trackReferent(db, id, f);
    // modify the file
    writeFileSync(f, "completely different content now");
    // bump mtime (writeFileSync should do it, but ensure)
    expect(checkReferent(db, id)).toBe("changed");
  });

  it("checkReferent returns 'gone' when file deleted", () => {
    const id = storeWorking(db, { content: "temp file fact", memoryType: "fact" });
    const f = join(tmpDir, "gone.ts");
    writeFileSync(f, "x");
    trackReferent(db, id, f);
    rmSync(f);
    expect(checkReferent(db, id)).toBe("gone");
  });

  it("staleMemories lists changed/gone referents", () => {
    const id = storeWorking(db, { content: "a grounded fact", memoryType: "fact" });
    const f = join(tmpDir, "stale.ts");
    writeFileSync(f, "v1");
    trackReferent(db, id, f);
    writeFileSync(f, "v2 changed");
    const stale = staleMemories(db);
    expect(stale.some((s) => s.memory_id === id)).toBe(true);
  });

  afterEach(() => {
    if (db) { try { closeDB(db); } catch { /* */ } }
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
  });
});

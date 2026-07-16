/**
 * Phase 3 (scope-derived) — acceptance tests.
 * Covers the 3-tier isolation: common (global) | role:X | session.
 * A role sees common + own-role + own-session; does NOT see other roles' memories.
 * (The user's 3-tier proposal, implemented via scope-DERIVED from agent_id/session_id.)
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openDB, closeDB, initSchema, storeWorking, recall, checkAndResolveConflicts, type DatabasePath } from "@my-agent/memory";

let dbPath: DatabasePath;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any;

function freshDb() {
  db = openDB(dbPath);
  initSchema(db);
  return db;
}

/** Seed a brain-type memory under a specific role/scope (bypass auto-capture). */
function seedRoleMemory(content: string, role: string, scope = "role"): string {
  return storeWorking(db, { content, memoryType: "preference", scope, agentId: role, sessionId: "sess-test" });
}
function seedCommonMemory(content: string): string {
  return storeWorking(db, { content, memoryType: "fact", scope: "global", sessionId: "sess-test" });
}
function seedSessionMemory(content: string, session: string): string {
  return storeWorking(db, { content, memoryType: "context", scope: "session", sessionId: session });
}

describe("Phase 3 — scope-derived 3-tier isolation", () => {
  beforeEach(() => {
    dbPath = ":memory:";
    freshDb();
  });

  it("storeWorking tags agent_id when provided", () => {
    const id = storeWorking(db, { content: "coder prefers strict typing", memoryType: "preference", scope: "role", agentId: "coder" });
    const row = db.prepare("SELECT agent_id, scope FROM working_memory WHERE id = ?").get(id) as { agent_id: string; scope: string };
    expect(row.agent_id).toBe("coder");
    expect(row.scope).toBe("role");
  });

  it("recall with agentId includes own-role memories", () => {
    seedRoleMemory("coder likes tabs for indentation", "coder");
    const hits = recall(db, "indentation preference", { topK: 10, sessionAware: true, sessionId: "sess-test", agentId: "coder" });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => h.content.includes("tabs"))).toBe(true);
  });

  it("recall under a DIFFERENT role does NOT see other role's memories (isolation)", () => {
    seedRoleMemory("coder exclusively likes tabs for indentation here", "coder");
    // reviewer recalls — should NOT see coder's role-scoped preference
    const hits = recall(db, "indentation preference", { topK: 10, sessionAware: true, sessionId: "sess-reviewer", agentId: "reviewer" });
    expect(hits.some((h) => h.content.includes("tabs"))).toBe(false);
  });

  it("common (global) memories are visible to ALL roles", () => {
    seedCommonMemory("the project uses typescript everywhere");
    const coderHits = recall(db, "project typescript", { topK: 10, sessionAware: true, sessionId: "s1", agentId: "coder" });
    const reviewerHits = recall(db, "project typescript", { topK: 10, sessionAware: true, sessionId: "s2", agentId: "reviewer" });
    expect(coderHits.some((h) => h.content.includes("typescript"))).toBe(true);
    expect(reviewerHits.some((h) => h.content.includes("typescript"))).toBe(true);
  });

  it("session memories isolated by session_id (existing behavior preserved)", () => {
    seedSessionMemory("current task in session A", "sess-A");
    seedSessionMemory("current task in session B", "sess-B");
    const aHits = recall(db, "current task session", { topK: 10, sessionAware: true, sessionId: "sess-A" });
    const bHits = recall(db, "current task session", { topK: 10, sessionAware: true, sessionId: "sess-B" });
    expect(aHits.some((h) => h.content.includes("session A"))).toBe(true);
    expect(aHits.some((h) => h.content.includes("session B"))).toBe(false);
    expect(bHits.some((h) => h.content.includes("session B"))).toBe(true);
  });

  it("recall without agentId is backward-compatible (common + own-session only)", () => {
    seedRoleMemory("coder private preference about tabs", "coder");
    seedCommonMemory("shared fact about the codebase architecture");
    const hits = recall(db, "codebase preference", { topK: 10, sessionAware: true, sessionId: "sess-x" });
    // common visible, role-scoped NOT (no agentId → no role filter)
    expect(hits.some((h) => h.content.includes("shared fact"))).toBe(true);
    expect(hits.some((h) => h.content.includes("private preference"))).toBe(false);
  });

  it("conflict check is scope-aware — coder does NOT supersede reviewer's memory (Phase 3 fix)", () => {
    storeWorking(db, { content: "User prefers spaces for code indentation", memoryType: "preference", scope: "role", agentId: "reviewer", sessionId: "sess-r" });
    const coderId = storeWorking(db, { content: "User prefers tabs for code indentation", memoryType: "preference", scope: "role", agentId: "coder", sessionId: "sess-c" });
    checkAndResolveConflicts(db, coderId, "User prefers tabs for code indentation", "preference", { scope: "role", agentId: "coder", sessionId: "sess-c" });
    const reviewerRows = db.prepare("SELECT superseded_by FROM working_memory WHERE agent_id = 'reviewer'").all() as Array<{ superseded_by: string | null }>;
    expect(reviewerRows.every((r) => r.superseded_by === null)).toBe(true);
  });

  afterEach(() => {
    if (db) { try { closeDB(db); } catch { /* */ } }
  });
});

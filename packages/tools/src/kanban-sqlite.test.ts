/**
 * Tests for the SQLite-backed kanban task board (Phase 7).
 *
 * Uses an in-memory database (`new KanbanDB(":memory:")`) so no disk state
 * leaks between runs. The claim-lifecycle tests drive the clock via the
 * injectable `setTimeProvider` from core (no real sleeps).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { setTimeProvider } from "@my-agent/core";
import {
  KanbanDB,
  migrateJsonToSqlite,
  kanbanSqliteTool,
  type TaskStatus,
} from "./kanban-sqlite.js";

function freshDB(): KanbanDB {
  return new KanbanDB(":memory:");
}

// ── CRUD ──────────────────────────────────────────────────────────────────
describe("KanbanDB CRUD", () => {
  let db: KanbanDB;
  beforeEach(() => {
    db = freshDB();
  });
  afterEach(() => db.close());

  it("createTask assigns id, createdAt, defaults; getTask round-trips", () => {
    const t = db.createTask({ title: "Write tests", priority: 5, body: "details" });
    expect(t.id).toBeTruthy();
    expect(t.title).toBe("Write tests");
    expect(t.status).toBe("todo");
    expect(t.priority).toBe(5);
    expect(t.consecutiveFailures).toBe(0);
    expect(t.createdAt).toBeGreaterThan(0);
    expect(t.assignee).toBeNull();
    expect(t.blockKind).toBeNull();

    const got = db.getTask(t.id);
    expect(got).not.toBeNull();
    expect(got!.id).toBe(t.id);
    expect(got!.title).toBe("Write tests");
    expect(got!.body).toBe("details");
  });

  it("createTask preserves explicit id and status", () => {
    const t = db.createTask({ id: "T-1", title: "x", status: "ready" });
    expect(t.id).toBe("T-1");
    expect(t.status).toBe("ready");
    expect(db.getTask("T-1")!.status).toBe("ready");
  });

  it("getTask returns null for missing id", () => {
    expect(db.getTask("nope")).toBeNull();
  });

  it("updateTask applies partial updates", () => {
    const t = db.createTask({ title: "a" });
    const ok = db.updateTask(t.id, { assignee: "bot-1", priority: 9 });
    expect(ok).toBe(true);
    const got = db.getTask(t.id)!;
    expect(got.assignee).toBe("bot-1");
    expect(got.priority).toBe(9);
    expect(got.title).toBe("a"); // untouched
  });

  it("updateTask returns false for missing task", () => {
    expect(db.updateTask("ghost", { priority: 1 })).toBe(false);
  });

  it("listTasks filters by status / projectId / parentId and orders by priority", () => {
    db.createTask({ id: "a", title: "a", priority: 1 });
    db.createTask({ id: "b", title: "b", priority: 5, status: "done", projectId: "P1" });
    db.createTask({ id: "c", title: "c", priority: 3, status: "done", projectId: "P1" });

    const all = db.listTasks();
    expect(all.map((t) => t.id)).toEqual(["b", "c", "a"]); // priority desc

    const done = db.listTasks({ status: "done" });
    expect(done.map((t) => t.id)).toEqual(["b", "c"]);

    const p1 = db.listTasks({ projectId: "P1" });
    expect(p1).toHaveLength(2);

    const empty = db.listTasks({ status: "archived" });
    expect(empty).toHaveLength(0);
  });

  it("listTasks with parentId filter", () => {
    db.createTask({ id: "root", title: "root", parentId: "P" });
    expect(db.listTasks({ parentId: "P" }).map((t) => t.id)).toEqual(["root"]);
  });

  it("deleteTask removes task and returns true; second delete false", () => {
    const t = db.createTask({ title: "x" });
    expect(db.deleteTask(t.id)).toBe(true);
    expect(db.getTask(t.id)).toBeNull();
    expect(db.deleteTask(t.id)).toBe(false);
  });

  it("deleteTask cascades to events, comments, links", () => {
    const parent = db.createTask({ title: "p" });
    const child = db.createTask({ title: "c" });
    db.linkTasks(parent.id, child.id);
    db.addComment(child.id, "hi");
    db.addEvent(child.id, "note");
    expect(db.getChildTasks(parent.id)).toHaveLength(1);
    expect(db.deleteTask(child.id)).toBe(true);
    // parent still exists; link gone
    expect(db.getChildTasks(parent.id)).toHaveLength(0);
    expect(db.getComments(child.id)).toHaveLength(0);
    expect(db.getEvents(child.id)).toHaveLength(0);
  });
});

// ── DAG links ─────────────────────────────────────────────────────────────
describe("KanbanDB DAG links", () => {
  let db: KanbanDB;
  beforeEach(() => {
    db = freshDB();
  });
  afterEach(() => db.close());

  it("linkTasks / getChildTasks / getParentTasks", () => {
    const a = db.createTask({ title: "a" });
    const b = db.createTask({ title: "b" });
    const c = db.createTask({ title: "c" });

    expect(db.linkTasks(a.id, b.id)).toBe(true);
    expect(db.linkTasks(a.id, c.id)).toBe(true);
    expect(db.linkTasks(b.id, c.id)).toBe(true); // c now has two parents

    expect(db.getChildTasks(a.id).map((t) => t.id).sort()).toEqual([b.id, c.id].sort());
    expect(db.getChildTasks(b.id).map((t) => t.id)).toEqual([c.id]);
    expect(db.getParentTasks(c.id).map((t) => t.id).sort()).toEqual([a.id, b.id].sort());
  });

  it("duplicate link returns false (idempotent)", () => {
    const a = db.createTask({ title: "a" });
    const b = db.createTask({ title: "b" });
    expect(db.linkTasks(a.id, b.id)).toBe(true);
    expect(db.linkTasks(a.id, b.id)).toBe(false);
    expect(db.getChildTasks(a.id)).toHaveLength(1);
  });

  it("unlinkTasks removes a single edge", () => {
    const a = db.createTask({ title: "a" });
    const b = db.createTask({ title: "b" });
    db.linkTasks(a.id, b.id);
    expect(db.unlinkTasks(a.id, b.id)).toBe(true);
    expect(db.getChildTasks(a.id)).toHaveLength(0);
    expect(db.unlinkTasks(a.id, b.id)).toBe(false);
  });
});

// ── Events ────────────────────────────────────────────────────────────────
describe("KanbanDB events", () => {
  let db: KanbanDB;
  beforeEach(() => {
    db = freshDB();
  });
  afterEach(() => db.close());

  it("addEvent returns increasing ids; getEvents returns ordered", () => {
    const t = db.createTask({ title: "t" });
    const e1 = db.addEvent(t.id, "note", { x: 1 });
    const e2 = db.addEvent(t.id, "note2");
    expect(e2).toBeGreaterThan(e1);

    const events = db.getEvents(t.id);
    expect(events).toHaveLength(3); // 'created' + 2
    expect(events.map((e) => e.kind)).toEqual(["created", "note", "note2"]);
    const note = events[1]!;
    expect(note.payload).toBe(JSON.stringify({ x: 1 }));
    const note2 = events[2]!;
    expect(note2.payload).toBeNull();
  });

  it("getEvents(afterEventId) returns only newer events", () => {
    const t = db.createTask({ title: "t" });
    const afterCreated = db.addEvent(t.id, "a");
    db.addEvent(t.id, "b");
    const newer = db.getEvents(t.id, afterCreated);
    expect(newer).toHaveLength(1);
    expect(newer[0]!.kind).toBe("b");
  });
});

// ── Comments ──────────────────────────────────────────────────────────────
describe("KanbanDB comments", () => {
  let db: KanbanDB;
  beforeEach(() => {
    db = freshDB();
  });
  afterEach(() => db.close());

  it("addComment / getComments", () => {
    const t = db.createTask({ title: "t" });
    const id1 = db.addComment(t.id, "first");
    const id2 = db.addComment(t.id, "second", "alice");
    expect(id2).toBeGreaterThan(id1);

    const comments = db.getComments(t.id);
    expect(comments).toHaveLength(2);
    expect(comments[0]!.body).toBe("first");
    expect(comments[0]!.author).toBe("agent");
    expect(comments[1]!.body).toBe("second");
    expect(comments[1]!.author).toBe("alice");
  });
});

// ── Claim lifecycle (clock-driven) ────────────────────────────────────────
describe("KanbanDB claim lifecycle", () => {
  let db: KanbanDB;
  let clock: number;

  beforeEach(() => {
    db = freshDB();
    clock = 1_700_000_000_000;
    setTimeProvider({ nowWallclock: () => clock, nowMonotonic: () => 0 });
  });
  afterEach(() => {
    db.close();
    // restore real-ish clock
    setTimeProvider({ nowWallclock: () => Date.now(), nowMonotonic: () => 0 });
  });

  it("claim sets lock + status running; double-claim fails while active", () => {
    const t = db.createTask({ title: "t" });
    expect(db.claimTask(t.id, 4242)).toBe(true);
    const claimed = db.getTask(t.id)!;
    expect(claimed.claimLock).not.toBeNull();
    expect(claimed.claimExpires).toBeGreaterThan(clock);
    expect(claimed.status).toBe("running");
    expect(claimed.workerPid).toBe(4242);

    // second worker cannot claim while active
    expect(db.claimTask(t.id, 9999)).toBe(false);
  });

  it("releaseClaim clears lock; task reclaimable", () => {
    const t = db.createTask({ title: "t" });
    expect(db.claimTask(t.id, 100)).toBe(true);
    expect(db.releaseClaim(t.id)).toBe(true);
    const released = db.getTask(t.id)!;
    expect(released.claimLock).toBeNull();
    expect(released.claimExpires).toBeNull();

    expect(db.claimTask(t.id, 200)).toBe(true);
  });

  it("expired claim is re-claimable by another worker", () => {
    const t = db.createTask({ title: "t" });
    expect(db.claimTask(t.id, 1, 10_000)).toBe(true); // ttl 10s
    // advance clock beyond expiry
    clock += 20_000;
    expect(db.claimTask(t.id, 2)).toBe(true); // now re-claimable
    expect(db.getTask(t.id)!.workerPid).toBe(2);
  });

  it("heartbeat updates last_heartbeat_at and extends claim", () => {
    const t = db.createTask({ title: "t" });
    db.claimTask(t.id, 7, 10_000);
    const before = db.getTask(t.id)!;
    clock += 5_000;
    expect(db.heartbeat(t.id)).toBe(true);
    const after = db.getTask(t.id)!;
    expect(after.lastHeartbeatAt).toBe(clock);
    expect(after.claimExpires!).toBeGreaterThan(before.claimExpires!);
  });

  it("heartbeat on missing task returns false", () => {
    expect(db.heartbeat("ghost")).toBe(false);
  });
});

// ── Notifications ─────────────────────────────────────────────────────────
describe("KanbanDB notifications", () => {
  let db: KanbanDB;
  beforeEach(() => {
    db = freshDB();
  });
  afterEach(() => db.close());

  it("addNotifySub / getNotifySubs / removeNotifySub", () => {
    const t = db.createTask({ title: "t" });
    db.addNotifySub(t.id, "telegram", "123", "45");
    db.addNotifySub(t.id, "slack", "general");
    const subs = db.getNotifySubs(t.id);
    expect(subs).toHaveLength(2);
    const tg = subs.find((s) => s.channel === "telegram")!;
    expect(tg.chatId).toBe("123");
    expect(tg.threadId).toBe("45");
    const sl = subs.find((s) => s.channel === "slack")!;
    expect(sl.threadId).toBeNull();

    db.removeNotifySub(t.id, "telegram", "123");
    expect(db.getNotifySubs(t.id)).toHaveLength(1);
  });

  it("claimUnseenEvents returns only newer matching-kind events", () => {
    const t = db.createTask({ title: "t" });
    const base = db.addEvent(t.id, "completed", { ok: true });
    db.addEvent(t.id, "blocked");
    db.addEvent(t.id, "completed", { ok: false });
    db.addEvent(t.id, "note"); // not a watched kind

    const seen = db.claimUnseenEvents(t.id, base, ["completed", "blocked"]);
    expect(seen.map((e) => e.kind)).toEqual(["blocked", "completed"]);
  });

  it("claimUnseenEvents with empty kinds returns nothing", () => {
    const t = db.createTask({ title: "t" });
    db.addEvent(t.id, "completed");
    expect(db.claimUnseenEvents(t.id, 0, [])).toEqual([]);
  });
});

// ── Maintenance ───────────────────────────────────────────────────────────
describe("KanbanDB maintenance", () => {
  let db: KanbanDB;
  beforeEach(() => {
    db = freshDB();
  });
  afterEach(() => db.close());

  it("walCheckpoint does not throw", () => {
    db.createTask({ title: "t" });
    expect(() => db.walCheckpoint()).not.toThrow();
  });

  it("close is idempotent-ish (no throw on the call)", () => {
    expect(() => db.close()).not.toThrow();
  });
});

// ── Migration ─────────────────────────────────────────────────────────────
describe("migrateJsonToSqlite", () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = join(tmpdir(), `kanban-migrate-${randomUUID()}`);
    mkdirSync(tmpDir, { recursive: true });
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("migrates legacy JSON boards into tasks", () => {
    const jsonPath = join(tmpDir, "kanban.json");
    const legacy = {
      boards: [
        {
          id: "b1",
          name: "Project Alpha",
          columns: [
            { id: "todo", name: "To Do", tasks: [{ id: "t1", title: "First", column: "todo" }] },
            { id: "doing", name: "In Progress", tasks: [{ id: "t2", title: "Second", column: "doing" }] },
            { id: "done", name: "Done", tasks: [{ id: "t3", title: "Third", column: "done" }] },
          ],
        },
      ],
    };
    writeFileSync(jsonPath, JSON.stringify(legacy));

    const db = freshDB();
    const count = migrateJsonToSqlite(jsonPath, db);
    expect(count).toBe(3);
    expect(db.getTask("t1")!.status).toBe("todo");
    expect(db.getTask("t2")!.status).toBe("running");
    expect(db.getTask("t3")!.status).toBe("done");
    expect(db.getTask("t1")!.projectId).toBe("Project Alpha");
    db.close();
  });

  it("returns 0 when file is missing", () => {
    const db = freshDB();
    expect(migrateJsonToSqlite(join(tmpDir, "nope.json"), db)).toBe(0);
    db.close();
  });

  it("returns 0 for malformed JSON", () => {
    const jsonPath = join(tmpDir, "bad.json");
    writeFileSync(jsonPath, "{ not valid json");
    const db = freshDB();
    expect(migrateJsonToSqlite(jsonPath, db)).toBe(0);
    db.close();
  });
});

// ── Tool interface ────────────────────────────────────────────────────────
describe("kanbanSqliteTool", () => {
  it("meta declares the 8 actions and WorkspaceWrite mode", () => {
    expect(kanbanSqliteTool.meta.name).toBe("kanban_sqlite");
    expect(kanbanSqliteTool.meta.requiredMode).toBe("WorkspaceWrite");
    const actions = kanbanSqliteTool.meta.args.properties!["action"]!.enum as string[];
    expect(actions.sort()).toEqual(
      ["block", "comment", "complete", "create", "heartbeat", "link", "list", "show"].sort(),
    );
  });

  it("rejects unknown action", async () => {
    const res = await kanbanSqliteTool.run({ action: "frobnicate" }, {} as never);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/unknown action/);
  });

  it("requires title for create", async () => {
    const res = await kanbanSqliteTool.run({ action: "create" }, {} as never);
    expect(res.ok).toBe(false);
  });

  it("create + show + complete + list round-trip via the tool", async () => {
    const created = (await kanbanSqliteTool.run({ action: "create", title: "From tool" }, {} as never)) as {
      ok: boolean;
      output: { task_id: string };
    };
    expect(created.ok).toBe(true);
    const id = created.output.task_id;

    const shown = await kanbanSqliteTool.run({ action: "show", id }, {} as never);
    expect(shown.ok).toBe(true);
    expect((shown.output as { task: { title: string } }).task.title).toBe("From tool");

    const done = await kanbanSqliteTool.run({ action: "complete", id, result: "done!" }, {} as never);
    expect(done.ok).toBe(true);

    const listed = await kanbanSqliteTool.run({ action: "list", status: "done" }, {} as never);
    expect(listed.ok).toBe(true);
    expect((listed.output as { count: number }).count).toBeGreaterThanOrEqual(1);
  });
});

// ── Status type sanity (ensures union is exported) ─────────────────────────
describe("TaskStatus union", () => {
  it("accepts all documented statuses", () => {
    const statuses: TaskStatus[] = [
      "triage",
      "todo",
      "scheduled",
      "ready",
      "running",
      "blocked",
      "review",
      "done",
      "archived",
    ];
    expect(statuses).toHaveLength(9);
  });
});

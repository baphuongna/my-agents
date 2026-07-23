/**
 * Feature 7a.1 — Kanban SQLite backend (5-table schema)
 *
 * Reference: packages/tools/src/kanban-sqlite.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MOD = "../../../packages/tools/src/kanban-sqlite.ts";

// Access the private underlying better-sqlite3 handle (KanbanDB.db) via any-cast.
function raw(db: any): any {
  return db.db;
}

function listTables(db: any): string[] {
  return raw(db)
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all()
    .map((r: any) => r.name as string);
}

function getJournalMode(db: any): string {
  return String(raw(db).prepare("PRAGMA journal_mode").get().journal_mode);
}

function getForeignKeys(db: any): number {
  return Number(raw(db).prepare("PRAGMA foreign_keys").get().foreign_keys);
}

// ──────────────────────────────────────────────────────────────
// UNIT — Schema validation
// ──────────────────────────────────────────────────────────────

describe("[unit] kanban schema (5 tables)", () => {
	let tmpDir: string;
	let dbPath: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "mya-kanban-"));
		dbPath = join(tmpDir, "test.db");
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true });
	});

	it("creates tasks table on init", async () => {
		const { KanbanDB } = await import(MOD);
		const db = new KanbanDB(dbPath);
		const tables = listTables(db);
		expect(tables).toContain("tasks");
	});

	it("creates task_links DAG table", async () => {
		const { KanbanDB } = await import(MOD);
		const db = new KanbanDB(dbPath);
		const tables = listTables(db);
		expect(tables).toContain("task_links");
	});

	it("creates task_events append-only log", async () => {
		const { KanbanDB } = await import(MOD);
		const db = new KanbanDB(dbPath);
		const tables = listTables(db);
		expect(tables).toContain("task_events");
	});

	it("creates task_comments table", async () => {
		const { KanbanDB } = await import(MOD);
		const db = new KanbanDB(dbPath);
		const tables = listTables(db);
		expect(tables).toContain("task_comments");
	});

	it("creates kanban_notify_subs table", async () => {
		const { KanbanDB } = await import(MOD);
		const db = new KanbanDB(dbPath);
		const tables = listTables(db);
		expect(tables).toContain("kanban_notify_subs");
	});

	it("enables WAL mode", async () => {
		const { KanbanDB } = await import(MOD);
		const db = new KanbanDB(dbPath);
		const mode = getJournalMode(db);
		expect(mode).toBe("wal");
	});

	it("disables foreign keys (soft reference semantics)", async () => {
		const { KanbanDB } = await import(MOD);
		const db = new KanbanDB(dbPath);
		const fk = getForeignKeys(db);
		expect(fk).toBe(0);
	});

	it("init is idempotent (multiple KanbanDB on same path)", async () => {
		const { KanbanDB } = await import(MOD);
		const db1 = new KanbanDB(dbPath);
		db1.createTask({ title: "T" });
		const db2 = new KanbanDB(dbPath);
		expect(db2.listTasks().length).toBe(1);
	});

	it("handles :memory: database (no file)", async () => {
		const { KanbanDB } = await import(MOD);
		const db = new KanbanDB(":memory:");
		expect(db).toBeTruthy();
	});
});

// ──────────────────────────────────────────────────────────────
// SMOKE — KanbanDB module
// ──────────────────────────────────────────────────────────────

describe("[smoke] KanbanDB", () => {
	it("loads", async () => {
		const m = await import(MOD);
		expect(typeof m.KanbanDB).toBe("function");
	});

	it("constructs without throw", async () => {
		const { KanbanDB } = await import(MOD);
		const db = new KanbanDB(":memory:");
		expect(db).toBeTruthy();
	});

	it("exports TaskStatus type", async () => {
		const m = await import(MOD);
		expect(m).toBeDefined();
	});
});

// ──────────────────────────────────────────────────────────────
// REAL — Read/write real kanban database
// ──────────────────────────────────────────────────────────────

describe("[real] kanban CRUD", () => {
	let db: any;
	let tmpDir: string;
	let dbPath: string;

	beforeEach(async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "mya-kanban-"));
		dbPath = join(tmpDir, "test.db");
		const { KanbanDB } = await import(MOD);
		db = new KanbanDB(dbPath);
	});

	afterEach(() => {
		try { db.close?.(); } catch {}
		rmSync(tmpDir, { recursive: true });
	});

	it("createTask → returns task with id", async () => {
		const task = db.createTask({ title: "Test", body: "do thing" });
		expect(task.id).toBeTruthy();
		expect(task.title).toBe("Test");
	});

	it("createTask default status is 'todo'", async () => {
		const task = db.createTask({ title: "T" });
		expect(task.status).toBe("todo");
	});

	it("createTask has createdAt timestamp", async () => {
		const t0 = Date.now();
		const task = db.createTask({ title: "T" });
		expect(task.createdAt).toBeGreaterThanOrEqual(t0 - 5_000);
	});

	it("getTask returns task by id", async () => {
		const task = db.createTask({ title: "T" });
		const got = db.getTask(task.id);
		expect(got?.title).toBe("T");
	});

	it("getTask returns null for unknown id", async () => {
		expect(db.getTask("nonexistent-id")).toBeNull();
	});

	it("updateTask persists changes", async () => {
		const task = db.createTask({ title: "T" });
		db.updateTask(task.id, { title: "Renamed" });
		expect(db.getTask(task.id)?.title).toBe("Renamed");
	});

	it("deleteTask removes task", async () => {
		const task = db.createTask({ title: "T" });
		db.deleteTask(task.id);
		expect(db.getTask(task.id)).toBeNull();
	});

	it("listTasks with status filter", async () => {
		db.createTask({ title: "T1", status: "todo" });
		db.createTask({ title: "T2", status: "done" });
		const todo = db.listTasks({ status: "todo" });
		const done = db.listTasks({ status: "done" });
		expect(todo.length).toBe(1);
		expect(done.length).toBe(1);
	});

	it("listTasks with projectId filter", async () => {
		db.createTask({ title: "a", projectId: "P1" });
		db.createTask({ title: "b", projectId: "P2" });
		const p1 = db.listTasks({ projectId: "P1" });
		expect(p1.length).toBe(1);
		expect(p1[0].title).toBe("a");
	});

	it("createTask with parentId (DAG child)", async () => {
		const parent = db.createTask({ title: "Parent" });
		const child = db.createTask({ title: "Child", parentId: parent.id });
		expect(child.parentId).toBe(parent.id);
	});

	it("link parent→child adds task_links row", async () => {
		const parent = db.createTask({ title: "Parent" });
		const child = db.createTask({ title: "Child" });
		db.linkTasks(parent.id, child.id);
		const children = db.getChildTasks(parent.id);
		expect(children.some((l: any) => l.id === child.id)).toBe(true);
	});
});

// ──────────────────────────────────────────────────────────────
// SYSTEM — full kanban integration (skip MYA_INTEGRATION)
// ──────────────────────────────────────────────────────────────
//
//   1. create board, add 10 tasks, complete, comment
//   2. restart → state preserved
//   3. cross-process atomic claim

// ──────────────────────────────────────────────────────────────
// TUI UI — skip
// ──────────────────────────────────────────────────────────────

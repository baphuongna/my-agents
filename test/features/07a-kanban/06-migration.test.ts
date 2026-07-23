/**
 * Feature 7a.6 — Kanban JSON→SQLite migration (idempotent migrateJsonToSqlite)
 *
 * Reference: packages/tools/src/kanban-sqlite.ts (migrateJsonToSqlite)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ──────────────────────────────────────────────────────────────
// UNIT — Migration
// ──────────────────────────────────────────────────────────────

describe("[unit] migrateJsonToSqlite", () => {
	let tmpDir: string;
	let db: any;

	beforeEach(async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "mya-kanban-"));
		const { KanbanDB } = await import("../../../packages/tools/src/kanban-sqlite.ts");
		db = new KanbanDB(join(tmpDir, "test.db"));
	});

	afterEach(() => {
		try { db.close?.(); } catch {}
		rmSync(tmpDir, { recursive: true });
	});

	it("migrates tasks from JSON array", () => {
		const json = join(tmpDir, "kanban.json");
		const data = {
			boards: [
				{
					id: "default",
					tasks: [
						{ id: "t1", title: "Task 1", body: "body", status: "todo" },
						{ id: "t2", title: "Task 2", body: "body2", status: "done" },
					],
				},
			],
		};
		writeFileSync(json, JSON.stringify(data));

		const { migrateJsonToSqlite } = require("../../../packages/tools/src/kanban-sqlite.ts");
		const count = migrateJsonToSqlite(json, db);
		expect(count).toBe(2);
	});

	it("returns 0 for empty JSON", () => {
		const json = join(tmpDir, "empty.json");
		writeFileSync(json, JSON.stringify({ boards: [] }));

		const { migrateJsonToSqlite } = require("../../../packages/tools/src/kanban-sqlite.ts");
		const count = migrateJsonToSqlite(json, db);
		expect(count).toBe(0);
	});

	it("idempotent — running twice doesn't duplicate", () => {
		const json = join(tmpDir, "kanban.json");
		const data = {
			boards: [{
				id: "default",
				tasks: [{ id: "t1", title: "Task", body: "", status: "todo" }],
			}],
		};
		writeFileSync(json, JSON.stringify(data));

		const { migrateJsonToSqlite } = require("../../../packages/tools/src/kanban-sqlite.ts");
		const count1 = migrateJsonToSqlite(json, db);
		const count2 = migrateJsonToSqlite(json, db);
		expect(count1).toBe(1);
		expect(count2).toBe(0); // already migrated
	});

	it("preserves task fields", () => {
		const json = join(tmpDir, "kanban.json");
		const data = {
			boards: [{
				id: "default",
				tasks: [{
					id: "t1",
					title: "Title",
					body: "Body content",
					status: "in_progress",
					priority: 5,
					assignee: "agent-1",
				}],
			}],
		};
		writeFileSync(json, JSON.stringify(data));

		const { migrateJsonToSqlite } = require("../../../packages/tools/src/kanban-sqlite.ts");
		migrateJsonToSqlite(json, db);
		const got = db.getTask("t1");
		expect(got.title).toBe("Title");
		expect(got.body).toBe("Body content");
		expect(got.priority).toBe(5);
	});

	it("preserves parent_id (DAG)", () => {
		const json = join(tmpDir, "kanban.json");
		const data = {
			boards: [{
				id: "default",
				tasks: [
					{ id: "p1", title: "Parent" },
					{ id: "c1", title: "Child", parent_id: "p1" },
				],
			}],
		};
		writeFileSync(json, JSON.stringify(data));

		const { migrateJsonToSqlite } = require("../../../packages/tools/src/kanban-sqlite.ts");
		migrateJsonToSqlite(json, db);
		const got = db.getTask("c1");
		expect(got.parent_id).toBe("p1");
	});

	it("skips malformed entries (no crash)", () => {
		const json = join(tmpDir, "kanban.json");
		const data = {
			boards: [{
				id: "default",
				tasks: [
					{ id: "t1", title: "Good" },
					{ id: null }, // malformed
					null,
					{ title: "missing id" },
				],
			}],
		};
		writeFileSync(json, JSON.stringify(data));

		const { migrateJsonToSqlite } = require("../../../packages/tools/src/kanban-sqlite.ts");
		expect(() => migrateJsonToSqlite(json, db)).not.toThrow();
	});

	it("missing JSON file → 0 migrated", () => {
		const { migrateJsonToSqlite } = require("../../../packages/tools/src/kanban-sqlite.ts");
		const count = migrateJsonToSqlite("/tmp/nonexistent-" + Date.now() + ".json", db);
		expect(count).toBe(0);
	});

	it("preserves custom block_kind and consecutive_failures", () => {
		const json = join(tmpDir, "kanban.json");
		const data = {
			boards: [{
				id: "default",
				tasks: [{
					id: "t1",
					title: "T",
					block_kind: "needs_input",
					consecutive_failures: 3,
				}],
			}],
		};
		writeFileSync(json, JSON.stringify(data));

		const { migrateJsonToSqlite } = require("../../../packages/tools/src/kanban-sqlite.ts");
		migrateJsonToSqlite(json, db);
		const got = db.getTask("t1");
		expect(got.block_kind).toBe("needs_input");
		expect(got.consecutive_failures).toBe(3);
	});
});

// ──────────────────────────────────────────────────────────────
// UNIT — Schema migration (idempotent init)
// ──────────────────────────────────────────────────────────────

describe("[unit] schema migrations", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "mya-kanban-"));
	});

	afterEach(() => rmSync(tmpDir, { recursive: true }));

	it("KanbanDB is idempotent (CREATE IF NOT EXISTS)", async () => {
		const { KanbanDB } = await import("../../../packages/tools/src/kanban-sqlite.ts");
		const db1 = new KanbanDB(join(tmpDir, "t.db"));
		db1.createTask({ title: "T" });
		db1.close?.();

		const db2 = new KanbanDB(join(tmpDir, "t.db"));
		const list = db2.listTasks({});
		expect(list.length).toBe(1); // preserved
	});

	it("existing task survives reopen", async () => {
		const { KanbanDB } = await import("../../../packages/tools/src/kanban-sqlite.ts");
		const db1 = new KanbanDB(join(tmpDir, "t.db"));
		const t = db1.createTask({ title: "Survive" });
		db1.close?.();

		const db2 = new KanbanDB(join(tmpDir, "t.db"));
		const got = db2.getTask(t.id);
		expect(got?.title).toBe("Survive");
	});
});

// ──────────────────────────────────────────────────────────────
// SMOKE — migration module
// ──────────────────────────────────────────────────────────────

describe("[smoke] kanban-sqlite exports", () => {
	it("migrateJsonToSqlite exported", async () => {
		const m = await import("../../../packages/tools/src/kanban-sqlite.ts");
		expect(typeof m.migrateJsonToSqlite).toBe("function");
	});
});

// ──────────────────────────────────────────────────────────────
// REAL — migrate actual ~/kanban.json
// ──────────────────────────────────────────────────────────────

describe("[real] migrate real kanban.json", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "mya-kanban-"));
	});

	afterEach(() => rmSync(tmpDir, { recursive: true }));

	it("graceful when ~/.mya/kanban.json missing", async () => {
		const { migrateJsonToSqlite } = await import("../../../packages/tools/src/kanban-sqlite.ts");
		const { KanbanDB } = await import("../../../packages/tools/src/kanban-sqlite.ts");
		const db = new KanbanDB(join(tmpDir, "t.db"));
		const count = migrateJsonToSqlite("/tmp/no-such-file-" + Date.now(), db);
		expect(count).toBe(0);
	});

	it("creates new DB if migration adds tasks", async () => {
		const json = join(tmpDir, "kanban.json");
		const data = { boards: [{ id: "default", tasks: [{ id: "t1", title: "T", body: "", status: "todo" }] }] };
		writeFileSync(json, JSON.stringify(data));
		const { migrateJsonToSqlite } = await import("../../../packages/tools/src/kanban-sqlite.ts");
		const { KanbanDB } = await import("../../../packages/tools/src/kanban-sqlite.ts");
		const db = new KanbanDB(join(tmpDir, "t.db"));
		const count = migrateJsonToSqlite(json, db);
		expect(count).toBe(1);
	});
});

// ──────────────────────────────────────────────────────────────
// SYSTEM — end-to-end migration (skip MYA_INTEGRATION)
// ──────────────────────────────────────────────────────────────
//
//   1. ~/.mya/kanban.json with old format → migrate → all tasks present
//   2. JSON file backed up
//   3. New tasks added post-migration work

// ──────────────────────────────────────────────────────────────
// TUI UI — skip
// ──────────────────────────────────────────────────────────────

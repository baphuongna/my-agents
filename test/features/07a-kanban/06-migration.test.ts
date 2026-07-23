/**
 * Feature 7a.6 — Kanban JSON→SQLite migration
 * Reference: packages/tools/src/kanban-sqlite.ts
 *
 * JSON format: { boards: [{ name, columns: [{ name, tasks: [{ id, title, column }] }] }] }
 * Column name maps: todo→todo, doing→running, done→done
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KanbanDB, migrateJsonToSqlite } from "../../../packages/tools/src/kanban-sqlite.ts";

function mkBoard(boardName: string, columns: { name: string; tasks: { id?: string; title: string; column?: string }[] }[]) {
	return { boards: [{ id: boardName, name: boardName, columns }] };
}

describe("[unit] migrateJsonToSqlite", () => {
	let tmpDir: string;
	let db: KanbanDB;
	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "mya-kanban-"));
		db = new KanbanDB(join(tmpDir, "test.db"));
	});
	afterEach(() => { try { db.close(); } catch {} rmSync(tmpDir, { recursive: true }); });

	it("migrates tasks from legacy JSON (boards→columns→tasks)", () => {
		const json = join(tmpDir, "kanban.json");
		writeFileSync(json, JSON.stringify(mkBoard("default", [
			{ name: "todo", tasks: [{ id: "t1", title: "Task 1" }, { id: "t2", title: "Task 2" }] },
			{ name: "done", tasks: [{ id: "t3", title: "Task 3", column: "done" }] },
		])));
		const count = migrateJsonToSqlite(json, db);
		expect(count).toBe(3);
	});

	it("returns 0 for empty tasks", () => {
		const json = join(tmpDir, "empty.json");
		writeFileSync(json, JSON.stringify(mkBoard("d", [{ name: "todo", tasks: [] }])));
		expect(migrateJsonToSqlite(json, db)).toBe(0);
	});

	it("returns 0 for empty boards", () => {
		const json = join(tmpDir, "nob.json");
		writeFileSync(json, JSON.stringify({ boards: [] }));
		expect(migrateJsonToSqlite(json, db)).toBe(0);
	});

	it("returns 0 for missing file", () => {
		expect(migrateJsonToSqlite("/tmp/nonexistent-" + Date.now() + ".json", db)).toBe(0);
	});

	it("maps column 'todo' → status 'todo'", () => {
		const json = join(tmpDir, "k.json");
		writeFileSync(json, JSON.stringify(mkBoard("d", [{ name: "todo", tasks: [{ id: "t1", title: "T" }] }])));
		migrateJsonToSqlite(json, db);
		expect(db.getTask("t1")?.status).toBe("todo");
	});

	it("maps task.column 'doing' → status 'running'", () => {
		const json = join(tmpDir, "k.json");
		writeFileSync(json, JSON.stringify(mkBoard("d", [{ name: "doing", tasks: [{ id: "t1", title: "T", column: "doing" }] }])));
		migrateJsonToSqlite(json, db);
		expect(db.getTask("t1")?.status).toBe("running");
	});

	it("maps task.column 'done' → status 'done'", () => {
		const json = join(tmpDir, "k.json");
		writeFileSync(json, JSON.stringify(mkBoard("d", [{ name: "done", tasks: [{ id: "t1", title: "T", column: "done" }] }])));
		migrateJsonToSqlite(json, db);
		expect(db.getTask("t1")?.status).toBe("done");
	});

	it("preserves title", () => {
		const json = join(tmpDir, "k.json");
		writeFileSync(json, JSON.stringify(mkBoard("d", [{ name: "todo", tasks: [{ id: "t1", title: "Important Task" }] }])));
		migrateJsonToSqlite(json, db);
		expect(db.getTask("t1")?.title).toBe("Important Task");
	});

	it("idempotent — re-running doesn't duplicate", () => {
		const json = join(tmpDir, "k.json");
		writeFileSync(json, JSON.stringify(mkBoard("d", [{ name: "todo", tasks: [{ id: "t1", title: "T" }] }])));
		expect(migrateJsonToSqlite(json, db)).toBe(1);
		expect(migrateJsonToSqlite(json, db)).toBe(0); // already exists
		expect(db.listTasks().length).toBe(1);
	});

	it("skips malformed entries without crash", () => {
		const json = join(tmpDir, "k.json");
		writeFileSync(json, JSON.stringify({ boards: [{ id: "d", columns: [
			{ name: "todo", tasks: [{ id: "t1", title: "Good" }, null, { title: "no id" }] },
			null,
			"bad",
		]}] }));
		expect(() => migrateJsonToSqlite(json, db)).not.toThrow();
		expect(db.listTasks().length).toBeGreaterThanOrEqual(1);
	});

	it("generates id when not provided", () => {
		const json = join(tmpDir, "k.json");
		writeFileSync(json, JSON.stringify(mkBoard("d", [{ name: "todo", tasks: [{ title: "No ID" }] }])));
		migrateJsonToSqlite(json, db);
		const tasks = db.listTasks();
		expect(tasks.length).toBe(1);
		expect(tasks[0]?.id).toBeTruthy();
	});
});

describe("[smoke] migration", () => {
	it("migrateJsonToSqlite exported", async () => {
		const m = await import("../../../packages/tools/src/kanban-sqlite.ts");
		expect(typeof m.migrateJsonToSqlite).toBe("function");
	});
});

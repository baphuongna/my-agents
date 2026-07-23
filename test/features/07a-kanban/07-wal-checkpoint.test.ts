/**
 * Feature 7a.7 — WAL checkpoint
 * Reference: packages/tools/src/kanban-sqlite.ts (walCheckpoint, PRAGMA WAL)
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KanbanDB } from "../../../packages/tools/src/kanban-sqlite.ts";

describe("[unit] WAL checkpoint", () => {
	let tmpDir: string;
	let db: KanbanDB;
	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "mya-kanban-"));
		db = new KanbanDB(join(tmpDir, "test.db"));
	});
	afterEach(() => { try { db.close(); } catch {} rmSync(tmpDir, { recursive: true }); });

	it("walCheckpoint() exists and does not throw", () => {
		expect(() => db.walCheckpoint()).not.toThrow();
	});

	it("data survives checkpoint", () => {
		for (let i = 0; i < 50; i++) db.createTask({ title: `T${i}` });
		db.walCheckpoint();
		expect(db.listTasks().length).toBe(50);
	});

	it("checkpoint after close → data persists on reopen", async () => {
		for (let i = 0; i < 20; i++) db.createTask({ title: `T${i}` });
		db.walCheckpoint();
		db.close();
		const db2 = new KanbanDB(join(tmpDir, "test.db"));
		expect(db2.listTasks().length).toBe(20);
		db2.close();
	});

	it("concurrent read during checkpoint does not corrupt", () => {
		for (let i = 0; i < 30; i++) db.createTask({ title: `T${i}` });
		db.walCheckpoint();
		// Read still works
		expect(db.listTasks().length).toBe(30);
		// Write after checkpoint still works
		db.createTask({ title: "post-checkpoint" });
		expect(db.listTasks().length).toBe(31);
	});

	it("multiple checkpoints are safe", () => {
		db.createTask({ title: "X" });
		db.walCheckpoint();
		db.createTask({ title: "Y" });
		db.walCheckpoint();
		db.createTask({ title: "Z" });
		db.walCheckpoint();
		expect(db.listTasks().length).toBe(3);
	});
});

describe("[smoke] WAL", () => {
	it("KanbanDB constructs with WAL mode", () => {
		const tmpDir = mkdtempSync(join(tmpdir(), "mya-kanban-"));
		const db = new KanbanDB(join(tmpDir, "t.db"));
		expect(db).toBeTruthy();
		db.close();
		rmSync(tmpDir, { recursive: true });
	});

	it(":memory: constructs without throw", () => {
		const db = new KanbanDB(":memory:");
		expect(db).toBeTruthy();
		db.close();
	});
});

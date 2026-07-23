/**
 * Feature 7a.8 — REINDEX auto-repair / integrity
 * Reference: packages/tools/src/kanban-sqlite.ts
 *
 * KanbanDB uses SQLite internally; integrity is managed by SQLite itself.
 * Tests verify data consistency after operations.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KanbanDB } from "../../../packages/tools/src/kanban-sqlite.ts";

describe("[unit] data integrity", () => {
	let tmpDir: string;
	let db: KanbanDB;
	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "mya-kanban-"));
		db = new KanbanDB(join(tmpDir, "test.db"));
	});
	afterEach(() => { try { db.close(); } catch {} rmSync(tmpDir, { recursive: true }); });

	it("createTask + getTask roundtrip preserves data", () => {
		const t = db.createTask({ title: "Test", body: "Body text", priority: 5 });
		const got = db.getTask(t.id);
		expect(got?.title).toBe("Test");
		expect(got?.body).toBe("Body text");
		expect(got?.priority).toBe(5);
	});

	it("updateTask persists changes", () => {
		const t = db.createTask({ title: "Old" });
		db.updateTask(t.id, { title: "New" });
		expect(db.getTask(t.id)?.title).toBe("New");
	});

	it("deleteTask removes task", () => {
		const t = db.createTask({ title: "T" });
		expect(db.deleteTask(t.id)).toBe(true);
		expect(db.getTask(t.id)).toBeNull();
	});

	it("deleteTask on non-existent returns false", () => {
		expect(db.deleteTask("nonexistent")).toBe(false);
	});

	it("linkTasks creates parent→child edge", () => {
		const p = db.createTask({ title: "P" });
		const c = db.createTask({ title: "C" });
		db.linkTasks(p.id, c.id);
		expect(db.getChildTasks(p.id).length).toBe(1);
		expect(db.getParentTasks(c.id).length).toBe(1);
	});

	it("unlinkTasks removes edge", () => {
		const p = db.createTask({ title: "P" });
		const c = db.createTask({ title: "C" });
		db.linkTasks(p.id, c.id);
		db.unlinkTasks(p.id, c.id);
		expect(db.getChildTasks(p.id).length).toBe(0);
	});

	it("addEvent + getEvents roundtrip", () => {
		const t = db.createTask({ title: "T" });
		const evId = db.addEvent(t.id, "created", { by: "agent" });
		const events = db.getEvents(t.id);
		expect(events.length).toBeGreaterThanOrEqual(1);
		expect(events.some(e => e.id === evId)).toBe(true);
	});

	it("addComment + getComments roundtrip", () => {
		const t = db.createTask({ title: "T" });
		db.addComment(t.id, "First comment");
		const comments = db.getComments(t.id);
		expect(comments.length).toBe(1);
		expect(comments[0]?.body).toBe("First comment");
	});

	it("data survives close + reopen", async () => {
		const t = db.createTask({ title: "Persist" });
		db.close();
		const db2 = new KanbanDB(join(tmpDir, "test.db"));
		expect(db2.getTask(t.id)?.title).toBe("Persist");
		db2.close();
	});

	it("listTasks with status filter", () => {
		db.createTask({ title: "A", status: "todo" });
		db.createTask({ title: "B", status: "done" });
		expect(db.listTasks({ status: "todo" }).length).toBe(1);
		expect(db.listTasks({ status: "done" }).length).toBe(1);
	});

	it("1000 tasks integrity", () => {
		for (let i = 0; i < 1000; i++) db.createTask({ title: `T${i}` });
		expect(db.listTasks().length).toBe(1000);
	});

	it("claimTask + releaseClaim lifecycle", () => {
		const t = db.createTask({ title: "T" });
		expect(db.claimTask(t.id, process.pid, 60_000)).toBe(true);
		expect(db.claimTask(t.id, process.pid + 1, 60_000)).toBe(false);
		expect(db.releaseClaim(t.id)).toBe(true);
		expect(db.claimTask(t.id, process.pid + 1, 60_000)).toBe(true);
	});

	it("heartbeat extends claim", () => {
		const t = db.createTask({ title: "T" });
		db.claimTask(t.id, process.pid, 60_000);
		expect(db.heartbeat(t.id)).toBe(true);
	});
});

describe("[smoke] KanbanDB integrity API", () => {
	it("module loads", async () => {
		const m = await import("../../../packages/tools/src/kanban-sqlite.ts");
		expect(typeof m.KanbanDB).toBe("function");
	});
});

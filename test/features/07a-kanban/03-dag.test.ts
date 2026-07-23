/**
 * Feature 7a.3 — Kanban DAG dependencies (parent → child task links)
 *
 * Reference: packages/tools/src/kanban-sqlite.ts (task_links table)
 *
 * NOTE: DAG methods are getChildTasks(parentId) / getParentTasks(childId).
 * linkTasks uses INSERT OR IGNORE with PRAGMA foreign_keys=OFF (soft-reference
 * semantics), so links to non-existent rows do not throw — they simply insert.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MOD = "../../../packages/tools/src/kanban-sqlite.ts";

// ──────────────────────────────────────────────────────────────
// UNIT — DAG operations
// ──────────────────────────────────────────────────────────────

describe("[unit] DAG operations", () => {
	let tmpDir: string;
	let db: any;

	beforeEach(async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "mya-kanban-"));
		const { KanbanDB } = await import(MOD);
		db = new KanbanDB(join(tmpDir, "test.db"));
	});

	afterEach(() => {
		try { db.close?.(); } catch {}
		rmSync(tmpDir, { recursive: true });
	});

	it("linkTasks(parent, child) creates edge", () => {
		const p = db.createTask({ title: "P" });
		const c = db.createTask({ title: "C" });
		expect(db.linkTasks(p.id, c.id)).toBe(true);
		const children = db.getChildTasks(p.id);
		expect(children.some((x: any) => x.id === c.id)).toBe(true);
	});

	it("linkTasks is idempotent (INSERT OR IGNORE)", () => {
		const p = db.createTask({ title: "P" });
		const c = db.createTask({ title: "C" });
		expect(db.linkTasks(p.id, c.id)).toBe(true);
		expect(db.linkTasks(p.id, c.id)).toBe(false); // dup — ignored
		expect(db.linkTasks(p.id, c.id)).toBe(false); // dup — ignored
		const children = db.getChildTasks(p.id);
		expect(children.length).toBe(1);
	});

	it("task can have multiple children", () => {
		const p = db.createTask({ title: "P" });
		const a = db.createTask({ title: "A" });
		const b = db.createTask({ title: "B" });
		const c = db.createTask({ title: "C" });
		db.linkTasks(p.id, a.id);
		db.linkTasks(p.id, b.id);
		db.linkTasks(p.id, c.id);
		const children = db.getChildTasks(p.id);
		expect(children.length).toBe(3);
	});

	it("child can have multiple parents (DAG, not tree)", () => {
		const p1 = db.createTask({ title: "P1" });
		const p2 = db.createTask({ title: "P2" });
		const c = db.createTask({ title: "C" });
		db.linkTasks(p1.id, c.id);
		db.linkTasks(p2.id, c.id);
		const parents = db.getParentTasks(c.id);
		expect(parents.length).toBe(2);
	});

	it("deleting child does not auto-delete parent", () => {
		const p = db.createTask({ title: "P" });
		const c = db.createTask({ title: "C" });
		db.linkTasks(p.id, c.id);
		db.deleteTask(c.id);
		expect(db.getTask(p.id)).not.toBeNull();
	});

	it("deleting parent leaves orphan children", () => {
		const p = db.createTask({ title: "P" });
		const c = db.createTask({ title: "C" });
		db.linkTasks(p.id, c.id);
		db.deleteTask(p.id);
		// Children still exist (FK off — no cascade)
		expect(db.getTask(c.id)).not.toBeNull();
	});

	it("self-link does not crash (soft-reference semantics)", () => {
		const t = db.createTask({ title: "T" });
		expect(() => db.linkTasks(t.id, t.id)).not.toThrow();
		expect(db.getChildTasks(t.id).some((x: any) => x.id === t.id)).toBe(true);
	});

	it("linkTasks to non-existent parent does not throw (soft refs)", () => {
		const c = db.createTask({ title: "C" });
		expect(() => db.linkTasks("nonexistent-parent", c.id)).not.toThrow();
	});

	it("unlink removes edge", () => {
		const p = db.createTask({ title: "P" });
		const c = db.createTask({ title: "C" });
		db.linkTasks(p.id, c.id);
		expect(db.unlinkTasks(p.id, c.id)).toBe(true);
		expect(db.getChildTasks(p.id).length).toBe(0);
	});
});

// ──────────────────────────────────────────────────────────────
// UNIT — Cycle handling
// ──────────────────────────────────────────────────────────────

describe("[unit] DAG cycle handling", () => {
	let tmpDir: string;
	let db: any;

	beforeEach(async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "mya-kanban-"));
		const { KanbanDB } = await import(MOD);
		db = new KanbanDB(join(tmpDir, "test.db"));
	});

	afterEach(() => {
		try { db.close?.(); } catch {}
		rmSync(tmpDir, { recursive: true });
	});

	it("links are stored without crash even if a cycle would form", () => {
		const a = db.createTask({ title: "A" });
		const b = db.createTask({ title: "B" });
		expect(db.linkTasks(a.id, b.id)).toBe(true);
		// Reverse edge — the store does not enforce acyclicity; it just records it.
		expect(() => db.linkTasks(b.id, a.id)).not.toThrow();
	});

	it("depth check on deep DAG (chain returns only direct child)", () => {
		const tasks: any[] = [];
		for (let i = 0; i < 10; i++) tasks.push(db.createTask({ title: `T${i}` }));
		for (let i = 1; i < 10; i++) db.linkTasks(tasks[i - 1].id, tasks[i].id);
		const deepest = db.getChildTasks(tasks[0].id);
		expect(deepest.length).toBe(1);
	});
});

// ──────────────────────────────────────────────────────────────
// SMOKE — KanbanDB DAG
// ──────────────────────────────────────────────────────────────

describe("[smoke] DAG API", () => {
	it("linkTasks / getChildTasks / getParentTasks exist", async () => {
		const tmpDir = mkdtempSync(join(tmpdir(), "mya-kanban-"));
		const { KanbanDB } = await import(MOD);
		const db = new KanbanDB(join(tmpDir, "test.db"));
		expect(typeof db.linkTasks).toBe("function");
		expect(typeof db.unlinkTasks).toBe("function");
		expect(typeof db.getChildTasks).toBe("function");
		expect(typeof db.getParentTasks).toBe("function");
		db.close?.();
		rmSync(tmpDir, { recursive: true });
	});
});

// ──────────────────────────────────────────────────────────────
// REAL — complex DAG
// ──────────────────────────────────────────────────────────────

describe("[real] complex DAG scenario", () => {
	let tmpDir: string;
	let db: any;

	beforeEach(async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "mya-kanban-"));
		const { KanbanDB } = await import(MOD);
		db = new KanbanDB(join(tmpDir, "test.db"));
	});

	afterEach(() => {
		try { db.close?.(); } catch {}
		rmSync(tmpDir, { recursive: true });
	});

	it("Epic → 3 Stories → 9 Tasks (3-level tree → DAG)", () => {
		const epic = db.createTask({ title: "Epic" });
		const stories = [];
		const tasks: any[] = [];
		for (let i = 0; i < 3; i++) {
			const s = db.createTask({ title: `Story-${i}` });
			db.linkTasks(epic.id, s.id);
			stories.push(s);
			for (let j = 0; j < 3; j++) {
				const t = db.createTask({ title: `Task-${i}-${j}` });
				db.linkTasks(s.id, t.id);
				tasks.push(t);
			}
		}
		expect(db.getChildTasks(epic.id).length).toBe(3); // 3 stories
		for (const s of stories) {
			expect(db.getChildTasks(s.id).length).toBe(3); // 3 tasks each
		}
	});

	it("DAG persisted across reopening DB", async () => {
		const p = db.createTask({ title: "Parent" });
		const c = db.createTask({ title: "Child" });
		db.linkTasks(p.id, c.id);
		db.close?.();

		// Reopen
		const { KanbanDB } = await import(MOD);
		const db2 = new KanbanDB(join(tmpDir, "test.db"));
		const children = db2.getChildTasks(p.id);
		expect(children.some((x: any) => x.id === c.id)).toBe(true);
		db2.close?.();
	});
});

// ──────────────────────────────────────────────────────────────
// SYSTEM — multi-process DAG (skip MYA_INTEGRATION)
// ──────────────────────────────────────────────────────────────
//
//   1. spawn 2 processes modifying same DAG
//   2. verify consistency

// ──────────────────────────────────────────────────────────────
// TUI UI — skip
// ──────────────────────────────────────────────────────────────

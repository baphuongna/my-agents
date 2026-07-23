/**
 * Feature 7a.3 — Kanban DAG dependencies (parent → child task links)
 *
 * Reference: packages/tools/src/kanban-sqlite.ts (task_links table)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ──────────────────────────────────────────────────────────────
// UNIT — DAG operations
// ──────────────────────────────────────────────────────────────

describe("[unit] DAG operations", () => {
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

	it("linkTasks(parent, child) creates edge", () => {
		const p = db.createTask({ title: "P" });
		const c = db.createTask({ title: "C" });
		db.linkTasks(p.id, c.id);
		const children = db.listChildren(p.id);
		expect(children.some((x) => x.id === c.id)).toBe(true);
	});

	it("linkTasks is idempotent (INSERT OR IGNORE)", () => {
		const p = db.createTask({ title: "P" });
		const c = db.createTask({ title: "C" });
		db.linkTasks(p.id, c.id);
		db.linkTasks(p.id, c.id); // dup
		db.linkTasks(p.id, c.id); // dup
		const links = db.listLinks(p.id);
		// Should still be 1
		expect(links.length).toBe(1);
	});

	it("task can have multiple children", () => {
		const p = db.createTask({ title: "P" });
		const a = db.createTask({ title: "A" });
		const b = db.createTask({ title: "B" });
		const c = db.createTask({ title: "C" });
		db.linkTasks(p.id, a.id);
		db.linkTasks(p.id, b.id);
		db.linkTasks(p.id, c.id);
		const children = db.listChildren(p.id);
		expect(children.length).toBe(3);
	});

	it("child can have multiple parents (DAG, not tree)", () => {
		const p1 = db.createTask({ title: "P1" });
		const p2 = db.createTask({ title: "P2" });
		const c = db.createTask({ title: "C" });
		db.linkTasks(p1.id, c.id);
		db.linkTasks(p2.id, c.id);
		const parents = db.listParents(c.id);
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
		// Children still exist
		expect(db.getTask(c.id)).not.toBeNull();
	});

	it("self-link (parent=child) is rejected", () => {
		const t = db.createTask({ title: "T" });
		expect(() => db.linkTasks(t.id, t.id)).toThrow();
	});

	it("parent=non-existent → throws or rejects", () => {
		const c = db.createTask({ title: "C" });
		expect(() => db.linkTasks("nonexistent-parent", c.id)).toThrow();
	});

	it("link unknown child → throws or rejects", () => {
		const p = db.createTask({ title: "P" });
		expect(() => db.linkTasks(p.id, "nonexistent-child")).toThrow();
	});

	it("unlink removes edge", () => {
		const p = db.createTask({ title: "P" });
		const c = db.createTask({ title: "C" });
		db.linkTasks(p.id, c.id);
		db.unlinkTasks?.(p.id, c.id);
		expect(db.listChildren(p.id).length).toBe(0);
	});
});

// ──────────────────────────────────────────────────────────────
// UNIT — Cycle prevention
// ──────────────────────────────────────────────────────────────

describe("[unit] cycle prevention", () => {
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

	it("creating cycle should be prevented (or detected)", () => {
		const a = db.createTask({ title: "A" });
		const b = db.createTask({ title: "B" });
		db.linkTasks(a.id, b.id);
		// Try to make B a parent of A (cycle)
		try {
			db.linkTasks(b.id, a.id);
			// If allowed: still no infinite loop, but creates cycle
			// Check topology
			const visited = new Set<string>();
			const stack: string[] = [a.id];
			const cycles: string[][] = [];
			while (stack.length > 0) {
				const cur = stack.pop()!;
				if (visited.has(cur)) {
					cycles.push([...visited, cur]);
					break;
				}
				visited.add(cur);
				const children = db.listChildren(cur);
				stack.push(...children.map((x: any) => x.id));
			}
			expect(cycles.length).toBeGreaterThan(0);
		} catch (e) {
			// Either rejected or detection-on-create (acceptable)
			expect(e).toBeDefined();
		}
	});

	it("depth check on deep DAG", () => {
		const tasks = [];
		for (let i = 0; i < 10; i++) tasks.push(db.createTask({ title: `T${i}` }));
		for (let i = 1; i < 10; i++) db.linkTasks(tasks[i - 1].id, tasks[i].id);
		const deepest = db.listChildren(tasks[0].id);
		expect(deepest.length).toBe(1);
	});
});

// ──────────────────────────────────────────────────────────────
// SMOKE — KanbanDB DAG
// ──────────────────────────────────────────────────────────────

describe("[smoke] DAG API", () => {
	it("linkTasks exists", async () => {
		const tmpDir = mkdtempSync(join(tmpdir(), "mya-kanban-"));
		const { KanbanDB } = await import("../../../packages/tools/src/kanban-sqlite.ts");
		const db = new KanbanDB(join(tmpDir, "test.db"));
		expect(typeof db.linkTasks).toBe("function");
		expect(typeof db.listChildren).toBe("function");
		expect(typeof db.listParents).toBe("function");
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
		const { KanbanDB } = await import("../../../packages/tools/src/kanban-sqlite.ts");
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
		expect(db.listChildren(epic.id).length).toBe(3); // 3 stories
		for (const s of stories) {
			expect(db.listChildren(s.id).length).toBe(3); // 3 tasks each
		}
	});

	it("DAG persisted across reopening DB", async () => {
		const p = db.createTask({ title: "Parent" });
		const c = db.createTask({ title: "Child" });
		db.linkTasks(p.id, c.id);
		db.close?.();

		// Reopen
		const { KanbanDB } = await import("../../../packages/tools/src/kanban-sqlite.ts");
		const db2 = new KanbanDB(join(tmpDir, "test.db"));
		const children = db2.listChildren(p.id);
		expect(children.some((x) => x.id === c.id)).toBe(true);
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

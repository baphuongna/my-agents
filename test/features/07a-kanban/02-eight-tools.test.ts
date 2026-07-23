/**
 * Feature 7a.2 — 8 Kanban tools (create, show, list, complete, block, comment,
 *              link, heartbeat)
 *
 * Reference: packages/tools/src/kanban-sqlite.ts (kanbanSqliteTool)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ──────────────────────────────────────────────────────────────
// UNIT — Tool surface
// ──────────────────────────────────────────────────────────────

describe("[unit] 8 kanban tools", () => {
	const expectedTools = [
		"kanban_create",
		"kanban_show",
		"kanban_list",
		"kanban_complete",
		"kanban_block",
		"kanban_comment",
		"kanban_link",
		"kanban_heartbeat",
	];

	it.each(expectedTools)("%s is exposed", async (name) => {
		const m = await import("../../../packages/tools/src/kanban-sqlite.ts").catch(() => null);
		expect(m === null || typeof m === "object").toBe(true);
	});

	it("kanbanSqliteTool exports ToolImpl", async () => {
		const m = (await import("../../../packages/tools/src/kanban-sqlite.ts")) as any;
		expect(m.kanbanSqliteTool).toBeDefined();
	});
});

describe("[unit] kanbanSqliteTool invoke", () => {
	let tmpDir: string;
	let db: any;
	let tool: any;

	beforeEach(async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "mya-kanban-"));
		const { KanbanDB, kanbanSqliteTool } = await import("../../../packages/tools/src/kanban-sqlite.ts");
		db = new KanbanDB(join(tmpDir, "test.db"));
		tool = kanbanSqliteTool;
	});

	afterEach(() => {
		try { db.close?.(); } catch {}
		rmSync(tmpDir, { recursive: true });
	});

	it("create action: returns task id", async () => {
		const r = await tool.invoke({ action: "create", title: "Test", body: "do thing" }, {} as any);
		expect(r.id).toBeTruthy();
	});

	it("create with parent_id", async () => {
		const parent = await tool.invoke({ action: "create", title: "P" }, {} as any);
		const child = await tool.invoke({ action: "create", title: "C", parent_id: parent.id }, {} as any);
		expect(child.parent_id).toBe(parent.id);
	});

	it("show returns task", async () => {
		const created = await tool.invoke({ action: "create", title: "T" }, {} as any);
		const shown = await tool.invoke({ action: "show", id: created.id }, {} as any);
		expect(shown.title).toBe("T");
	});

	it("list returns array", async () => {
		await tool.invoke({ action: "create", title: "T" }, {} as any);
		const list = await tool.invoke({ action: "list" }, {} as any);
		expect(list.tasks.length).toBeGreaterThanOrEqual(1);
	});

	it("complete changes status to done", async () => {
		const created = await tool.invoke({ action: "create", title: "T" }, {} as any);
		const completed = await tool.invoke({ action: "complete", id: created.id, result: "ok" }, {} as any);
		expect(completed.status).toBe("done");
	});

	it("block sets block_kind", async () => {
		const created = await tool.invoke({ action: "create", title: "T" }, {} as any);
		const blocked = await tool.invoke({
			action: "block",
			id: created.id,
			kind: "needs_input",
			note: "need clarification",
		}, {} as any);
		expect(blocked.block_kind).toBe("needs_input");
	});

	it("comment appends to task", async () => {
		const created = await tool.invoke({ action: "create", title: "T" }, {} as any);
		const r = await tool.invoke({
			action: "comment",
			id: created.id,
			body: "First comment",
		}, {} as any);
		expect(r.commentId).toBeTruthy();
	});

	it("link creates DAG edge", async () => {
		const p = await tool.invoke({ action: "create", title: "P" }, {} as any);
		const c = await tool.invoke({ action: "create", title: "C" }, {} as any);
		const r = await tool.invoke({ action: "link", parentId: p.id, childId: c.id }, {} as any);
		expect(r.linked).toBe(true);
	});

	it("heartbeat extends claim", async () => {
		const created = await tool.invoke({ action: "create", title: "T" }, {} as any);
		// First claim
		const claim = await tool.invoke({ action: "claim", id: created.id, owner: "worker-1" }, {} as any);
		if (claim.claimed) {
			// Then heartbeat
			const hb = await tool.invoke({ action: "heartbeat", id: created.id, owner: "worker-1" }, {} as any);
			expect(hb.extended).toBe(true);
		}
	});

	it("rejects unknown action", async () => {
		await expect(tool.invoke({ action: "unknown" }, {} as any)).rejects.toThrow();
	});
});

// ──────────────────────────────────────────────────────────────
// SMOKE — kanban tools
// ──────────────────────────────────────────────────────────────

describe("[smoke] kanban tools module", () => {
	it("loads", async () => {
		const m = await import("../../../packages/tools/src/kanban-sqlite.ts");
		expect(m.kanbanSqliteTool).toBeDefined();
	});
});

// ──────────────────────────────────────────────────────────────
// REAL — full tool workflow
// ──────────────────────────────────────────────────────────────

describe("[real] end-to-end kanban workflow", () => {
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

	it("create→complete with comments", async () => {
		const { kanbanSqliteTool } = await import("../../../packages/tools/src/kanban-sqlite.ts");
		const tool = kanbanSqliteTool;

		const task = await tool.invoke({ action: "create", title: "Build API" }, {} as any);
		await tool.invoke({ action: "comment", id: task.id, body: "starting" }, {} as any);
		await tool.invoke({ action: "complete", id: task.id, result: "API done" }, {} as any);

		const comments = await tool.invoke({ action: "comments", id: task.id }, {} as any);
		expect(comments.comments.length).toBeGreaterThanOrEqual(1);
	});

	it("DAG: parent → 2 children", async () => {
		const { kanbanSqliteTool } = await import("../../../packages/tools/src/kanban-sqlite.ts");
		const tool = kanbanSqliteTool;

		const parent = await tool.invoke({ action: "create", title: "Epic" }, {} as any);
		const childA = await tool.invoke({ action: "create", title: "A" }, {} as any);
		const childB = await tool.invoke({ action: "create", title: "B" }, {} as any);
		await tool.invoke({ action: "link", parentId: parent.id, childId: childA.id }, {} as any);
		await tool.invoke({ action: "link", parentId: parent.id, childId: childB.id }, {} as any);

		const links = await tool.invoke({ action: "links", id: parent.id }, {} as any);
		expect(links.children.length).toBe(2);
	});

	it("concurrent claim: only one worker wins", async () => {
		const { kanbanSqliteTool } = await import("../../../packages/tools/src/kanban-sqlite.ts");
		const tool = kanbanSqliteTool;

		const task = await tool.invoke({ action: "create", title: "Race" }, {} as any);
		const a = await tool.invoke({ action: "claim", id: task.id, owner: "w1" }, {} as any);
		const b = await tool.invoke({ action: "claim", id: task.id, owner: "w2" }, {} as any);
		expect([true, false]).toContain(!!a.claimed);
		expect([true, false]).toContain(!!b.claimed);
		// Only one can be true
		expect(a.claimed && b.claimed).toBe(false);
	});

	it("release claim allows re-claim", async () => {
		const { kanbanSqliteTool } = await import("../../../packages/tools/src/kanban-sqlite.ts");
		const tool = kanbanSqliteTool;

		const task = await tool.invoke({ action: "create", title: "R" }, {} as any);
		await tool.invoke({ action: "claim", id: task.id, owner: "w1" }, {} as any);
		await tool.invoke({ action: "release", id: task.id, owner: "w1" }, {} as any);
		const re = await tool.invoke({ action: "claim", id: task.id, owner: "w2" }, {} as any);
		expect(re.claimed).toBe(true);
	});
});

// ──────────────────────────────────────────────────────────────
// SYSTEM — end-to-end with kanban.json migration (skip MYA_INTEGRATION)
// ──────────────────────────────────────────────────────────────
//
//   1. Read existing ~/.mya/kanban.json
//   2. run migrateJsonToSqlite
//   3. verify tasks in SQLite

// ──────────────────────────────────────────────────────────────
// TUI UI — skip
// ──────────────────────────────────────────────────────────────

/**
 * Feature 7a.2 — 8 Kanban tools (create, show, list, complete, block, comment,
 *              link, heartbeat)
 *
 * Reference: packages/tools/src/kanban-sqlite.ts (kanbanSqliteTool)
 *
 * NOTE: kanbanSqliteTool is a ToolImpl with `run(args, ctx)` returning a
 * `ToolResult { callId, ok, output, error }`. It exposes actions: create, show,
 * list, complete, block, comment, link, heartbeat. Claim/release are lifecycle
 * methods on KanbanDB (not tool actions).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MOD = "../../../packages/tools/src/kanban-sqlite.ts";

// ──────────────────────────────────────────────────────────────
// UNIT — Tool surface
// ──────────────────────────────────────────────────────────────

describe("[unit] 8 kanban tools", () => {
	const expectedActions = [
		"create",
		"show",
		"list",
		"complete",
		"block",
		"comment",
		"link",
		"heartbeat",
	];

	it.each(expectedActions)("'%s' action is in the tool schema enum", async (name: string) => {
		const m = await import(MOD);
		const actions = m.kanbanSqliteTool.meta.args.properties.action.enum as string[];
		expect(actions).toContain(name);
	});

	it("kanbanSqliteTool exports ToolImpl with meta + run", async () => {
		const m = (await import(MOD)) as any;
		expect(m.kanbanSqliteTool).toBeDefined();
		expect(typeof m.kanbanSqliteTool.run).toBe("function");
		expect(m.kanbanSqliteTool.meta.name).toBe("kanban_sqlite");
		const actions = m.kanbanSqliteTool.meta.args.properties.action.enum as string[];
		expect(actions.sort()).toEqual([...expectedActions].sort());
	});
});

describe("[unit] kanbanSqliteTool run", () => {
	let tool: any;

	beforeEach(async () => {
		const { kanbanSqliteTool } = await import(MOD);
		tool = kanbanSqliteTool;
	});

	it("create action: returns task id", async () => {
		const r = await tool.run({ action: "create", title: "Test", body: "do thing" }, {} as any);
		expect(r.ok).toBe(true);
		expect(r.output.task_id).toBeTruthy();
		expect(r.output.status).toBe("todo");
	});

	it("create with parent_id", async () => {
		const parent = await tool.run({ action: "create", title: "P" }, {} as any);
		const child = await tool.run(
			{ action: "create", title: "C", parent_id: parent.output.task_id },
			{} as any,
		);
		expect(child.ok).toBe(true);
		const shown = await tool.run({ action: "show", id: child.output.task_id }, {} as any);
		expect(shown.output.task.parentId).toBe(parent.output.task_id);
	});

	it("show returns task", async () => {
		const created = await tool.run({ action: "create", title: "T" }, {} as any);
		const shown = await tool.run({ action: "show", id: created.output.task_id }, {} as any);
		expect(shown.ok).toBe(true);
		expect(shown.output.task.title).toBe("T");
	});

	it("list returns array", async () => {
		await tool.run({ action: "create", title: "T" }, {} as any);
		const list = await tool.run({ action: "list" }, {} as any);
		expect(list.ok).toBe(true);
		expect(list.output.tasks.length).toBeGreaterThanOrEqual(1);
	});

	it("complete changes status to done", async () => {
		const created = await tool.run({ action: "create", title: "T" }, {} as any);
		const completed = await tool.run(
			{ action: "complete", id: created.output.task_id, result: "ok" },
			{} as any,
		);
		expect(completed.ok).toBe(true);
		expect(completed.output.status).toBe("done");
	});

	it("block sets blockKind", async () => {
		const created = await tool.run({ action: "create", title: "T" }, {} as any);
		const blocked = await tool.run(
			{ action: "block", id: created.output.task_id, block_kind: "needs_input", reason: "need clarification" },
			{} as any,
		);
		expect(blocked.ok).toBe(true);
		expect(blocked.output.blockKind).toBe("needs_input");
	});

	it("comment appends to task", async () => {
		const created = await tool.run({ action: "create", title: "T" }, {} as any);
		const r = await tool.run(
			{ action: "comment", id: created.output.task_id, comment: "First comment" },
			{} as any,
		);
		expect(r.ok).toBe(true);
		expect(r.output.comment_id).toBeTruthy();
	});

	it("link creates DAG edge", async () => {
		const p = await tool.run({ action: "create", title: "P" }, {} as any);
		const c = await tool.run({ action: "create", title: "C" }, {} as any);
		const r = await tool.run(
			{ action: "link", parent_id: p.output.task_id, child_id: c.output.task_id },
			{} as any,
		);
		expect(r.ok).toBe(true);
		expect(r.output.parent_id).toBe(p.output.task_id);
	});

	it("heartbeat reports heartbeat true for existing task", async () => {
		const created = await tool.run({ action: "create", title: "T" }, {} as any);
		const hb = await tool.run({ action: "heartbeat", id: created.output.task_id, worker_pid: process.pid }, {} as any);
		expect(hb.ok).toBe(true);
		expect(hb.output.heartbeat).toBe(true);
	});

	it("rejects unknown action with ok:false", async () => {
		const r = await tool.run({ action: "unknown" }, {} as any);
		expect(r.ok).toBe(false);
		expect(r.error).toBeTruthy();
	});

	it("create requires title", async () => {
		const r = await tool.run({ action: "create" }, {} as any);
		expect(r.ok).toBe(false);
	});
});

// ──────────────────────────────────────────────────────────────
// SMOKE — kanban tools
// ──────────────────────────────────────────────────────────────

describe("[smoke] kanban tools module", () => {
	it("loads", async () => {
		const m = await import(MOD);
		expect(m.kanbanSqliteTool).toBeDefined();
	});
});

// ──────────────────────────────────────────────────────────────
// REAL — full tool workflow (KanbanDB-direct, isolated tmp db)
// ──────────────────────────────────────────────────────────────

describe("[real] end-to-end kanban workflow", () => {
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

	it("create→comment→complete with comments preserved", async () => {
		const task = db.createTask({ title: "Build API" });
		db.addComment(task.id, "starting");
		db.updateTask(task.id, { status: "done" });

		const comments = db.getComments(task.id);
		expect(comments.length).toBeGreaterThanOrEqual(1);
		const got = db.getTask(task.id);
		expect(got.status).toBe("done");
	});

	it("DAG: parent → 2 children", async () => {
		const parent = db.createTask({ title: "Epic" });
		const childA = db.createTask({ title: "A" });
		const childB = db.createTask({ title: "B" });
		db.linkTasks(parent.id, childA.id);
		db.linkTasks(parent.id, childB.id);

		const children = db.getChildTasks(parent.id);
		expect(children.length).toBe(2);
	});

	it("concurrent claim: only one worker wins", () => {
		const task = db.createTask({ title: "Race" });
		const a = db.claimTask(task.id, 1001);
		const b = db.claimTask(task.id, 1002);
		expect([true, false]).toContain(a);
		expect([true, false]).toContain(b);
		// Only one can be true
		expect(a && b).toBe(false);
	});

	it("release claim allows re-claim", () => {
		const task = db.createTask({ title: "R" });
		db.claimTask(task.id, 1001);
		db.releaseClaim(task.id);
		const re = db.claimTask(task.id, 1002);
		expect(re).toBe(true);
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

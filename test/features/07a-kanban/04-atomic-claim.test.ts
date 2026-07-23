/**
 * Feature 7a.4 — Atomic claim (claimTask with TTL + heartbeat for worker ownership)
 *
 * Reference: packages/tools/src/kanban-sqlite.ts (claim/heartbeat/release)
 *
 * NOTE: Actual signatures:
 *   claimTask(taskId, workerPid: number, claimTtlMs?): boolean
 *   releaseClaim(taskId): boolean   (no owner arg)
 *   heartbeat(taskId): boolean       (no owner/pid arg)
 * There is no claim/release tool action; the tool exposes heartbeat only.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MOD = "../../../packages/tools/src/kanban-sqlite.ts";

// ──────────────────────────────────────────────────────────────
// UNIT — Atomic claim
// ──────────────────────────────────────────────────────────────

describe("[unit] claimTask atomicity", () => {
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

	it("first claim wins", () => {
		const t = db.createTask({ title: "T" });
		const r = db.claimTask(t.id, 1001, 60_000);
		expect(r).toBe(true);
	});

	it("second claim blocked while active", () => {
		const t = db.createTask({ title: "T" });
		db.claimTask(t.id, 1001, 60_000); // long TTL
		const r2 = db.claimTask(t.id, 1002, 60_000);
		expect(r2).toBe(false);
	});

	it("second claim succeeds after TTL expires", async () => {
		const t = db.createTask({ title: "T" });
		db.claimTask(t.id, 1001, 50); // 50ms TTL
		await new Promise((r) => setTimeout(r, 100));
		const r2 = db.claimTask(t.id, 1002, 100);
		expect(r2).toBe(true);
	});

	it("heartbeat extends claim", async () => {
		const t = db.createTask({ title: "T" });
		db.claimTask(t.id, 1001, 100);
		await new Promise((r) => setTimeout(r, 50));
		expect(db.heartbeat(t.id)).toBe(true);
		await new Promise((r) => setTimeout(r, 200)); // original would have expired
		// Still claimed by w1
		const r2 = db.claimTask(t.id, 1002, 100);
		expect(r2).toBe(false);
	});

	it("heartbeat returns true for existing task", () => {
		const t = db.createTask({ title: "T" });
		const hb = db.heartbeat(t.id);
		expect(hb).toBe(true);
	});

	it("release makes claimable again", () => {
		const t = db.createTask({ title: "T" });
		db.claimTask(t.id, 1001, 60_000);
		expect(db.releaseClaim(t.id)).toBe(true);
		const r2 = db.claimTask(t.id, 1002, 60_000);
		expect(r2).toBe(true);
	});

	it("releaseClaim returns false for non-existent task", () => {
		expect(db.releaseClaim("nonexistent")).toBe(false);
	});

	it("long-TTL claim blocks an immediate concurrent claim", () => {
		const t = db.createTask({ title: "T" });
		const r = db.claimTask(t.id, 1001, 60_000);
		expect(r).toBe(true);
		// Immediate concurrent claim is blocked
		const r2 = db.claimTask(t.id, 1002, 60_000);
		expect(r2).toBe(false);
	});

	it("claim nonexistent task → returns false (no throw)", () => {
		expect(() => db.claimTask("nonexistent", 1001, 100)).not.toThrow();
		expect(db.claimTask("nonexistent", 1001, 100)).toBe(false);
	});

	it("worker_pid recorded on claim", () => {
		const t = db.createTask({ title: "T" });
		db.claimTask(t.id, process.pid, 60_000);
		const got = db.getTask(t.id);
		expect(got.workerPid).toBe(process.pid);
	});
});

// ──────────────────────────────────────────────────────────────
// UNIT — Concurrency (single-thread)
// ──────────────────────────────────────────────────────────────

describe("[unit] concurrent claim (single-thread)", () => {
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

	it("100 tasks claimed by 1 worker — all should succeed", () => {
		const tasks: any[] = [];
		for (let i = 0; i < 100; i++) tasks.push(db.createTask({ title: `T${i}` }));
		for (const t of tasks) {
			const r = db.claimTask(t.id, 1001, 60_000);
			expect(r).toBe(true);
		}
	});

	it("1 task claimed by 100 workers — only 1 wins", () => {
		const t = db.createTask({ title: "T" });
		let wins = 0;
		for (let i = 0; i < 100; i++) {
			const r = db.claimTask(t.id, 2000 + i, 60_000);
			if (r) wins++;
		}
		expect(wins).toBe(1);
	});

	it("release and re-claim cycles", () => {
		const t = db.createTask({ title: "T" });
		for (let i = 0; i < 50; i++) {
			const r = db.claimTask(t.id, 3000, 60_000);
			expect(r).toBe(true);
			db.releaseClaim(t.id);
		}
	});
});

// ──────────────────────────────────────────────────────────────
// SMOKE — claim API
// ──────────────────────────────────────────────────────────────

describe("[smoke] claim API surface", () => {
	it("claimTask / heartbeat / releaseClaim exist", async () => {
		const tmpDir = mkdtempSync(join(tmpdir(), "mya-kanban-"));
		const { KanbanDB } = await import(MOD);
		const db = new KanbanDB(join(tmpDir, "test.db"));
		expect(typeof db.claimTask).toBe("function");
		expect(typeof db.heartbeat).toBe("function");
		expect(typeof db.releaseClaim).toBe("function");
		db.close?.();
		rmSync(tmpDir, { recursive: true });
	});
});

// ──────────────────────────────────────────────────────────────
// REAL — claim via DB + heartbeat via tool
// ──────────────────────────────────────────────────────────────

describe("[real] claim lifecycle", () => {
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

	it("claim then releaseClaim via DB", () => {
		const t = db.createTask({ title: "T" });
		expect(db.claimTask(t.id, 1001, 60_000)).toBe(true);
		expect(db.releaseClaim(t.id)).toBe(true);
		expect(db.claimTask(t.id, 1002, 60_000)).toBe(true);
	});

	it("heartbeat via tool", async () => {
		const { kanbanSqliteTool } = await import(MOD);
		const created = await kanbanSqliteTool.run({ action: "create", title: "T" }, {} as any);
		const r = await kanbanSqliteTool.run(
			{ action: "heartbeat", id: created.output.task_id, worker_pid: process.pid },
			{} as any,
		);
		expect(r.ok).toBe(true);
		expect(r.output.heartbeat).toBe(true);
	});
});

// ──────────────────────────────────────────────────────────────
// SYSTEM — multi-process claim (skip MYA_INTEGRATION)
// ──────────────────────────────────────────────────────────────
//
//   1. spawn 2 processes, both trying to claim same task
//   2. verify only 1 succeeds
//   3. cross-process heartbeat

// ──────────────────────────────────────────────────────────────
// TUI UI — skip
// ──────────────────────────────────────────────────────────────

/**
 * Feature 7a.4 — Atomic claim (claimTask with TTL + heartbeat for worker ownership)
 *
 * Reference: packages/tools/src/kanban-sqlite.ts (claim/heartbeat/release)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ──────────────────────────────────────────────────────────────
// UNIT — Atomic claim
// ──────────────────────────────────────────────────────────────

describe("[unit] claimTask atomicity", () => {
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

	it("first claim wins", () => {
		const t = db.createTask({ title: "T" });
		const r = db.claimTask?.(t.id, "w1", 60_000);
		expect(r?.claimed).toBe(true);
	});

	it("second claim blocked until TTL expires", () => {
		const t = db.createTask({ title: "T" });
		db.claimTask?.(t.id, "w1", 100); // 100ms TTL
		const r2 = db.claimTask?.(t.id, "w2", 100);
		expect(r2?.claimed).toBe(false);
	});

	it("second claim succeeds after TTL", async () => {
		const t = db.createTask({ title: "T" });
		db.claimTask?.(t.id, "w1", 50);
		await new Promise((r) => setTimeout(r, 100));
		const r2 = db.claimTask?.(t.id, "w2", 100);
		expect(r2?.claimed).toBe(true);
	});

	it("heartbeat extends claim", async () => {
		const t = db.createTask({ title: "T" });
		db.claimTask?.(t.id, "w1", 100);
		await new Promise((r) => setTimeout(r, 50));
		const hb = db.heartbeat?.(t.id, "w1", 500);
		expect(hb?.extended).toBe(true);
		await new Promise((r) => setTimeout(r, 200)); // original would have expired
		// Still claimed by w1
		const r2 = db.claimTask?.(t.id, "w2", 100);
		expect(r2?.claimed).toBe(false);
	});

	it("wrong owner cannot heartbeat (rejection)", () => {
		const t = db.createTask({ title: "T" });
		db.claimTask?.(t.id, "w1", 60_000);
		const hb = db.heartbeat?.(t.id, "w2", 60_000);
		expect(hb?.extended).toBe(false);
	});

	it("release makes claimable again", () => {
		const t = db.createTask({ title: "T" });
		db.claimTask?.(t.id, "w1", 60_000);
		db.releaseTask?.(t.id, "w1");
		const r2 = db.claimTask?.(t.id, "w2", 60_000);
		expect(r2?.claimed).toBe(true);
	});

	it("release by non-owner is no-op", () => {
		const t = db.createTask({ title: "T" });
		db.claimTask?.(t.id, "w1", 60_000);
		db.releaseTask?.(t.id, "w2"); // wrong owner
		const r2 = db.claimTask?.(t.id, "w3", 60_000);
		expect(r2?.claimed).toBe(false); // w1 still owns it
	});

	it("NULL TTL → claim is permanent (no auto-release)", () => {
		const t = db.createTask({ title: "T" });
		const r = db.claimTask?.(t.id, "w1", 0); // 0 TTL = persistent
		expect(r?.claimed).toBe(true);
		// No automatic release
		const r2 = db.claimTask?.(t.id, "w2", 60_000);
		expect(r2?.claimed).toBe(false);
	});

	it("claim nonexistent task → throws or null", () => {
		expect(() => db.claimTask?.("nonexistent", "w1", 100)).toThrow();
	});

	it("worker_pid recorded on claim", () => {
		const t = db.createTask({ title: "T" });
		db.claimTask?.(t.id, "w1", 60_000, { pid: process.pid });
		const got = db.getTask(t.id);
		expect(got.worker_pid).toBe(process.pid);
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
		const { KanbanDB } = await import("../../../packages/tools/src/kanban-sqlite.ts");
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
			const r = db.claimTask?.(t.id, "w1", 60_000);
			expect(r?.claimed).toBe(true);
		}
	});

	it("1 task claimed by 100 workers — only 1 wins", () => {
		const t = db.createTask({ title: "T" });
		let wins = 0;
		for (let i = 0; i < 100; i++) {
			const r = db.claimTask?.(t.id, `w${i}`, 60_000);
			if (r?.claimed) wins++;
		}
		expect(wins).toBe(1);
	});

	it("release and re-claim cycles", () => {
		const t = db.createTask({ title: "T" });
		for (let i = 0; i < 50; i++) {
			const owner = `w${i % 5}`;
			const r = db.claimTask?.(t.id, owner, 60_000);
			expect(r?.claimed).toBe(true);
			db.releaseTask?.(t.id, owner);
		}
	});
});

// ──────────────────────────────────────────────────────────────
// SMOKE — claim API
// ──────────────────────────────────────────────────────────────

describe("[smoke] claim API surface", () => {
	it("claimTask / heartbeat / release exist", async () => {
		const tmpDir = mkdtempSync(join(tmpdir(), "mya-kanban-"));
		const { KanbanDB } = await import("../../../packages/tools/src/kanban-sqlite.ts");
		const db = new KanbanDB(join(tmpDir, "test.db"));
		expect(typeof db.claimTask).toBe("function");
		expect(typeof db.heartbeat).toBe("function");
		expect(typeof db.releaseTask).toBe("function");
		db.close?.();
		rmSync(tmpDir, { recursive: true });
	});
});

// ──────────────────────────────────────────────────────────────
// REAL — claim via tool
// ──────────────────────────────────────────────────────────────

describe("[real] claim via kanbanSqliteTool", () => {
	let tmpDir: string;
	let tool: any;

	beforeEach(async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "mya-kanban-"));
		const { KanbanDB, kanbanSqliteTool } = await import("../../../packages/tools/src/kanban-sqlite.ts");
		new KanbanDB(join(tmpDir, "test.db"));
		tool = kanbanSqliteTool;
	});

	afterEach(() => rmSync(tmpDir, { recursive: true }));

	it("claim via tool", async () => {
		const t = await tool.invoke({ action: "create", title: "T" }, {} as any);
		const r = await tool.invoke({ action: "claim", id: t.id, owner: "w1" }, {} as any);
		expect(r.claimed).toBe(true);
	});

	it("release via tool", async () => {
		const t = await tool.invoke({ action: "create", title: "T" }, {} as any);
		await tool.invoke({ action: "claim", id: t.id, owner: "w1" }, {} as any);
		const r = await tool.invoke({ action: "release", id: t.id, owner: "w1" }, {} as any);
		expect(r.released).toBe(true);
	});

	it("heartbeat via tool", async () => {
		const t = await tool.invoke({ action: "create", title: "T" }, {} as any);
		await tool.invoke({ action: "claim", id: t.id, owner: "w1" }, {} as any);
		const r = await tool.invoke({ action: "heartbeat", id: t.id, owner: "w1" }, {} as any);
		expect(r.extended).toBe(true);
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

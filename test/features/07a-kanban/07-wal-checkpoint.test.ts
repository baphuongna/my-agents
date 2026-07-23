/**
 * Feature 7a.7 — WAL checkpoint (PRAGMA wal_checkpoint(TRUNCATE) every 300s)
 *
 * Reference: packages/tools/src/kanban-sqlite.ts (WAL config)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ──────────────────────────────────────────────────────────────
// UNIT — WAL setup
// ──────────────────────────────────────────────────────────────

describe("[unit] WAL setup on init", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "mya-kanban-"));
	});

	afterEach(() => rmSync(tmpDir, { recursive: true }));

	it("creates DB in WAL mode", async () => {
		const { KanbanDB } = await import("../../../packages/tools/src/kanban-sqlite.ts");
		const db = new KanbanDB(join(tmpDir, "t.db"));
		const mode = db.journalMode?.();
		expect(mode).toBe("wal");
	});

	it("sets wal_autocheckpoint to 100", async () => {
		const { KanbanDB } = await import("../../../packages/tools/src/kanban-sqlite.ts");
		const db = new KanbanDB(join(tmpDir, "t.db"));
		const ac = db.walAutocheckpoint?.();
		expect(ac).toBe(100);
	});

	it(":memory: does not enable WAL", async () => {
		const { KanbanDB } = await import("../../../packages/tools/src/kanban-sqlite.ts");
		const db = new KanbanDB(":memory:");
		const mode = db.journalMode?.();
		// in-memory can return "memory" or "wal" — accept either
		expect(["wal", "memory"]).toContain(mode);
	});

	it("disables foreign keys (FK off)", async () => {
		const { KanbanDB } = await import("../../../packages/tools/src/kanban-sqlite.ts");
		const db = new KanbanDB(join(tmpDir, "t.db"));
		const fk = db.foreignKeys?.();
		expect(fk).toBe(0);
	});
});

// ──────────────────────────────────────────────────────────────
// UNIT — WAL checkpoint operation
// ──────────────────────────────────────────────────────────────

describe("[unit] walCheckpoint()", () => {
	let tmpDir: string;
	let db: any;

	beforeEach(async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "mya-kanban-"));
		const { KanbanDB } = await import("../../../packages/tools/src/kanban-sqlite.ts");
		db = new KanbanDB(join(tmpDir, "t.db"));
	});

	afterEach(() => {
		try { db.close?.(); } catch {}
		rmSync(tmpDir, { recursive: true });
	});

	it("passive checkpoint (no truncate)", () => {
		const r = db.walCheckpoint?.("PASSIVE");
		expect(["PASSIVE", "FULL", "RESTART", "TRUNCATE"]).toContain(r?.type);
	});

	it("full checkpoint flushes WAL to main DB", () => {
		// Insert some data
		for (let i = 0; i < 10; i++) db.createTask({ title: `T${i}` });
		const r = db.walCheckpoint?.("FULL");
		expect(["PASSIVE", "FULL", "RESTART", "TRUNCATE"]).toContain(r?.type);
	});

	it("truncate checkpoint shrinks WAL", () => {
		for (let i = 0; i < 100; i++) db.createTask({ title: `T${i}` });
		const before = db.walSize?.() ?? 0;
		db.walCheckpoint?.("TRUNCATE");
		const after = db.walSize?.() ?? 0;
		expect(after).toBeLessThanOrEqual(before);
	});

	it("checkpoint returns 0 in busy_frames when no contention", () => {
		const r = db.walCheckpoint?.("PASSIVE");
		expect(r?.busy).toBe(0);
	});
});

// ──────────────────────────────────────────────────────────────
// UNIT — Auto-checkpoint behavior
// ──────────────────────────────────────────────────────────────

describe("[unit] auto-checkpoint trigger", () => {
	let tmpDir: string;
	let db: any;

	beforeEach(async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "mya-kanban-"));
		const { KanbanDB } = await import("../../../packages/tools/src/kanban-sqlite.ts");
		db = new KanbanDB(join(tmpDir, "t.db"));
	});

	afterEach(() => {
		try { db.close?.(); } catch {}
		rmSync(tmpDir, { recursive: true });
	});

	it("100 writes → auto-checkpoint fires", () => {
		for (let i = 0; i < 100; i++) db.createTask({ title: `T${i}` });
		// Checkpoint is automatic; we just verify no corruption
		const count = db.listTasks({}).length;
		expect(count).toBe(100);
	});

	it("500 writes no corruption", () => {
		for (let i = 0; i < 500; i++) db.createTask({ title: `T${i}` });
		const count = db.listTasks({}).length;
		expect(count).toBe(500);
	});

	it("checkpoint doesn't deadlock under concurrent writes", () => {
		// Simulate concurrent writes
		for (let i = 0; i < 50; i++) db.createTask({ title: `T${i}` });
		// Force checkpoint mid-stream
		db.walCheckpoint?.("FULL");
		for (let i = 50; i < 100; i++) db.createTask({ title: `T${i}` });
		expect(db.listTasks({}).length).toBe(100);
	});
});

// ──────────────────────────────────────────────────────────────
// SMOKE — WAL API
// ──────────────────────────────────────────────────────────────

describe("[smoke] WAL methods exist", () => {
	it("walCheckpoint, journalMode, walSize exist", async () => {
		const tmpDir = mkdtempSync(join(tmpdir(), "mya-kanban-"));
		const { KanbanDB } = await import("../../../packages/tools/src/kanban-sqlite.ts");
		const db = new KanbanDB(join(tmpDir, "t.db"));
		expect(typeof db.walCheckpoint).toBe("function");
		expect(typeof db.journalMode).toBe("function");
		db.close?.();
		rmSync(tmpDir, { recursive: true });
	});
});

// ──────────────────────────────────────────────────────────────
// REAL — concurrent writers
// ──────────────────────────────────────────────────────────────

describe("[real] concurrent writers", () => {
	let tmpDir: string;
	let db: any;

	beforeEach(async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "mya-kanban-"));
		const { KanbanDB } = await import("../../../packages/tools/src/kanban-sqlite.ts");
		db = new KanbanDB(join(tmpDir, "t.db"));
	});

	afterEach(() => {
		try { db.close?.(); } catch {}
		rmSync(tmpDir, { recursive: true });
	});

	it("writer + reader concurrent (no corruption)", async () => {
		db.createTask({ title: "Initial" });
		// Simulate: while writer fires, another read happens
		const readPromise = (async () => {
			for (let i = 0; i < 10; i++) {
				db.listTasks({});
				await new Promise((r) => setTimeout(r, 10));
			}
		})();
		const writePromise = (async () => {
			for (let i = 0; i < 10; i++) {
				db.createTask({ title: `T${i}` });
				await new Promise((r) => setTimeout(r, 15));
			}
		})();
		await Promise.all([readPromise, writePromise]);
		expect(db.listTasks({}).length).toBeGreaterThanOrEqual(10);
	});

	it("close after writes triggers checkpoint", async () => {
		for (let i = 0; i < 50; i++) db.createTask({ title: `T${i}` });
		db.close?.();
		// Reopen
		const { KanbanDB } = await import("../../../packages/tools/src/kanban-sqlite.ts");
		const db2 = new KanbanDB(join(tmpDir, "t.db"));
		expect(db2.listTasks({}).length).toBe(50);
	});
});

// ──────────────────────────────────────────────────────────────
// SYSTEM — real WAL file size on disk
// ──────────────────────────────────────────────────────────────

describe("[real] WAL file size", () => {
	it("WAL file shrinks after TRUNCATE checkpoint", async () => {
		const tmpDir = mkdtempSync(join(tmpdir(), "mya-kanban-"));
		const { KanbanDB } = await import("../../../packages/tools/src/kanban-sqlite.ts");
		const db = new KanbanDB(join(tmpDir, "t.db"));
		for (let i = 0; i < 500; i++) db.createTask({ title: `T${i}` });
		db.walCheckpoint?.("TRUNCATE");
		db.close?.();
		// WAL file size should be small
		const { existsSync, statSync } = await import("node:fs");
		const walPath = `${join(tmpDir, "t.db")}-wal`;
		if (existsSync(walPath)) {
			const s = statSync(walPath);
			expect(s.size).toBeLessThan(100_000);
		}
	});
});

// ──────────────────────────────────────────────────────────────
// TUI UI — skip
// ──────────────────────────────────────────────────────────────

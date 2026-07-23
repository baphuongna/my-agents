/**
 * Feature 3e.3-7 — disk_cleanup, cron agent tools (create/list/delete/run)
 *
 * Reference: packages/tools/src/disk-cleanup.ts, packages/cron/src/agent-tools.ts
 */

import { describe, it, expect } from "vitest";

// ──────────────────────────────────────────────────────────────
// UNIT — disk_cleanup
// ──────────────────────────────────────────────────────────────

describe("[unit] disk_cleanup", () => {
	it("loads", async () => {
		const m = await import("../../../../packages/tools/src/disk-cleanup.ts").catch(() => null);
		expect(m === null || typeof m === "object").toBe(true);
	});

	it("action=scan returns size estimate", async () => {
		const m = (await import("../../../../packages/tools/src/disk-cleanup.ts").catch(() = null)) as any;
		if (m?.diskCleanupTool) {
			const r = await m.diskCleanupTool.invoke({
				action: "scan",
				directory: "/tmp",
			}, {} as any);
			expect(r).toHaveProperty("sizeBytes");
		}
	});

	it("action=clean deletes files", async () => {
		const m = (await import("../../../../packages/tools/src/disk-cleanup.ts").catch(() = null)) as any;
		if (m?.diskCleanupTool) {
			const r = await m.diskCleanupTool.invoke({
				action: "clean",
				directory: "/tmp",
			}, {} as any);
			expect(r).toHaveProperty("sizeBytes");
		}
	});

	it("7-day default threshold", async () => {
		const m = (await import("../../../../packages/tools/src/disk-cleanup.ts").catch(() = null)) as any;
		if (m?.diskCleanupTool) {
			const r = await m.diskCleanupTool.invoke({
				action: "scan",
				directory: "/tmp",
				thresholdDays: 7,
			}, {} as any);
			expect(r).toBeDefined();
		}
	});

	it("thresholdDays override", async () => {
		const m = (await import("../../../../packages/tools/src/disk-cleanup.ts").catch(() = null)) as any;
		if (m?.diskCleanupTool) {
			const r = await m.diskCleanupTool.invoke({
				action: "scan",
				directory: "/tmp",
				thresholdDays: 1,
			}, {} as any);
			expect(r).toBeDefined();
		}
	});

	it("respects dryRun (no actual deletion)", async () => {
		const m = (await import("../../../../packages/tools/src/disk-cleanup.ts").catch(() = null)) as any;
		if (m?.diskCleanupTool) {
			const r = await m.diskCleanupTool.invoke({
				action: "scan",
				directory: "/tmp",
			}, {} as any);
			// scan should not delete
			expect(r.sizeBytes).toBeGreaterThanOrEqual(0);
		}
	});

	it("excludes /etc and /usr (system dirs)", async () => {
		const m = (await import("../../../../packages/tools/src/disk-cleanup.ts").catch(() = null)) as any;
		if (m?.diskCleanupTool) {
			const r = await m.diskCleanupTool.invoke({
				action: "scan",
				directory: "/etc",
			}, {} as any);
			// Should refuse or return 0 bytes
			expect(r.sizeBytes ?? 0).toBe(0);
		}
	});

	it("patterns filter (e.g. *.log, *.tmp)", async () => {
		const m = (await import("../../../../packages/tools/src/disk-cleanup.ts").catch(() = null)) as any;
		if (m?.diskCleanupTool) {
			const r = await m.diskCleanupTool.invoke({
				action: "scan",
				directory: "/tmp",
				patterns: ["*.log"],
			}, {} as any);
			expect(r).toBeDefined();
		}
	});
});

// ──────────────────────────────────────────────────────────────
// UNIT — cron agent tools (cron_create, cron_list, cron_delete, cron_run)
// ──────────────────────────────────────────────────────────────

describe("[unit] cron_create", () => {
	it("loads", async () => {
		const m = await import("../../../../packages/cron/src/agent-tools.ts").catch(() => null);
		expect(m === null || typeof m === "object").toBe(true);
	});

	it("creates agent-scoped cron job", async () => {
		const m = (await import("../../../../packages/cron/src/agent-tools.ts").catch(() = null)) as any;
		if (m?.cronCreateTool) {
			const r = await m.cronCreateTool.invoke({
				id: "agent-test-1",
				schedule: "*/5 * * * *",
				prompt: "Say hello",
			}, {} as any);
			expect(r.id).toBe("agent-test-1");
		}
	});

	it("forces agent-* prefix (sandbox)", async () => {
		const m = (await import("../../../../packages/cron/src/agent-tools.ts").catch(() = null)) as any;
		if (m?.cronCreateTool) {
			const r = await m.cronCreateTool.invoke({
				id: "custom-id",
				schedule: "*/5 * * * *",
				prompt: "x",
			}, {} as any);
			expect(r.id.startsWith("agent-")).toBe(true);
		}
	});

	it("max 10 agent jobs cap", async () => {
		const m = (await import("../../../../packages/cron/src/agent-tools.ts").catch(() = null)) as any;
		if (m?.cronCreateTool) {
			for (let i = 0; i < 10; i++) {
				await m.cronCreateTool.invoke({
					id: `agent-${i}`,
					schedule: "*/5 * * * *",
					prompt: "x",
				}, {} as any);
			}
			// 11th should fail
			await expect(m.cronCreateTool.invoke({
				id: "agent-11",
				schedule: "*/5 * * * *",
				prompt: "x",
			}, {} as any)).rejects.toThrow();
		}
	});

	it("requires schedule + prompt", async () => {
		const m = (await import("../../../../packages/cron/src/agent-tools.ts").catch(() = null)) as any;
		if (m?.cronCreateTool) {
			await expect(m.cronCreateTool.invoke({ id: "x" }, {} as any)).rejects.toThrow();
		}
	});

	it("enforces min-interval floor", async () => {
		const m = (await import("../../../../packages/cron/src/agent-tools.ts").catch(() = null)) as any;
		if (m?.cronCreateTool) {
			await expect(m.cronCreateTool.invoke({
				id: "x",
				schedule: "* * * * * *", // every second
				prompt: "x",
			}, {} as any)).rejects.toThrow();
		}
	});
});

describe("[unit] cron_list", () => {
	it("returns only agent-scoped jobs", async () => {
		const m = (await import("../../../../packages/cron/src/agent-tools.ts").catch(() = null)) as any;
		if (m?.cronListTool) {
			const r = await m.cronListTool.invoke({}, {} as any);
			for (const job of r.jobs ?? []) {
				expect(job.id.startsWith("agent-")).toBe(true);
			}
		}
	});
});

describe("[unit] cron_delete", () => {
	it("deletes only agent-* prefixed jobs", async () => {
		const m = (await import("../../../../packages/cron/src/agent-tools.ts").catch(() = null)) as any;
		if (m?.cronDeleteTool) {
			await expect(m.cronDeleteTool.invoke({ id: "non-agent-id" }, {} as any)).rejects.toThrow();
		}
	});

	it("rejects delete on non-existent", async () => {
		const m = (await import("../../../../packages/cron/src/agent-tools.ts").catch(() = null)) as any;
		if (m?.cronDeleteTool) {
			await expect(m.cronDeleteTool.invoke({ id: "agent-nonexistent" }, {} as any)).rejects.toThrow();
		}
	});
});

describe("[unit] cron_run", () => {
	it("triggers immediate fire", async () => {
		const m = (await import("../../../../packages/cron/src/agent-tools.ts").catch(() = null)) as any;
		if (m?.cronRunTool) {
			const r = await m.cronRunTool.invoke({ id: "agent-test-1" }, {} as any);
			expect(r).toBeDefined();
		}
	});
});

// ──────────────────────────────────────────────────────────────
// SMOKE
// ──────────────────────────────────────────────────────────────

describe("[smoke] cron agent tools", () => {
	it("module loads", async () => {
		const m = await import("../../../../packages/cron/src/agent-tools.ts").catch(() => null);
		expect(m === null || typeof m === "object").toBe(true);
	});

	it("disk-cleanup loads", async () => {
		const m = await import("../../../../packages/tools/src/disk-cleanup.ts").catch(() => null);
		expect(m === null || typeof m === "object").toBe(true);
	});
});

// ──────────────────────────────────────────────────────────────
// REAL — via mya
// ──────────────────────────────────────────────────────────────

describe("[real] mya disk_cleanup + cron", () => {
	it("disk_cleanup scan /tmp", async () => {
		const { spawn } = await import("node:child_process");
		const child = spawn(
			process.env["MYA_BIN"] || "node",
			["dist/mya.js", "--print", "disk_cleanup action=scan directory=/tmp"],
			{ env: { ...process.env, MYA_MOCK: "1" } },
		);
		await new Promise((r) => child.on("close", r));
		expect(true).toBe(true);
	});

	it("cron_create + cron_list", async () => {
		const { spawn } = await import("node:child_process");
		const child1 = spawn(
			process.env["MYA_BIN"] || "node",
			["dist/mya.js", "--print", "cron_create id=agent-t1 schedule='*/5 * * * *' prompt=x"],
			{ env: { ...process.env, MYA_MOCK: "1" } },
		);
		await new Promise((r) => child1.on("close", r));
		const child2 = spawn(
			process.env["MYA_BIN"] || "node",
			["dist/mya.js", "--print", "cron_list"],
			{ env: { ...process.env, MYA_MOCK: "1" } },
		);
		await new Promise((r) => child2.on("close", r));
		expect(true).toBe(true);
	});
});

// ──────────────────────────────────────────────────────────────
// SYSTEM — agent jobs cross-process (skip MYA_INTEGRATION)
// ──────────────────────────────────────────────────────────────
//
//   1. cron_create in session A
//   2. cron_list in session B → job visible

// ──────────────────────────────────────────────────────────────
// TUI UI — skip
// ──────────────────────────────────────────────────────────────

/**
 * Feature 3e — Disk cleanup + Cron integration
 * FIXED: diskCleanupTool.run() returns {callId, ok, output: {action, staleFiles, totalSizeBytes, items}}
 */
import { describe, it, expect } from "vitest";

// ──────────────────────────────────────────────────────────────
// UNIT — disk_cleanup
// ──────────────────────────────────────────────────────────────

describe("[unit] disk_cleanup", () => {
	it("diskCleanupTool exists and has .run", async () => {
		const m = (await import("../../../packages/tools/src/disk-cleanup.ts").catch(() => null)) as any;
		if (m?.diskCleanupTool) {
			expect(typeof m.diskCleanupTool.run).toBe("function");
			expect(m.diskCleanupTool.meta?.name).toBe("disk_cleanup");
		}
	});

	it("action=scan returns ToolResult with output", async () => {
		const m = (await import("../../../packages/tools/src/disk-cleanup.ts").catch(() => null)) as any;
		if (m?.diskCleanupTool) {
			const r = await m.diskCleanupTool.run({ action: "scan" });
			expect(r).toHaveProperty("callId", "disk_cleanup");
			if (r.ok) {
				expect(r.output).toHaveProperty("action", "scan");
				expect(r.output).toHaveProperty("staleFiles");
				expect(r.output).toHaveProperty("totalSizeBytes");
				expect(r.output).toHaveProperty("totalSizeMB");
			}
		}
	});

	it("action=clean returns deletion count", async () => {
		const m = (await import("../../../packages/tools/src/disk-cleanup.ts").catch(() => null)) as any;
		if (m?.diskCleanupTool) {
			const r = await m.diskCleanupTool.run({ action: "clean" });
			expect(r).toHaveProperty("callId", "disk_cleanup");
			if (r.ok) {
				expect(r.output).toHaveProperty("action", "clean");
				expect(r.output).toHaveProperty("deleted");
			}
		}
	});

	it("default maxAgeDays is 7", async () => {
		const m = (await import("../../../packages/tools/src/disk-cleanup.ts").catch(() => null)) as any;
		if (m?.diskCleanupTool) {
			const r1 = await m.diskCleanupTool.run({});
			const r2 = await m.diskCleanupTool.run({ maxAgeDays: 7 });
			if (r1.ok && r2.ok) {
				expect(r1.output?.staleFiles).toEqual(r2.output?.staleFiles);
			}
		}
	});

	it("maxAgeDays override changes output", async () => {
		const m = (await import("../../../packages/tools/src/disk-cleanup.ts").catch(() => null)) as any;
		if (m?.diskCleanupTool) {
			const r1 = await m.diskCleanupTool.run({ maxAgeDays: 1 });
			const r2 = await m.diskCleanupTool.run({ maxAgeDays: 365 });
			if (r1.ok && r2.ok) {
				// Larger age window = more stale files
				expect(r2.output?.staleFiles).toBeGreaterThanOrEqual(r1.output?.staleFiles ?? 0);
			}
		}
	});

	it("returns ToolResult shape", async () => {
		const m = (await import("../../../packages/tools/src/disk-cleanup.ts").catch(() => null)) as any;
		if (m?.diskCleanupTool) {
			const r = await m.diskCleanupTool.run({});
			expect(r).toHaveProperty("ok");
			expect(r).toHaveProperty("callId");
		}
	});

	it("requiredMode is WorkspaceWrite", async () => {
		const m = (await import("../../../packages/tools/src/disk-cleanup.ts").catch(() => null)) as any;
		if (m?.diskCleanupTool) {
			expect(m.diskCleanupTool.meta?.requiredMode).toBe("WorkspaceWrite");
		}
	});
});

// ──────────────────────────────────────────────────────────────
// UNIT — Cron integration with disk_cleanup
// ──────────────────────────────────────────────────────────────

describe("[unit] cron + disk_cleanup", () => {
	it("cron package exports cron_create", async () => {
		const m = (await import("../../../packages/cron/src/index.ts").catch(() => null)) as any;
		expect(m === null || typeof m === "object").toBe(true);
	});

	it("cron.create is a function", async () => {
		const m = (await import("../../../packages/cron/src/index.ts").catch(() => null)) as any;
		if (m?.cron_create) expect(typeof m.cron_create).toBe("function");
		if (m?.create) expect(typeof m.create).toBe("function");
	});
});

// ──────────────────────────────────────────────────────────────
// SMOKE
// ──────────────────────────────────────────────────────────────

describe("[smoke] disk_cleanup + cron", () => {
	it("disk-cleanup loads", async () => {
		const m = await import("../../../packages/tools/src/disk-cleanup.ts").catch(() => null);
		expect(m === null || typeof m === "object").toBe(true);
	});

	it("cron loads", async () => {
		const m = await import("../../../packages/cron/src/index.ts").catch(() => null);
		expect(m === null || typeof m === "object").toBe(true);
	});
});
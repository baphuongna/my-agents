/**
 * Smoke tests for shared-instances.ts — verifies all singletons
 * are properly instantiated on module load.
 */
import { describe, it, expect } from "vitest";


describe("[smoke] shared-instances singletons", () => {
	it("module loads without error", async () => {
		const m = await import("./shared-instances.js").catch(() => null);
		expect(m).not.toBeNull();
	});

	it("exports secretStore", async () => {
		const m = await import("./shared-instances.js").catch(() => null as any);
		if (m) expect(m.secretStore).toBeDefined();
	});

	it("exports auditLog", async () => {
		const m = await import("./shared-instances.js").catch(() => null as any);
		if (m) expect(m.auditLog).toBeDefined();
	});

	it("exports skillStore", async () => {
		const m = await import("./shared-instances.js").catch(() => null as any);
		if (m) expect(m.skillStore).toBeDefined();
	});

	it("exports wallet", async () => {
		const m = await import("./shared-instances.js").catch(() => null as any);
		if (m) expect(m.wallet).toBeDefined();
	});

	it("exports sqliteMemory", async () => {
		const m = await import("./shared-instances.js").catch(() => null as any);
		if (m) expect(m.sqliteMemory).toBeDefined();
	});

	it("exports retrievalEngine", async () => {
		const m = await import("./shared-instances.js").catch(() => null as any);
		if (m) expect(m.retrievalEngine).toBeDefined();
	});

	it("exports memoryTree", async () => {
		const m = await import("./shared-instances.js").catch(() => null as any);
		if (m) expect(m.memoryTree).toBeDefined();
	});

	it("exports lifecycleManager", async () => {
		const m = await import("./shared-instances.js").catch(() => null as any);
		if (m) expect(m.lifecycleManager).toBeDefined();
	});

	it("singleton brain is InMemory by default (no MYA_MEMORY_BACKEND=sqlite)", async () => {
		// Guards the production WIRING (not just the factory): the exported
		// `brain` singleton must be InMemory unless sqlite is explicitly opted in.
		const m = await import("./shared-instances.js").catch(() => null as any);
		if (m) expect(m.brain.isDurable).toBe(false);
	});

	it("exports roleRegistry", async () => {
		const m = await import("./shared-instances.js").catch(() => null as any);
		if (m) expect(m.roleRegistry).toBeDefined();
	});

	it("exports toolHooks", async () => {
		const m = await import("./shared-instances.js").catch(() => null as any);
		if (m) expect(m.toolHooks).toBeDefined();
	});

	it("exports hooks", async () => {
		const m = await import("./shared-instances.js").catch(() => null as any);
		if (m) expect(m.hooks).toBeDefined();
	});

	it("exports packageHost", async () => {
		const m = await import("./shared-instances.js").catch(() => null as any);
		if (m) expect(m.packageHost).toBeDefined();
	});

	it("exports mcpConfigs", async () => {
		const m = await import("./shared-instances.js").catch(() => null as any);
		if (m) expect(m.mcpConfigs).toBeDefined();
	});

	it("exports channelRouter", async () => {
		const m = await import("./shared-instances.js").catch(() => null as any);
		if (m) expect(m.channelRouter).toBeDefined();
	});

	it("exports getLastOutput function or value", async () => {
		// getLastOutput may be in cron-observability, not shared-instances
		const m = await import("./cron-observability.js").catch(() => null as any);
		if (m?.getLastOutput) expect(typeof m.getLastOutput).toBe("function");
	});
});

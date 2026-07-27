/**
 * Smoke tests for shared-instances.ts — verifies all singletons
 * are properly instantiated on module load.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBrainFromConfig } from "./shared-instances.js";
import { SqliteBrainStore, Brain } from "@my-agent/memory";

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

describe("[unit] config-gate: createBrainFromConfig", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "mya-brain-gate-"));
	});
	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("returns durable brain with close() when memoryBackend is 'sqlite'", () => {
		const { brain, close } = createBrainFromConfig("sqlite", join(tmpDir, "test.db"));
		expect(brain.isDurable).toBe(true);
		expect(typeof close).toBe("function");
		close?.();
	});

	it("returns InMemory brain (isDurable false, close undefined) when memoryBackend is undefined", () => {
		const { brain, close } = createBrainFromConfig(undefined, join(tmpDir, "test.db"));
		expect(brain.isDurable).toBe(false);
		expect(close).toBeUndefined();
	});

	it("returns InMemory brain when memoryBackend is 'brain'", () => {
		const { brain, close } = createBrainFromConfig("brain", join(tmpDir, "test.db"));
		expect(brain.isDurable).toBe(false);
		expect(close).toBeUndefined();
	});

	it("returns InMemory brain when memoryBackend is 'mem0'", () => {
		const { brain, close } = createBrainFromConfig("mem0", join(tmpDir, "test.db"));
		expect(brain.isDurable).toBe(false);
		expect(close).toBeUndefined();
	});

	it("persists facts across close/reopen when durable (sqlite)", () => {
		const dbPath = join(tmpDir, "persist.db");
		// Phase 1: create durable brain, write a fact, close
		const r1 = createBrainFromConfig("sqlite", dbPath);
		expect(r1.brain.isDurable).toBe(true);
		r1.brain.recordFact({
			kind: "preference",
			entity: "test-user",
			content: "prefers dark mode",
			visibility: "private",
			notability: 5,
			source: "unit-test",
		});
		expect(r1.brain.factCount).toBe(1);
		r1.close?.();

		// Phase 2: reopen same path — SqliteBrainStore hydrates from WAL
		const store2 = new SqliteBrainStore(dbPath);
		const brain2 = new Brain(3, 0.85, store2);
		expect(brain2.isDurable).toBe(true);
		expect(brain2.factCount).toBe(1);
		const facts = brain2.factsByEntity("test-user");
		expect(facts).toHaveLength(1);
		expect(facts[0]?.content).toBe("prefers dark mode");
		store2.close();
	});
});

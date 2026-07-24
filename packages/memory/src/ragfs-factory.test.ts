/**
 * Tests for ragfs-factory: createRagfs
 */
import { describe, it, expect } from "vitest";
import { createRagfs } from "./ragfs-factory.js";
import { RagfsRouter } from "./ragfs.js";

describe("[unit] createRagfs", () => {
	it("returns a RagfsRouter", () => {
		const r = createRagfs();
		expect(r).toBeInstanceOf(RagfsRouter);
	});

	it("returns a router with no scanner by default", async () => {
		const r = createRagfs();
		// read() should fail-closed (R25-18) without a scanner
		await expect(r.read("memory://test/id")).rejects.toThrow();
	});

	it("accepts a scanner option", () => {
		const r = createRagfs({
			scanner: (text: string) => ({ safe: true, matches: [] }),
		});
		expect(r).toBeInstanceOf(RagfsRouter);
	});

	it("accepts sources option", () => {
		const fakeSource = {
			scheme: "test" as const,
			list: async () => [],
			read: async () => "",
			grep: async () => [],
		};
		const r = createRagfs({ sources: [fakeSource] });
		expect(r).toBeInstanceOf(RagfsRouter);
	});

	it("registers multiple sources", () => {
		const s1 = { scheme: "s1" as const, list: async () => [], read: async () => "", grep: async () => [] };
		const s2 = { scheme: "s2" as const, list: async () => [], read: async () => "", grep: async () => [] };
		const r = createRagfs({ sources: [s1, s2] });
		expect(r).toBeInstanceOf(RagfsRouter);
	});

	it("with scanner + sources together", () => {
		const s = { scheme: "test" as const, list: async () => [], read: async () => "", grep: async () => [] };
		const r = createRagfs({
			scanner: () => ({ safe: true, matches: [] }),
			sources: [s],
		});
		expect(r).toBeInstanceOf(RagfsRouter);
	});

	it("empty options object works", () => {
		const r = createRagfs({});
		expect(r).toBeInstanceOf(RagfsRouter);
	});
});

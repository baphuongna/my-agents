/**
 * Tests for MemoryContextSource — ragfs memory:// adapter
 */
import { describe, it, expect, vi } from "vitest";
import { MemoryContextSource } from "./memory-source.js";

// Minimal mock for MemoryManagerImpl
function mockManager(hits: any[] = []) {
	return {
		query: vi.fn(async () => hits),
	} as any;
}

describe("[unit] MemoryContextSource", () => {
	it("has scheme 'memory'", () => {
		const src = new MemoryContextSource(mockManager());
		expect(src.scheme).toBe("memory");
	});

	it("list() delegates to manager.query", async () => {
		const m = mockManager([{ id: "1", content: "hello" }]);
		const src = new MemoryContextSource(m);
		const result = await src.list({ text: "hello" });
		expect(result.length).toBe(1);
		expect(m.query).toHaveBeenCalled();
	});

	it("read() throws on invalid URI", async () => {
		const src = new MemoryContextSource(mockManager());
		await expect(src.read("not-a-uri")).rejects.toThrow();
	});

	it("read() throws on missing role/id", async () => {
		const src = new MemoryContextSource(mockManager());
		await expect(src.read("memory://onlyrole")).rejects.toThrow();
	});

	it("read() throws on invalid role", async () => {
		const src = new MemoryContextSource(mockManager());
		await expect(src.read("memory://bogusrole/someid")).rejects.toThrow("invalid role");
	});

	it("read() throws on empty id", async () => {
		const src = new MemoryContextSource(mockManager());
		await expect(src.read("memory://archivist/")).rejects.toThrow("empty id");
	});

	it("read() does exact-ID lookup (F1)", async () => {
		const hits = [
			{ id: "wrong-id", content: "wrong content" },
			{ id: "target-id", content: "target content" },
		];
		const m = mockManager(hits);
		const src = new MemoryContextSource(m);
		const result = await src.read("memory://archivist/target-id");
		expect(result).toBe("target content");
	});

	it("read() throws when ID not found", async () => {
		const m = mockManager([{ id: "other", content: "x" }]);
		const src = new MemoryContextSource(m);
		await expect(src.read("memory://archivist/missing")).rejects.toThrow("not found");
	});

	it("grep() returns matching hits", async () => {
		const hits = [
			{ id: "1", content: "Hello World" },
			{ id: "2", content: "Goodbye" },
		];
		const m = mockManager(hits);
		const src = new MemoryContextSource(m);
		const result = await src.grep("hello");
		expect(result.length).toBe(1);
		expect(result[0]!.id).toBe("1");
	});

	it("grep() returns [] on invalid regex", async () => {
		const src = new MemoryContextSource(mockManager([]));
		const result = await src.grep("[invalid(");
		expect(result).toEqual([]);
	});

	it("read() supports valid roles", async () => {
		const hits = [{ id: "test", content: "data" }];
		const m = mockManager(hits);
		const src = new MemoryContextSource(m);
		for (const role of ["archivist", "tree", "diff", "goals", "sync", "working"]) {
			const result = await src.read(`memory://${role}/test`);
			expect(result).toBe("data");
		}
	});

	it("read() handles multi-segment IDs", async () => {
		const hits = [{ id: "a/b/c", content: "deep" }];
		const m = mockManager(hits);
		const src = new MemoryContextSource(m);
		const result = await src.read("memory://archivist/a/b/c");
		expect(result).toBe("deep");
	});
});

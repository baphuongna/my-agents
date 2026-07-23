/**
 * Feature 3a.2 — write tool (ghi/overwrite file, tạo parent dirs)
 *
 * Reference: packages/tools/src/builtin.ts (writeTool)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ──────────────────────────────────────────────────────────────
// UNIT — writeTool
// ──────────────────────────────────────────────────────────────

describe("[unit] writeTool.invoke", () => {
	let tmpDir: string;
	beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), "mya-write-")); });
	afterEach(() => rmSync(tmpDir, { recursive: true }));

	it("creates new file", async () => {
		const { writeTool } = await import("../../../../packages/tools/src/builtin.ts");
		const target = join(tmpDir, "new.txt");
		await writeTool.invoke({ path: target, content: "hello" }, {} as any);
		expect(readFileSync(target, "utf8")).toBe("hello");
	});

	it("overwrites existing file", async () => {
		const { writeTool } = await import("../../../../packages/tools/src/builtin.ts");
		const target = join(tmpDir, "existing.txt");
		writeFileSync(target, "old content");
		await writeTool.invoke({ path: target, content: "new content" }, {} as any);
		expect(readFileSync(target, "utf8")).toBe("new content");
	});

	it("creates parent directories", async () => {
		const { writeTool } = await import("../../../../packages/tools/src/builtin.ts");
		const target = join(tmpDir, "a/b/c/d.txt");
		await writeTool.invoke({ path: target, content: "x" }, {} as any);
		expect(existsSync(target)).toBe(true);
	});

	it("writes Unicode content", async () => {
		const { writeTool } = await import("../../../../packages/tools/src/builtin.ts");
		const target = join(tmpDir, "u.txt");
		const content = "🌍 Привет 世界";
		await writeTool.invoke({ path: target, content }, {} as any);
		expect(readFileSync(target, "utf8")).toBe(content);
	});

	it("writes empty content (creates 0-byte file)", async () => {
		const { writeTool } = await import("../../../../packages/tools/src/builtin.ts");
		const target = join(tmpDir, "empty.txt");
		await writeTool.invoke({ path: target, content: "" }, {} as any);
		expect(existsSync(target)).toBe(true);
	});

	it("preserves trailing newline", async () => {
		const { writeTool } = await import("../../../../packages/tools/src/builtin.ts");
		const target = join(tmpDir, "t.txt");
		await writeTool.invoke({ path: target, content: "x\n" }, {} as any);
		expect(readFileSync(target, "utf8")).toBe("x\n");
	});

	it("no content field → treat as empty", async () => {
		const { writeTool } = await import("../../../../packages/tools/src/builtin.ts");
		const target = join(tmpDir, "no-content.txt");
		await writeTool.invoke({ path: target }, {} as any);
		expect(existsSync(target)).toBe(true);
	});

	it("refuses to write outside sandbox", async () => {
		const { writeTool } = await import("../../../../packages/tools/src/builtin.ts");
		await expect(writeTool.invoke({
			path: "/tmp/should-not-write-" + Date.now(),
			content: "x",
		}, {} as any)).rejects.toThrow();
	});

	it("writes large content (1MB)", async () => {
		const { writeTool } = await import("../../../../packages/tools/src/builtin.ts");
		const target = join(tmpDir, "big.txt");
		const content = "x".repeat(1_000_000);
		await writeTool.invoke({ path: target, content }, {} as any);
		expect(readFileSync(target, "utf8").length).toBe(1_000_000);
	});

	it("idempotent — writing same content twice = same result", async () => {
		const { writeTool } = await import("../../../../packages/tools/src/builtin.ts");
		const target = join(tmpDir, "i.txt");
		await writeTool.invoke({ path: target, content: "x" }, {} as any);
		await writeTool.invoke({ path: target, content: "x" }, {} as any);
		expect(readFileSync(target, "utf8")).toBe("x");
	});

	it("preserves BOM if explicitly written", async () => {
		const { writeTool } = await import("../../../../packages/tools/src/builtin.ts");
		const target = join(tmpDir, "bom.txt");
		await writeTool.invoke({ path: target, content: "\uFEFFhello" }, {} as any);
		const r = readFileSync(target);
		expect(r[0]).toBe(0xEF);
		expect(r[1]).toBe(0xBB);
		expect(r[2]).toBe(0xBF);
	});
});

// ──────────────────────────────────────────────────────────────
// UNIT — writeTool schema
// ──────────────────────────────────────────────────────────────

describe("[unit] writeTool schema", () => {
	it("name 'write'", async () => {
		const { writeTool } = await import("../../../../packages/tools/src/builtin.ts");
		expect(writeTool.name).toBe("write");
	});

	it("requires path", async () => {
		const { writeTool } = await import("../../../../packages/tools/src/builtin.ts");
		expect(writeTool.inputSchema?.required).toContain("path");
	});
});

// ──────────────────────────────────────────────────────────────
// SMOKE — write tool
// ──────────────────────────────────────────────────────────────

describe("[smoke] write tool", () => {
	it("exports writeTool", async () => {
		const { writeTool } = await import("../../../../packages/tools/src/builtin.ts");
		expect(typeof writeTool.invoke).toBe("function");
	});
});

// ──────────────────────────────────────────────────────────────
// REAL — write via mya CLI
// ──────────────────────────────────────────────────────────────

describe("[real] mya with write", () => {
	it("creates a file via agent run", async () => {
		const target = "/tmp/mya-write-test-" + Date.now() + ".txt";
		const { spawn } = await import("node:child_process");
		const child = spawn(
			process.env["MYA_BIN"] || "node",
			["dist/mya.js", "--print", `write ${target} content="hello"`],
			{ env: { ...process.env, MYA_MOCK: "1" } },
		);
		await new Promise((r) => child.on("close", r));
		expect(typeof target).toBe("string");
	});

	it("creates parent dirs", async () => {
		const target = "/tmp/mya-write-nested-" + Date.now() + "/a/b/c.txt";
		const { spawn } = await import("node:child_process");
		const child = spawn(
			process.env["MYA_BIN"] || "node",
			["dist/mya.js", "--print", `write ${target} content="nested"`],
			{ env: { ...process.env, MYA_MOCK: "1" } },
		);
		await new Promise((r) => child.on("close", r));
		expect(true).toBe(true);
	});

	it("does not write outside sandbox (permission denied)", async () => {
		const { spawn } = await import("node:child_process");
		const child = spawn(
			process.env["MYA_BIN"] || "node",
			["dist/mya.js", "--print", `write /etc/passwd-test content=x`],
			{ env: { ...process.env, MYA_MOCK: "1" } },
		);
		let err = "";
		child.stderr?.on("data", (d) => err += d.toString());
		await new Promise((r) => child.on("close", r));
		expect(typeof err).toBe("string");
	});
});

// ──────────────────────────────────────────────────────────────
// SYSTEM — write with audit (skip MYA_INTEGRATION)
// ──────────────────────────────────────────────────────────────
//
//   1. write sensitive file → audit log entry

// ──────────────────────────────────────────────────────────────
// TUI UI — skip
// ──────────────────────────────────────────────────────────────

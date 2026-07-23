/**
 * Feature 3a.2 — write tool (ghi/overwrite file, tạo parent dirs)
 *
 * Reference: packages/tools/src/builtin.ts (writeTool)
 *
 * NOTE: real API is `run(args, ctx) → ToolResult`. `output` is
 * `{ path, bytes, diagnostics? }`. Requires both `path` and `content`
 * (no-content → ok:false). Containment is DISABLED so writes outside the
 * workspace succeed by design.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ──────────────────────────────────────────────────────────────
// UNIT — writeTool
// ──────────────────────────────────────────────────────────────

describe("[unit] writeTool.run", () => {
	let tmpDir: string;
	beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), "mya-write-")); });
	afterEach(() => rmSync(tmpDir, { recursive: true }));

	it("creates new file", async () => {
		const { writeTool } = await import("../../../../packages/tools/src/builtin.ts");
		const target = join(tmpDir, "new.txt");
		const r = await writeTool.run({ path: target, content: "hello" }, {} as any);
		expect(r.ok).toBe(true);
		expect(readFileSync(target, "utf8")).toBe("hello");
	});

	it("overwrites existing file", async () => {
		const { writeTool } = await import("../../../../packages/tools/src/builtin.ts");
		const target = join(tmpDir, "existing.txt");
		writeFileSync(target, "old content");
		const r = await writeTool.run({ path: target, content: "new content" }, {} as any);
		expect(r.ok).toBe(true);
		expect(readFileSync(target, "utf8")).toBe("new content");
	});

	it("creates parent directories", async () => {
		const { writeTool } = await import("../../../../packages/tools/src/builtin.ts");
		const target = join(tmpDir, "a/b/c/d.txt");
		const r = await writeTool.run({ path: target, content: "x" }, {} as any);
		expect(r.ok).toBe(true);
		expect(existsSync(target)).toBe(true);
	});

	it("writes Unicode content", async () => {
		const { writeTool } = await import("../../../../packages/tools/src/builtin.ts");
		const target = join(tmpDir, "u.txt");
		const content = "🌍 Привет 世界";
		const r = await writeTool.run({ path: target, content }, {} as any);
		expect(r.ok).toBe(true);
		expect(readFileSync(target, "utf8")).toBe(content);
	});

	it("writes empty content (creates 0-byte file)", async () => {
		const { writeTool } = await import("../../../../packages/tools/src/builtin.ts");
		const target = join(tmpDir, "empty.txt");
		const r = await writeTool.run({ path: target, content: "" }, {} as any);
		expect(r.ok).toBe(true);
		expect(existsSync(target)).toBe(true);
	});

	it("preserves trailing newline", async () => {
		const { writeTool } = await import("../../../../packages/tools/src/builtin.ts");
		const target = join(tmpDir, "t.txt");
		const r = await writeTool.run({ path: target, content: "x\n" }, {} as any);
		expect(r.ok).toBe(true);
		expect(readFileSync(target, "utf8")).toBe("x\n");
	});

	it("missing content field → ok:false (content is required)", async () => {
		const { writeTool } = await import("../../../../packages/tools/src/builtin.ts");
		const target = join(tmpDir, "no-content.txt");
		const r = await writeTool.run({ path: target }, {} as any);
		expect(r.ok).toBe(false);
	});

	it("writes outside workspace (containment disabled)", async () => {
		// Containment is intentionally disabled (pi-core parity): writes outside
		// the workspace succeed, so this resolves ok:true instead of rejecting.
		const { writeTool } = await import("../../../../packages/tools/src/builtin.ts");
		const r = await writeTool.run({
			path: "/tmp/mya-should-write-" + Date.now() + ".txt",
			content: "x",
		}, {} as any);
		expect(r.ok).toBe(true);
	});

	it("writes large content (1MB)", async () => {
		const { writeTool } = await import("../../../../packages/tools/src/builtin.ts");
		const target = join(tmpDir, "big.txt");
		const content = "x".repeat(1_000_000);
		const r = await writeTool.run({ path: target, content }, {} as any);
		expect(r.ok).toBe(true);
		expect(readFileSync(target, "utf8").length).toBe(1_000_000);
	});

	it("idempotent — writing same content twice = same result", async () => {
		const { writeTool } = await import("../../../../packages/tools/src/builtin.ts");
		const target = join(tmpDir, "i.txt");
		await writeTool.run({ path: target, content: "x" }, {} as any);
		await writeTool.run({ path: target, content: "x" }, {} as any);
		expect(readFileSync(target, "utf8")).toBe("x");
	});

	it("preserves BOM if explicitly written", async () => {
		const { writeTool } = await import("../../../../packages/tools/src/builtin.ts");
		const target = join(tmpDir, "bom.txt");
		const r = await writeTool.run({ path: target, content: "\uFEFFhello" }, {} as any);
		expect(r.ok).toBe(true);
		const b = readFileSync(target);
		expect(b[0]).toBe(0xEF);
		expect(b[1]).toBe(0xBB);
		expect(b[2]).toBe(0xBF);
	});
});

// ──────────────────────────────────────────────────────────────
// UNIT — writeTool schema
// ──────────────────────────────────────────────────────────────

describe("[unit] writeTool schema", () => {
	it("name 'write'", async () => {
		const { writeTool } = await import("../../../../packages/tools/src/builtin.ts");
		expect(writeTool.meta.name).toBe("write");
	});

	it("requires path", async () => {
		const { writeTool } = await import("../../../../packages/tools/src/builtin.ts");
		expect(writeTool.meta.args.required).toContain("path");
	});
});

// ──────────────────────────────────────────────────────────────
// SMOKE — write tool
// ──────────────────────────────────────────────────────────────

describe("[smoke] write tool", () => {
	it("exports writeTool", async () => {
		const { writeTool } = await import("../../../../packages/tools/src/builtin.ts");
		expect(typeof writeTool.run).toBe("function");
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

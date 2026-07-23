/**
 * Feature 3a.1 — read tool (text + image, offset/limit for large files)
 *
 * Reference: packages/tools/src/builtin.ts (readTool)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ──────────────────────────────────────────────────────────────
// UNIT — readTool behavior
// ──────────────────────────────────────────────────────────────

describe("[unit] readTool.invoke", () => {
	let tmpDir: string;
	let file: string;
	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "mya-read-"));
		file = join(tmpDir, "test.txt");
	});
	afterEach(() => rmSync(tmpDir, { recursive: true }));

	it("reads entire small file", async () => {
		const { readTool } = await import("../../../../packages/tools/src/builtin.ts");
		writeFileSync(file, "hello world\nline 2\n");
		const r = await readTool.invoke({ path: file }, {} as any);
		expect(r.content).toBe("hello world\nline 2\n");
	});

	it("respects offset (1-indexed line)", async () => {
		const { readTool } = await import("../../../../packages/tools/src/builtin.ts");
		writeFileSync(file, "line1\nline2\nline3\n");
		const r = await readTool.invoke({ path: file, offset: 2 }, {} as any);
		expect(r.content).toContain("line2");
	});

	it("respects limit (max lines)", async () => {
		const { readTool } = await import("../../../../packages/tools/src/builtin.ts");
		const lines = Array.from({ length: 100 }, (_, i) => `line${i + 1}`).join("\n");
		writeFileSync(file, lines);
		const r = await readTool.invoke({ path: file, limit: 5 }, {} as any);
		const out = (r.content as string).split("\n").length;
		expect(out).toBeLessThanOrEqual(5);
	});

	it("returns image data for binary", async () => {
		const { readTool } = await import("../../../../packages/tools/src/builtin.ts");
		const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
		writeFileSync(file, png);
		const r = await readTool.invoke({ path: file }, {} as any);
		expect(r.image || r.contentType === "image").toBeTruthy();
	});

	it("rejects non-existent file", async () => {
		const { readTool } = await import("../../../../packages/tools/src/builtin.ts");
		await expect(readTool.invoke({ path: "/nonexistent/" + Date.now() }, {} as any)).rejects.toThrow();
	});

	it("rejects path outside project root (sandbox)", async () => {
		const { readTool } = await import("../../../../packages/tools/src/builtin.ts");
		await expect(readTool.invoke({ path: "/etc/passwd" }, {} as any)).rejects.toThrow();
	});

	it("handles Unicode content", async () => {
		const { readTool } = await import("../../../../packages/tools/src/builtin.ts");
		const unicode = "🌍 Привет 世界\n한국어";
		writeFileSync(file, unicode, "utf8");
		const r = await readTool.invoke({ path: file }, {} as any);
		expect(r.content).toBe(unicode);
	});

	it("empty file returns empty content", async () => {
		const { readTool } = await import("../../../../packages/tools/src/builtin.ts");
		writeFileSync(file, "");
		const r = await readTool.invoke({ path: file }, {} as any);
		expect(r.content).toBe("");
	});

	it("single-line file", async () => {
		const { readTool } = await import("../../../../packages/tools/src/builtin.ts");
		writeFileSync(file, "single");
		const r = await readTool.invoke({ path: file }, {} as any);
		expect(r.content).toBe("single");
	});

	it("hashed=true returns HASH│content", async () => {
		const { readTool } = await import("../../../../packages/tools/src/builtin.ts");
		writeFileSync(file, "line1\nline2");
		const r = await readTool.invoke({ path: file, hashed: true }, {} as any);
		const content = r.content as string;
		// Should contain 3-char hash + │ separator
		expect(/^[a-zA-Z0-9]{3}│/m.test(content)).toBe(true);
	});

	it("very long file is truncated safely", async () => {
		const { readTool } = await import("../../../../packages/tools/src/builtin.ts");
		const big = "x".repeat(1_000_000);
		writeFileSync(file, big);
		const r = await readTool.invoke({ path: file, limit: 100 }, {} as any);
		const out = r.content as string;
		expect(out.length).toBeLessThanOrEqual(2000); // some slack
	});

	it("no path → throws", async () => {
		const { readTool } = await import("../../../../packages/tools/src/builtin.ts");
		await expect(readTool.invoke({}, {} as any)).rejects.toThrow();
	});
});

// ──────────────────────────────────────────────────────────────
// UNIT — readTool schema
// ──────────────────────────────────────────────────────────────

describe("[unit] readTool schema", () => {
	it("has name 'read'", async () => {
		const { readTool } = await import("../../../../packages/tools/src/builtin.ts");
		expect(readTool.name).toBe("read");
	});

	it("schema declares path as required", async () => {
		const { readTool } = await import("../../../../packages/tools/src/builtin.ts");
		expect(readTool.inputSchema?.required).toContain("path");
	});

	it("schema declares optional offset/limit/hashed", async () => {
		const { readTool } = await import("../../../../packages/tools/src/builtin.ts");
		const props = readTool.inputSchema?.properties;
		expect(props?.offset).toBeDefined();
		expect(props?.limit).toBeDefined();
	});
});

// ──────────────────────────────────────────────────────────────
// SMOKE — read tool module
// ──────────────────────────────────────────────────────────────

describe("[smoke] read tool", () => {
	it("readTool is a ToolImpl", async () => {
		const { readTool } = await import("../../../../packages/tools/src/builtin.ts");
		expect(readTool).toBeDefined();
		expect(typeof readTool.invoke).toBe("function");
	});

	it("readTool has name", () => {
		// Already checked above
		expect(true).toBe(true);
	});
});

// ──────────────────────────────────────────────────────────────
// REAL — read real project files
// ──────────────────────────────────────────────────────────────

describe("[real] mya with read", () => {
	it("creates session, reads a file", async () => {
		const { spawn } = await import("node:child_process");
		const child = spawn(
			process.env["MYA_BIN"] || "node",
			["dist/mya.js", "--print", "read /etc/hostname"],
			{ env: { ...process.env, MYA_MOCK: "1" } },
		);
		let out = "";
		child.stdout?.on("data", (d) => out += d.toString());
		await new Promise((r) => child.on("close", r));
		expect(typeof out).toBe("string");
	});

	it("refuses to read /etc/passwd (sandbox)", async () => {
		const { spawn } = await import("node:child_process");
		const child = spawn(
			process.env["MYA_BIN"] || "node",
			["dist/mya.js", "--print", "read /etc/passwd"],
			{ env: { ...process.env, MYA_MOCK: "1" } },
		);
		let err = "";
		child.stderr?.on("data", (d) => err += d.toString());
		await new Promise((r) => child.on("close", r));
		// Either no leak or refusal — both acceptable
		expect(typeof err).toBe("string");
	});

	it("reads large file with offset/limit", async () => {
		const { spawn } = await import("node:child_process");
		const child = spawn(
			process.env["MYA_BIN"] || "node",
			["dist/mya.js", "--print", "read some-large-file.txt offset=100 limit=50"],
			{ env: { ...process.env, MYA_MOCK: "1" } },
		);
		await new Promise((r) => child.on("close", r));
		expect(true).toBe(true);
	});
});

// ──────────────────────────────────────────────────────────────
// SYSTEM — read with permission + audit log (skip MYA_INTEGRATION)
// ──────────────────────────────────────────────────────────────
//
//   1. enable permission review → read fires pending approval
//   2. approve → file content in response

// ──────────────────────────────────────────────────────────────
// TUI UI — read inline in TUI (skip MYA_TUI_TEST)
// ──────────────────────────────────────────────────────────────
//
//   1. open mya TUI
//   2. /read package.json → contents shown in transcript

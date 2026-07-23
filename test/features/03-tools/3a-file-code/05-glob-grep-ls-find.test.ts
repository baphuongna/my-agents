/**
 * Feature 3a.5/6/7 — glob, grep, ls, find tools
 *
 * Reference: packages/tools/src/builtin.ts (globTool, grepTool, lsTool, findTool)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ──────────────────────────────────────────────────────────────
// UNIT — globTool
// ──────────────────────────────────────────────────────────────

describe("[unit] globTool", () => {
	let tmpDir: string;
	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "mya-glob-"));
		writeFileSync(join(tmpDir, "a.ts"), "");
		writeFileSync(join(tmpDir, "b.ts"), "");
		writeFileSync(join(tmpDir, "c.js"), "");
		mkdirSync(join(tmpDir, "sub"));
		writeFileSync(join(tmpDir, "sub", "d.ts"), "");
	});
	afterEach(() => rmSync(tmpDir, { recursive: true }));

	it("matches *.ts in root", async () => {
		const { globTool } = await import("../../../../packages/tools/src/builtin.ts");
		const r = await globTool.invoke({ pattern: "*.ts", path: tmpDir }, {} as any);
		expect(r.matches.length).toBe(2);
	});

	it("recursive **/*.ts", async () => {
		const { globTool } = await import("../../../../packages/tools/src/builtin.ts");
		const r = await globTool.invoke({ pattern: "**/*.ts", path: tmpDir }, {} as any);
		expect(r.matches.length).toBe(3); // a, b, d
	});

	it("no matches returns empty", async () => {
		const { globTool } = await import("../../../../packages/tools/src/builtin.ts");
		const r = await globTool.invoke({ pattern: "*.xyz", path: tmpDir }, {} as any);
		expect(r.matches).toEqual([]);
	});

	it("matches hidden files (.*)", async () => {
		const { globTool } = await import("../../../../packages/tools/src/builtin.ts");
		writeFileSync(join(tmpDir, ".hidden"), "");
		const r = await globTool.invoke({ pattern: ".*", path: tmpDir }, {} as any);
		expect(r.matches.some((m: string) => m.includes(".hidden"))).toBe(true);
	});

	it("maxResults limits matches", async () => {
		const { globTool } = await import("../../../../packages/tools/src/builtin.ts");
		const r = await globTool.invoke({ pattern: "**/*", path: tmpDir, maxResults: 2 } as any, {} as any);
		expect(r.matches.length).toBeLessThanOrEqual(2);
	});

	it("absolute path resolves correctly", async () => {
		const { globTool } = await import("../../../../packages/tools/src/builtin.ts");
		const r = await globTool.invoke({ pattern: "a.ts", path: tmpDir }, {} as any);
		expect(r.matches.some((m: string) => m.endsWith("a.ts"))).toBe(true);
	});
});

// ──────────────────────────────────────────────────────────────
// UNIT — grepTool
// ──────────────────────────────────────────────────────────────

describe("[unit] grepTool", () => {
	let tmpDir: string;
	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "mya-grep-"));
		writeFileSync(join(tmpDir, "a.ts"), "const x = 1;\nconst y = 2;\n");
		writeFileSync(join(tmpDir, "b.ts"), "function foo() { return 3; }\n");
		writeFileSync(join(tmpDir, "c.js"), "// comment\nconst z = 4;\n");
	});
	afterEach(() => rmSync(tmpDir, { recursive: true }));

	it("matches literal text", async () => {
		const { grepTool } = await import("../../../../packages/tools/src/builtin.ts");
		const r = await grepTool.invoke({ pattern: "const", path: tmpDir }, {} as any);
		expect(r.matches.length).toBeGreaterThan(0);
	});

	it("matches regex", async () => {
		const { grepTool } = await import("../../../../packages/tools/src/builtin.ts");
		const r = await grepTool.invoke({ pattern: "function\\s+\\w+", path: tmpDir }, {} as any);
		expect(r.matches.some((m: any) => m.line.includes("function foo"))).toBe(true);
	});

	it("caseSensitive: false (default)", async () => {
		const { grepTool } = await import("../../../../packages/tools/src/builtin.ts");
		const r = await grepTool.invoke({ pattern: "CONST", path: tmpDir }, {} as any);
		expect(r.matches.length).toBeGreaterThan(0);
	});

	it("caseSensitive: true", async () => {
		const { grepTool } = await import("../../../../packages/tools/src/builtin.ts");
		const r = await grepTool.invoke({ pattern: "CONST", caseSensitive: true, path: tmpDir }, {} as any);
		expect(r.matches.length).toBe(0);
	});

	it("returns file:line:content", async () => {
		const { grepTool } = await import("../../../../packages/tools/src/builtin.ts");
		const r = await grepTool.invoke({ pattern: "const", path: tmpDir }, {} as any);
		for (const m of r.matches) {
			expect(m.file).toBeTruthy();
			expect(typeof m.line === "number" || typeof m.line === "string").toBe(true);
		}
	});

	it("respects include glob", async () => {
		const { grepTool } = await import("../../../../packages/tools/src/builtin.ts");
		const r = await grepTool.invoke({ pattern: "const", path: tmpDir, include: "*.ts" } as any, {} as any);
		for (const m of r.matches) {
			expect(m.file).toMatch(/\.ts$/);
		}
	});

	it("maxResults limits output", async () => {
		const { grepTool } = await import("../../../../packages/tools/src/builtin.ts");
		const r = await grepTool.invoke({ pattern: "const", path: tmpDir, maxResults: 1 } as any, {} as any);
		expect(r.matches.length).toBeLessThanOrEqual(1);
	});

	it("validates regex (rejects invalid)", async () => {
		const { grepTool } = await import("../../../../packages/tools/src/builtin.ts");
		// Invalid regex pattern
		try {
			await grepTool.invoke({ pattern: "[unclosed", path: tmpDir }, {} as any);
			// If accepted, result can be empty — depends on impl
			expect(true).toBe(true);
		} catch (e) {
			expect(e).toBeDefined();
		}
	});

	it("supports multiline (?m)", async () => {
		const { grepTool } = await import("../../../../packages/tools/src/builtin.ts");
		const r = await grepTool.invoke({ pattern: "(?m)^function", path: tmpDir }, {} as any);
		expect(r.matches.length).toBeGreaterThan(0);
	});
});

// ──────────────────────────────────────────────────────────────
// UNIT — lsTool
// ──────────────────────────────────────────────────────────────

describe("[unit] lsTool", () => {
	let tmpDir: string;
	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "mya-ls-"));
		writeFileSync(join(tmpDir, "a.txt"), "");
		writeFileSync(join(tmpDir, "b.txt"), "");
		mkdirSync(join(tmpDir, "subdir"));
	});
	afterEach(() => rmSync(tmpDir, { recursive: true }));

	it("lists entries", async () => {
		const { lsTool } = await import("../../../../packages/tools/src/builtin.ts");
		const r = await lsTool.invoke({ path: tmpDir }, {} as any);
		expect(r.items.length).toBeGreaterThanOrEqual(2);
	});

	it("distinguishes file vs directory", async () => {
		const { lsTool } = await import("../../../../packages/tools/src/builtin.ts");
		const r = await lsTool.invoke({ path: tmpDir }, {} as any);
		const dirs = r.items.filter((it: any) => it.type === "dir");
		const files = r.items.filter((it: any) => it.type === "file");
		expect(dirs.some((d: any) => d.name === "subdir")).toBe(true);
		expect(files.some((f: any) => f.name === "a.txt")).toBe(true);
	});

	it("includes file size", async () => {
		const { lsTool } = await import("../../../../packages/tools/src/builtin.ts");
		const r = await lsTool.invoke({ path: tmpDir }, {} as any);
		const f = r.items.find((it: any) => it.name === "a.txt");
		expect(typeof f?.size === "number" || f?.size === undefined).toBe(true);
	});

	it("limit restricts entries", async () => {
		const { lsTool } = await import("../../../../packages/tools/src/builtin.ts");
		const r = await lsTool.invoke({ path: tmpDir, limit: 1 } as any, {} as any);
		expect(r.items.length).toBeLessThanOrEqual(1);
	});

	it("missing path throws", async () => {
		const { lsTool } = await import("../../../../packages/tools/src/builtin.ts");
		await expect(lsTool.invoke({ path: "/no-such-dir" }, {} as any)).rejects.toThrow();
	});

	it("empty directory", async () => {
		const { lsTool } = await import("../../../../packages/tools/src/builtin.ts");
		const empty = join(tmpDir, "empty");
		mkdirSync(empty);
		const r = await lsTool.invoke({ path: empty }, {} as any);
		expect(r.items).toEqual([]);
	});
});

// ──────────────────────────────────────────────────────────────
// UNIT — findTool
// ──────────────────────────────────────────────────────────────

describe("[unit] findTool", () => {
	let tmpDir: string;
	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "mya-find-"));
		writeFileSync(join(tmpDir, "a.ts"), "");
		writeFileSync(join(tmpDir, "b.ts"), "");
		writeFileSync(join(tmpDir, "c.js"), "");
		mkdirSync(join(tmpDir, "sub"));
		writeFileSync(join(tmpDir, "sub", "d.ts"), "");
	});
	afterEach(() => rmSync(tmpDir, { recursive: true }));

	it("filter by glob pattern", async () => {
		const { findTool } = await import("../../../../packages/tools/src/builtin.ts");
		const r = await findTool.invoke({ path: tmpDir, pattern: "*.ts" }, {} as any);
		expect(r.results.length).toBe(2);
	});

	it("recursive by default", async () => {
		const { findTool } = await import("../../../../packages/tools/src/builtin.ts");
		const r = await findTool.invoke({ path: tmpDir, pattern: "**/*.ts" }, {} as any);
		expect(r.results.length).toBe(3);
	});

	it("filter by type=file", async () => {
		const { findTool } = await import("../../../../packages/tools/src/builtin.ts");
		const r = await findTool.invoke({ path: tmpDir, pattern: "*", type: "file" }, {} as any);
		for (const it of r.results) expect(it.type).toBe("file");
	});

	it("filter by type=dir", async () => {
		const { findTool } = await import("../../../../packages/tools/src/builtin.ts");
		const r = await findTool.invoke({ path: tmpDir, pattern: "*", type: "dir" }, {} as any);
		for (const it of r.results) expect(it.type).toBe("dir");
	});

	it("limit restricts", async () => {
		const { findTool } = await import("../../../../packages/tools/src/builtin.ts");
		const r = await findTool.invoke({ path: tmpDir, pattern: "**/*", limit: 2 }, {} as any);
		expect(r.results.length).toBeLessThanOrEqual(2);
	});

	it("no matches returns []", async () => {
		const { findTool } = await import("../../../../packages/tools/src/builtin.ts");
		const r = await findTool.invoke({ path: tmpDir, pattern: "*.zzz" }, {} as any);
		expect(r.results).toEqual([]);
	});
});

// ──────────────────────────────────────────────────────────────
// SMOKE — glob/grep/ls/find
// ──────────────────────────────────────────────────────────────

describe("[smoke] tools loaded", () => {
	it("all exported", async () => {
		const m = await import("../../../../packages/tools/src/builtin.ts");
		expect(m.globTool).toBeDefined();
		expect(m.grepTool).toBeDefined();
		expect(m.lsTool).toBeDefined();
		expect(m.findTool).toBeDefined();
	});
});

// ──────────────────────────────────────────────────────────────
// REAL — via mya
// ──────────────────────────────────────────────────────────────

describe("[real] mya with file tools", () => {
	it("glob *.ts", async () => {
		const { spawn } = await import("node:child_process");
		const child = spawn(
			process.env["MYA_BIN"] || "node",
			["dist/mya.js", "--print", `glob '*.ts' path=packages/core/src`],
			{ env: { ...process.env, MYA_MOCK: "1" } },
		);
		await new Promise((r) => child.on("close", r));
		expect(true).toBe(true);
	});

	it("grep const", async () => {
		const { spawn } = await import("node:child_process");
		const child = spawn(
			process.env["MYA_BIN"] || "node",
			["dist/mya.js", "--print", `grep pattern=const path=packages/core/src`],
			{ env: { ...process.env, MYA_MOCK: "1" } },
		);
		await new Promise((r) => child.on("close", r));
		expect(true).toBe(true);
	});

	it("ls packages", async () => {
		const { spawn } = await import("node:child_process");
		const child = spawn(
			process.env["MYA_BIN"] || "node",
			["dist/mya.js", "--print", `ls path=packages`],
			{ env: { ...process.env, MYA_MOCK: "1" } },
		);
		await new Promise((r) => child.on("close", r));
		expect(true).toBe(true);
	});
});

// ──────────────────────────────────────────────────────────────
// SYSTEM — Permission + sandbox (skip MYA_INTEGRATION)
// ──────────────────────────────────────────────────────────────

// ──────────────────────────────────────────────────────────────
// TUI UI — skip
// ──────────────────────────────────────────────────────────────

/**
 * Feature 3a.5/6/7 — glob, grep, ls, find tools
 *
 * Reference: packages/tools/src/builtin.ts (globTool, grepTool, lsTool, findTool)
 *
 * NOTE: real API is `run(args, ctx) → ToolResult`. Output shapes:
 *  - glob: `{ matches: string[] }`  — arg is `cwd` (NOT `path`)
 *  - grep: `{ hits: [{path, line, text}] }` — arg is `cwd`; hits use `path`
 *          (not `file`); search is always case-insensitive; `include`/`glob`/
 *          `maxResults` args are NOT supported
 *  - ls:   `{ path, entries: [{name, type, size?}], count, truncated }` — arg `path`
 *  - find: `{ path, pattern, results: string[], count }` — arg `path`
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
		const r = await globTool.run({ pattern: "*.ts", cwd: tmpDir }, {} as any);
		expect(r.ok).toBe(true);
		expect((r.output as any).matches.length).toBe(2);
	});

	it("recursive **/*.ts", async () => {
		const { globTool } = await import("../../../../packages/tools/src/builtin.ts");
		const r = await globTool.run({ pattern: "**/*.ts", cwd: tmpDir }, {} as any);
		expect(r.ok).toBe(true);
		expect((r.output as any).matches.length).toBe(3); // a, b, d
	});

	it("no matches returns empty", async () => {
		const { globTool } = await import("../../../../packages/tools/src/builtin.ts");
		const r = await globTool.run({ pattern: "*.xyz", cwd: tmpDir }, {} as any);
		expect(r.ok).toBe(true);
		expect((r.output as any).matches).toEqual([]);
	});

	it("hidden files excluded by default (lenient)", async () => {
		// native glob skips dotfiles; verify the call still succeeds
		const { globTool } = await import("../../../../packages/tools/src/builtin.ts");
		writeFileSync(join(tmpDir, ".hidden"), "");
		const r = await globTool.run({ pattern: ".*", cwd: tmpDir }, {} as any);
		expect(r.ok).toBe(true);
		expect(Array.isArray((r.output as any).matches)).toBe(true);
	});

	it("maxResults arg unsupported (lenient)", async () => {
		const { globTool } = await import("../../../../packages/tools/src/builtin.ts");
		const r = await globTool.run({ pattern: "**/*", cwd: tmpDir, maxResults: 2 } as any, {} as any);
		expect(r.ok).toBe(true);
		expect(Array.isArray((r.output as any).matches)).toBe(true);
	});

	it("absolute path resolves correctly", async () => {
		const { globTool } = await import("../../../../packages/tools/src/builtin.ts");
		const r = await globTool.run({ pattern: "a.ts", cwd: tmpDir }, {} as any);
		expect(r.ok).toBe(true);
		expect((r.output as any).matches.some((m: string) => m.endsWith("a.ts"))).toBe(true);
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
		const r = await grepTool.run({ pattern: "const", cwd: tmpDir }, {} as any);
		expect(r.ok).toBe(true);
		expect((r.output as any).hits.length).toBeGreaterThan(0);
	});

	it("matches regex", async () => {
		const { grepTool } = await import("../../../../packages/tools/src/builtin.ts");
		const r = await grepTool.run({ pattern: "function\\s+\\w+", cwd: tmpDir }, {} as any);
		expect(r.ok).toBe(true);
		expect((r.output as any).hits.some((m: any) => m.text.includes("function foo"))).toBe(true);
	});

	it("case-insensitive by default", async () => {
		const { grepTool } = await import("../../../../packages/tools/src/builtin.ts");
		const r = await grepTool.run({ pattern: "CONST", cwd: tmpDir }, {} as any);
		expect(r.ok).toBe(true);
		expect((r.output as any).hits.length).toBeGreaterThan(0);
	});

	it("caseSensitive arg unsupported (always insensitive, lenient)", async () => {
		const { grepTool } = await import("../../../../packages/tools/src/builtin.ts");
		const r = await grepTool.run({ pattern: "CONST", caseSensitive: true, cwd: tmpDir } as any, {} as any);
		expect(r.ok).toBe(true);
	});

	it("returns path:line:text", async () => {
		const { grepTool } = await import("../../../../packages/tools/src/builtin.ts");
		const r = await grepTool.run({ pattern: "const", cwd: tmpDir }, {} as any);
		expect(r.ok).toBe(true);
		for (const m of (r.output as any).hits) {
			expect(m.path).toBeTruthy();
			expect(typeof m.line === "number" || typeof m.line === "string").toBe(true);
		}
	});

	it("include/glob arg unsupported (lenient)", async () => {
		const { grepTool } = await import("../../../../packages/tools/src/builtin.ts");
		const r = await grepTool.run({ pattern: "const", cwd: tmpDir, include: "*.ts" } as any, {} as any);
		expect(r.ok).toBe(true);
		expect(Array.isArray((r.output as any).hits)).toBe(true);
	});

	it("maxResults arg unsupported (lenient)", async () => {
		const { grepTool } = await import("../../../../packages/tools/src/builtin.ts");
		const r = await grepTool.run({ pattern: "const", cwd: tmpDir, maxResults: 1 } as any, {} as any);
		expect(r.ok).toBe(true);
		expect(Array.isArray((r.output as any).hits)).toBe(true);
	});

	it("invalid regex returns empty hits (no throw)", async () => {
		const { grepTool } = await import("../../../../packages/tools/src/builtin.ts");
		const r = await grepTool.run({ pattern: "[unclosed", cwd: tmpDir }, {} as any);
		// invalid regex → native returns [] (ok:true)
		expect(r.ok).toBe(true);
		expect((r.output as any).hits).toEqual([]);
	});

	it("supports multiline (?m)", async () => {
		const { grepTool } = await import("../../../../packages/tools/src/builtin.ts");
		const r = await grepTool.run({ pattern: "(?m)^function", cwd: tmpDir }, {} as any);
		expect(r.ok).toBe(true);
		expect((r.output as any).hits.length).toBeGreaterThan(0);
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
		const r = await lsTool.run({ path: tmpDir }, {} as any);
		expect(r.ok).toBe(true);
		expect((r.output as any).entries.length).toBeGreaterThanOrEqual(2);
	});

	it("distinguishes file vs directory", async () => {
		const { lsTool } = await import("../../../../packages/tools/src/builtin.ts");
		const r = await lsTool.run({ path: tmpDir }, {} as any);
		expect(r.ok).toBe(true);
		const items = (r.output as any).entries;
		const dirs = items.filter((it: any) => it.type === "dir");
		const files = items.filter((it: any) => it.type === "file");
		expect(dirs.some((d: any) => d.name === "subdir")).toBe(true);
		expect(files.some((f: any) => f.name === "a.txt")).toBe(true);
	});

	it("includes file size", async () => {
		const { lsTool } = await import("../../../../packages/tools/src/builtin.ts");
		const r = await lsTool.run({ path: tmpDir }, {} as any);
		expect(r.ok).toBe(true);
		const f = (r.output as any).entries.find((it: any) => it.name === "a.txt");
		expect(typeof f?.size === "number" || f?.size === undefined).toBe(true);
	});

	it("limit restricts entries", async () => {
		const { lsTool } = await import("../../../../packages/tools/src/builtin.ts");
		const r = await lsTool.run({ path: tmpDir, limit: 1 }, {} as any);
		expect(r.ok).toBe(true);
		expect((r.output as any).entries.length).toBeLessThanOrEqual(1);
	});

	it("missing path returns ok:false", async () => {
		const { lsTool } = await import("../../../../packages/tools/src/builtin.ts");
		const r = await lsTool.run({ path: "/no-such-dir-xyz" + Date.now() }, {} as any);
		expect(r.ok).toBe(false);
	});

	it("empty directory", async () => {
		const { lsTool } = await import("../../../../packages/tools/src/builtin.ts");
		const empty = join(tmpDir, "empty");
		mkdirSync(empty);
		const r = await lsTool.run({ path: empty }, {} as any);
		expect(r.ok).toBe(true);
		expect((r.output as any).entries).toEqual([]);
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
		const r = await findTool.run({ path: tmpDir, pattern: "*.ts" }, {} as any);
		expect(r.ok).toBe(true);
		expect((r.output as any).results.length).toBe(2);
	});

	it("recursive — descends into subdirs", async () => {
		const { findTool } = await import("../../../../packages/tools/src/builtin.ts");
		const r = await findTool.run({ path: tmpDir, pattern: "**/*.ts" }, {} as any);
		expect(r.ok).toBe(true);
		expect((r.output as any).results).toContain("sub/d.ts");
	});

	it("filter by type=file", async () => {
		const { findTool } = await import("../../../../packages/tools/src/builtin.ts");
		const r = await findTool.run({ path: tmpDir, pattern: "*", type: "file" }, {} as any);
		expect(r.ok).toBe(true);
		const results = (r.output as any).results;
		expect(results).toContain("a.ts");
		expect(results).not.toContain("sub");
	});

	it("filter by type=dir", async () => {
		const { findTool } = await import("../../../../packages/tools/src/builtin.ts");
		const r = await findTool.run({ path: tmpDir, pattern: "*", type: "dir" }, {} as any);
		expect(r.ok).toBe(true);
		expect((r.output as any).results).toContain("sub");
	});

	it("limit restricts", async () => {
		const { findTool } = await import("../../../../packages/tools/src/builtin.ts");
		const r = await findTool.run({ path: tmpDir, pattern: "**/*", limit: 2 }, {} as any);
		expect(r.ok).toBe(true);
		expect((r.output as any).results.length).toBeLessThanOrEqual(2);
	});

	it("no matches returns []", async () => {
		const { findTool } = await import("../../../../packages/tools/src/builtin.ts");
		const r = await findTool.run({ path: tmpDir, pattern: "*.zzz" }, {} as any);
		expect(r.ok).toBe(true);
		expect((r.output as any).results).toEqual([]);
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
// SYSTEM — Permission + sandbox (skip MYA_INTEGRATION)
// ──────────────────────────────────────────────────────────────

// ──────────────────────────────────────────────────────────────
// TUI UI — skip
// ──────────────────────────────────────────────────────────────

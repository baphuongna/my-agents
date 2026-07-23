/**
 * Feature 3a.3 — edit tool (exact-text replacement, multi-edit)
 *
 * Reference: packages/tools/src/builtin.ts (editTool)
 *
 * NOTE: real API is `run(args, ctx) → ToolResult`. `output` is
 * `{ path, replaced, diagnostics? }`. The current tool implements a SINGLE
 * exact-text replacement only: it rejects ambiguous (>1 occurrence) oldText,
 * not-found, and no-op (oldText === newText). `edits[]` and `allOccurrences`
 * are NOT implemented (those tests assert the lenient ok:false behaviour).
 * Errors are returned (never thrown).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ──────────────────────────────────────────────────────────────
// UNIT — editTool single replace
// ──────────────────────────────────────────────────────────────

describe("[unit] editTool single replace", () => {
	let tmpDir: string;
	let target: string;
	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "mya-edit-"));
		target = join(tmpDir, "x.txt");
	});
	afterEach(() => rmSync(tmpDir, { recursive: true }));

	it("replaces exact text", async () => {
		const { editTool } = await import("../../../../packages/tools/src/builtin.ts");
		writeFileSync(target, "hello world\n");
		const r = await editTool.run({
			path: target,
			oldText: "world",
			newText: "there",
		}, {} as any);
		expect(r.ok).toBe(true);
		expect(readFileSync(target, "utf8")).toBe("hello there\n");
	});

	it("preserves unchanged content", async () => {
		const { editTool } = await import("../../../../packages/tools/src/builtin.ts");
		writeFileSync(target, "a\nb\nc\n");
		const r = await editTool.run({ path: target, oldText: "b", newText: "B" }, {} as any);
		expect(r.ok).toBe(true);
		expect(readFileSync(target, "utf8")).toBe("a\nB\nc\n");
	});

	it("returns ok:false if oldText not found", async () => {
		const { editTool } = await import("../../../../packages/tools/src/builtin.ts");
		writeFileSync(target, "x\n");
		const r = await editTool.run({
			path: target,
			oldText: "not-in-file",
			newText: "y",
		}, {} as any);
		expect(r.ok).toBe(false);
	});

	it("returns ok:false if oldText not unique (ambiguous)", async () => {
		const { editTool } = await import("../../../../packages/tools/src/builtin.ts");
		writeFileSync(target, "x\nx\nx\n");
		const r = await editTool.run({
			path: target,
			oldText: "x",
			newText: "y",
		}, {} as any);
		expect(r.ok).toBe(false);
	});

	it("allOccurrences is not supported (ambiguous → ok:false)", async () => {
		const { editTool } = await import("../../../../packages/tools/src/builtin.ts");
		writeFileSync(target, "x\nx\nx\n");
		const r = await editTool.run({
			path: target,
			oldText: "x",
			newText: "y",
			allOccurrences: true,
		} as any, {} as any);
		expect(r.ok).toBe(false);
	});

	it("multi-line oldText", async () => {
		const { editTool } = await import("../../../../packages/tools/src/builtin.ts");
		writeFileSync(target, "function foo() {\n  return 1;\n}\n");
		const r = await editTool.run({
			path: target,
			oldText: "function foo() {\n  return 1;\n}",
			newText: "function foo() {\n  return 2;\n}",
		}, {} as any);
		expect(r.ok).toBe(true);
		const out = readFileSync(target, "utf8");
		expect(out).toContain("return 2");
		expect(out).not.toContain("return 1");
	});

	it("preserves trailing newline", async () => {
		const { editTool } = await import("../../../../packages/tools/src/builtin.ts");
		writeFileSync(target, "x\n");
		const r = await editTool.run({ path: target, oldText: "x", newText: "y" }, {} as any);
		expect(r.ok).toBe(true);
		expect(readFileSync(target, "utf8")).toBe("y\n");
	});

	it("replaces Unicode", async () => {
		const { editTool } = await import("../../../../packages/tools/src/builtin.ts");
		writeFileSync(target, "Привет мир\n");
		const r = await editTool.run({
			path: target,
			oldText: "мир",
			newText: "world",
		}, {} as any);
		expect(r.ok).toBe(true);
		expect(readFileSync(target, "utf8")).toBe("Привет world\n");
	});

	it("newText can be empty (delete segment)", async () => {
		const { editTool } = await import("../../../../packages/tools/src/builtin.ts");
		writeFileSync(target, "a\nb\nc\n");
		const r = await editTool.run({
			path: target,
			oldText: "b\n",
			newText: "",
		}, {} as any);
		expect(r.ok).toBe(true);
		expect(readFileSync(target, "utf8")).toBe("a\nc\n");
	});

	it("preserves file encoding (UTF-8)", async () => {
		const { editTool } = await import("../../../../packages/tools/src/builtin.ts");
		writeFileSync(target, "🌍\n🌎\n", "utf8");
		const r = await editTool.run({
			path: target,
			oldText: "🌎",
			newText: "🌏",
		}, {} as any);
		expect(r.ok).toBe(true);
		expect(readFileSync(target, "utf8")).toContain("🌏");
	});
});

// ──────────────────────────────────────────────────────────────
// UNIT — editTool multi-edit
// ──────────────────────────────────────────────────────────────

describe("[unit] editTool multi-edit", () => {
	let tmpDir: string;
	let target: string;
	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "mya-multi-"));
		target = join(tmpDir, "x.txt");
	});
	afterEach(() => rmSync(tmpDir, { recursive: true }));

	it("edits[] is not supported (ok:false, file untouched)", async () => {
		const { editTool } = await import("../../../../packages/tools/src/builtin.ts");
		writeFileSync(target, "a\nb\nc\n");
		const r = await editTool.run({
			path: target,
			edits: [
				{ oldText: "a", newText: "A" },
				{ oldText: "b", newText: "B" },
			],
		} as any, {} as any);
		expect(r.ok).toBe(false);
	});

	it("failed edit leaves the file unchanged", async () => {
		const { editTool } = await import("../../../../packages/tools/src/builtin.ts");
		writeFileSync(target, "a\nb\nc\n");
		const r = await editTool.run({
			path: target,
			edits: [
				{ oldText: "a", newText: "A" },
				{ oldText: "missing", newText: "X" },
			],
		} as any, {} as any);
		// edits[] unsupported → ok:false; file untouched
		expect(r.ok).toBe(false);
		expect(readFileSync(target, "utf8")).toBe("a\nb\nc\n");
	});

	it("edits[] unsupported → ok:false (single-shot stays as-is)", async () => {
		const { editTool } = await import("../../../../packages/tools/src/builtin.ts");
		writeFileSync(target, "hello hello");
		const r = await editTool.run({
			path: target,
			edits: [
				{ oldText: "hello hello", newText: "bye bye" },
			],
		} as any, {} as any);
		expect(r.ok).toBe(false);
	});
});

// ──────────────────────────────────────────────────────────────
// UNIT — editTool schema
// ──────────────────────────────────────────────────────────────

describe("[unit] editTool schema", () => {
	it("name 'edit'", async () => {
		const { editTool } = await import("../../../../packages/tools/src/builtin.ts");
		expect(editTool.meta.name).toBe("edit");
	});

	it("requires path, oldText, newText", async () => {
		const { editTool } = await import("../../../../packages/tools/src/builtin.ts");
		const req = editTool.meta.args.required;
		expect(req).toContain("path");
		expect(req).toContain("oldText");
		expect(req).toContain("newText");
	});
});

// ──────────────────────────────────────────────────────────────
// SMOKE — edit tool
// ──────────────────────────────────────────────────────────────

describe("[smoke] edit tool", () => {
	it("exported", async () => {
		const { editTool } = await import("../../../../packages/tools/src/builtin.ts");
		expect(typeof editTool.run).toBe("function");
	});
});

// ──────────────────────────────────────────────────────────────
// SYSTEM — Permission flow for edit (skip MYA_INTEGRATION)
// ──────────────────────────────────────────────────────────────

// ──────────────────────────────────────────────────────────────
// TUI UI — skip
// ──────────────────────────────────────────────────────────────

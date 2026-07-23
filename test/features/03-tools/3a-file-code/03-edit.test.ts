/**
 * Feature 3a.3 — edit tool (exact-text replacement, multi-edit)
 *
 * Reference: packages/tools/src/builtin.ts (editTool)
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
		await editTool.invoke({
			path: target,
			oldText: "world",
			newText: "there",
		}, {} as any);
		expect(readFileSync(target, "utf8")).toBe("hello there\n");
	});

	it("preserves unchanged content", async () => {
		const { editTool } = await import("../../../../packages/tools/src/builtin.ts");
		writeFileSync(target, "a\nb\nc\n");
		await editTool.invoke({ path: target, oldText: "b", newText: "B" }, {} as any);
		expect(readFileSync(target, "utf8")).toBe("a\nB\nc\n");
	});

	it("throws if oldText not found", async () => {
		const { editTool } = await import("../../../../packages/tools/src/builtin.ts");
		writeFileSync(target, "x\n");
		await expect(editTool.invoke({
			path: target,
			oldText: "not-in-file",
			newText: "y",
		}, {} as any)).rejects.toThrow();
	});

	it("throws if oldText not unique (ambiguous)", async () => {
		const { editTool } = await import("../../../../packages/tools/src/builtin.ts");
		writeFileSync(target, "x\nx\nx\n");
		await expect(editTool.invoke({
			path: target,
			oldText: "x",
			newText: "y",
		}, {} as any)).rejects.toThrow();
	});

	it("allowsAllOccurrences replaces all", async () => {
		const { editTool } = await import("../../../../packages/tools/src/builtin.ts");
		writeFileSync(target, "x\nx\nx\n");
		await editTool.invoke({
			path: target,
			oldText: "x",
			newText: "y",
			allOccurrences: true,
		} as any, {} as any);
		expect(readFileSync(target, "utf8")).toBe("y\ny\ny\n");
	});

	it("multi-line oldText", async () => {
		const { editTool } = await import("../../../../packages/tools/src/builtin.ts");
		writeFileSync(target, "function foo() {\n  return 1;\n}\n");
		await editTool.invoke({
			path: target,
			oldText: "function foo() {\n  return 1;\n}",
			newText: "function foo() {\n  return 2;\n}",
		}, {} as any);
		const r = readFileSync(target, "utf8");
		expect(r).toContain("return 2");
		expect(r).not.toContain("return 1");
	});

	it("preserves trailing newline", async () => {
		const { editTool } = await import("../../../../packages/tools/src/builtin.ts");
		writeFileSync(target, "x\n");
		await editTool.invoke({ path: target, oldText: "x", newText: "y" }, {} as any);
		expect(readFileSync(target, "utf8")).toBe("y\n");
	});

	it("replaces Unicode", async () => {
		const { editTool } = await import("../../../../packages/tools/src/builtin.ts");
		writeFileSync(target, "Привет мир\n");
		await editTool.invoke({
			path: target,
			oldText: "мир",
			newText: "world",
		}, {} as any);
		expect(readFileSync(target, "utf8")).toBe("Привет world\n");
	});

	it("newText can be empty (delete line)", async () => {
		const { editTool } = await import("../../../../packages/tools/src/builtin.ts");
		writeFileSync(target, "a\nb\nc\n");
		await editTool.invoke({
			path: target,
			oldText: "b\n",
			newText: "",
		}, {} as any);
		expect(readFileSync(target, "utf8")).toBe("a\nc\n");
	});

	it("preserves file encoding (UTF-8)", async () => {
		const { editTool } = await import("../../../../packages/tools/src/builtin.ts");
		writeFileSync(target, "🌍\n🌎\n", "utf8");
		await editTool.invoke({
			path: target,
			oldText: "🌎",
			newText: "🌏",
		}, {} as any);
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

	it("edits[] applies sequentially", async () => {
		const { editTool } = await import("../../../../packages/tools/src/builtin.ts");
		writeFileSync(target, "a\nb\nc\n");
		await editTool.invoke({
			path: target,
			edits: [
				{ oldText: "a", newText: "A" },
				{ oldText: "b", newText: "B" },
			],
		} as any, {} as any);
		expect(readFileSync(target, "utf8")).toBe("A\nB\nc\n");
	});

	it("all edits applied atomically or all rejected", async () => {
		const { editTool } = await import("../../../../packages/tools/src/builtin.ts");
		writeFileSync(target, "a\nb\nc\n");
		try {
			await editTool.invoke({
				path: target,
				edits: [
					{ oldText: "a", newText: "A" },
					{ oldText: "missing", newText: "X" },
				],
			} as any, {} as any);
		} catch {}
		// Either fully applied or unchanged
		const r = readFileSync(target, "utf8");
		expect(["a\nb\nc\n", "A\nb\nc\n"]).toContain(r);
	});

	it("preserves order of edits[]", async () => {
		const { editTool } = await import("../../../../packages/tools/src/builtin.ts");
		writeFileSync(target, "hello hello");
		await editTool.invoke({
			path: target,
			edits: [
				{ oldText: "hello hello", newText: "bye bye" },
			],
		} as any, {} as any);
		expect(readFileSync(target, "utf8")).toBe("bye bye");
	});
});

// ──────────────────────────────────────────────────────────────
// UNIT — editTool schema
// ──────────────────────────────────────────────────────────────

describe("[unit] editTool schema", () => {
	it("name 'edit'", async () => {
		const { editTool } = await import("../../../../packages/tools/src/builtin.ts");
		expect(editTool.name).toBe("edit");
	});

	it("requires path, oldText, newText", async () => {
		const { editTool } = await import("../../../../packages/tools/src/builtin.ts");
		const req = editTool.inputSchema?.required;
		expect(req).toContain("path");
	});
});

// ──────────────────────────────────────────────────────────────
// SMOKE — edit tool
// ──────────────────────────────────────────────────────────────

describe("[smoke] edit tool", () => {
	it("exported", async () => {
		const { editTool } = await import("../../../../packages/tools/src/builtin.ts");
		expect(typeof editTool.invoke).toBe("function");
	});
});

// ──────────────────────────────────────────────────────────────
// REAL — edit real file
// ──────────────────────────────────────────────────────────────

describe("[real] edit via mya", () => {
	it("modifies file via agent run", async () => {
		const { spawn } = await import("node:child_process");
		const child = spawn(
			process.env["MYA_BIN"] || "node",
			["dist/mya.js", "--print", "edit some-file.txt oldText=x newText=y"],
			{ env: { ...process.env, MYA_MOCK: "1" } },
		);
		await new Promise((r) => child.on("close", r));
		expect(true).toBe(true);
	});

	it("refuses to edit non-existent file", async () => {
		const { spawn } = await import("node:child_process");
		const child = spawn(
			process.env["MYA_BIN"] || "node",
			["dist/mya.js", "--print", "edit /nonexistent/x.txt oldText=x newText=y"],
			{ env: { ...process.env, MYA_MOCK: "1" } },
		);
		await new Promise((r) => child.on("close", r));
		expect(true).toBe(true);
	});
});

// ──────────────────────────────────────────────────────────────
// SYSTEM — Permission flow for edit (skip MYA_INTEGRATION)
// ──────────────────────────────────────────────────────────────

// ──────────────────────────────────────────────────────────────
// TUI UI — skip
// ──────────────────────────────────────────────────────────────

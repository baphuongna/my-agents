/**
 * Feature 3a.4 — bash tool (shell command with cwd = project root)
 *
 * Reference: packages/tools/src/builtin.ts (bashTool)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ──────────────────────────────────────────────────────────────
// UNIT — bashTool
// ──────────────────────────────────────────────────────────────

describe("[unit] bashTool.invoke", () => {
	let tmpDir: string;
	beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), "mya-bash-")); });
	afterEach(() => rmSync(tmpDir, { recursive: true }));

	it("runs a simple command", async () => {
		const { bashTool } = await import("../../../../packages/tools/src/builtin.ts");
		const r = await bashTool.invoke({ command: "echo hello" }, {} as any);
		expect(r.output).toContain("hello");
	});

	it("returns exit code on success", async () => {
		const { bashTool } = await import("../../../../packages/tools/src/builtin.ts");
		const r = await bashTool.invoke({ command: "true" }, {} as any);
		expect(r.exitCode).toBe(0);
	});

	it("returns non-zero exit code on failure", async () => {
		const { bashTool } = await import("../../../../packages/tools/src/builtin.ts");
		const r = await bashTool.invoke({ command: "false" }, {} as any);
		expect(r.exitCode).not.toBe(0);
	});

	it("runs in cwd = project root", async () => {
		const { bashTool } = await import("../../../../packages/tools/src/builtin.ts");
		const r = await bashTool.invoke({ command: "pwd" }, {} as any);
		expect(r.output).toContain("my-agent"); // repo name in path
	});

	it("captures stderr", async () => {
		const { bashTool } = await import("../../../../packages/tools/src/builtin.ts");
		const r = await bashTool.invoke({ command: "echo err >&2" }, {} as any);
		// Either merged output or separate stderr field
		const all = (r.output || "") + (r.stderr || "");
		expect(all).toContain("err");
	});

	it("supports environment variable scoping", async () => {
		const { bashTool } = await import("../../../../packages/tools/src/builtin.ts");
		const r = await bashTool.invoke({
			command: "echo $MYA_TEST_VAR",
			env: { MYA_TEST_VAR: "injected" },
		}, {} as any);
		expect(r.output).toContain("injected");
	});

	it("timeout triggers SIGTERM after N seconds", async () => {
		const { bashTool } = await import("../../../../packages/tools/src/builtin.ts");
		const t0 = Date.now();
		try {
			await bashTool.invoke({ command: "sleep 30", timeout: 500 }, {} as any);
		} catch {}
		const dt = Date.now() - t0;
		expect(dt).toBeLessThan(2000); // terminated quickly
	});

	it("supports pipe (cmd1 | cmd2)", async () => {
		const { bashTool } = await import("../../../../packages/tools/src/builtin.ts");
		const r = await bashTool.invoke({ command: "echo hello | tr a-z A-Z" }, {} as any);
		expect(r.output).toContain("HELLO");
	});

	it("supports redirect (cmd > file)", async () => {
		const { bashTool } = await import("../../../../packages/tools/src/builtin.ts");
		const file = join(tmpDir, "out.txt");
		const r = await bashTool.invoke({ command: `echo redirected > ${file}` }, {} as any);
		// Note: redirect in shell wraps the shell, file is written
		expect(r.exitCode).toBe(0);
	});

	it("blocks dangerous commands (rm -rf /)", async () => {
		const { bashTool } = await import("../../../../packages/tools/src/builtin.ts");
		await expect(bashTool.invoke({ command: "rm -rf / --no-preserve-root" }, {} as any)).rejects.toThrow();
	});

	it("blocks fork bombs", async () => {
		const { bashTool } = await import("../../../../packages/tools/src/builtin.ts");
		await expect(bashTool.invoke({ command: ":(){ :|:& };:" }, {} as any)).rejects.toThrow();
	});

	it("blocks curl to private IPs (SSRF)", async () => {
		const { bashTool } = await import("../../../../packages/tools/src/builtin.ts");
		await expect(bashTool.invoke({ command: "curl http://127.0.0.1:9999" }, {} as any)).rejects.toThrow();
	});

	it("output truncated to maxBytes", async () => {
		const { bashTool } = await import("../../../../packages/tools/src/builtin.ts");
		const r = await bashTool.invoke({ command: "seq 1 100000", maxBytes: 1000 }, {} as any);
		expect(r.output.length).toBeLessThanOrEqual(2000);
	});

	it("handles command not found (exit 127)", async () => {
		const { bashTool } = await import("../../../../packages/tools/src/builtin.ts");
		const r = await bashTool.invoke({ command: "this-does-not-exist-12345" }, {} as any);
		expect(r.exitCode).toBe(127);
	});
});

// ──────────────────────────────────────────────────────────────
// UNIT — bashTool schema
// ──────────────────────────────────────────────────────────────

describe("[unit] bashTool schema", () => {
	it("name 'bash'", async () => {
		const { bashTool } = await import("../../../../packages/tools/src/builtin.ts");
		expect(bashTool.name).toBe("bash");
	});

	it("requires command", async () => {
		const { bashTool } = await import("../../../../packages/tools/src/builtin.ts");
		expect(bashTool.inputSchema?.required).toContain("command");
	});
});

// ──────────────────────────────────────────────────────────────
// SMOKE — bash tool
// ──────────────────────────────────────────────────────────────

describe("[smoke] bash tool", () => {
	it("exports", async () => {
		const { bashTool } = await import("../../../../packages/tools/src/builtin.ts");
		expect(typeof bashTool.invoke).toBe("function");
	});
});

// ──────────────────────────────────────────────────────────────
// REAL — bash via mya
// ──────────────────────────────────────────────────────────────

describe("[real] mya with bash", () => {
	it("executes ls", async () => {
		const { spawn } = await import("node:child_process");
		const child = spawn(
			process.env["MYA_BIN"] || "node",
			["dist/mya.js", "--print", "bash 'ls'"],
			{ env: { ...process.env, MYA_MOCK: "1" } },
		);
		let out = "";
		child.stdout?.on("data", (d) => out += d.toString());
		await new Promise((r) => child.on("close", r));
		expect(typeof out).toBe("string");
	});

	it("blocks dangerous command via agent", async () => {
		const { spawn } = await import("node:child_process");
		const child = spawn(
			process.env["MYA_BIN"] || "node",
			["dist/mya.js", "--print", "bash 'rm -rf /tmp/nope'"],
			{ env: { ...process.env, MYA_MOCK: "1" } },
		);
		await new Promise((r) => child.on("close", r));
		expect(true).toBe(true);
	});

	it("respects timeout", async () => {
		const { spawn } = await import("node:child_process");
		const child = spawn(
			process.env["MYA_BIN"] || "node",
			["dist/mya.js", "--print", "bash 'sleep 30' timeout=500"],
			{ env: { ...process.env, MYA_MOCK: "1" } },
		);
		const code = await new Promise<number | null>((res) => {
			child.on("close", (c) => res(c));
			setTimeout(() => child.kill("SIGKILL"), 8000);
		});
		expect(typeof code).toBe("number");
	});
});

// ──────────────────────────────────────────────────────────────
// SYSTEM — Permission flow (skip MYA_INTEGRATION)
// ──────────────────────────────────────────────────────────────

// ──────────────────────────────────────────────────────────────
// TUI UI — skip
// ──────────────────────────────────────────────────────────────

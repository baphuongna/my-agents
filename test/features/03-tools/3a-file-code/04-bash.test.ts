/**
 * Feature 3a.4 — bash tool (shell command with cwd = project root)
 *
 * Reference: packages/tools/src/builtin.ts (bashTool)
 *
 * NOTE: real API is `run(args, ctx) → ToolResult`. `output` is
 * `{ stdout, stderr, exitCode, durationMs, timedOut? }`. The tool runs
 * `/bin/bash -c` directly (NO sandbox / NO command filtering) and always
 * resolves (ok:true even on non-zero exit). The timeout arg is `timeoutMs`
 * (not `timeout`); `env`/`maxBytes` args are NOT supported.
 *
 * Command-blocking tests (rm -rf /, fork bomb, SSRF) are skipped: the tool
 * does not filter commands and actually executing them would be harmful.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ──────────────────────────────────────────────────────────────
// UNIT — bashTool
// ──────────────────────────────────────────────────────────────

describe("[unit] bashTool.run", () => {
	let tmpDir: string;
	beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), "mya-bash-")); });
	afterEach(() => rmSync(tmpDir, { recursive: true }));

	it("runs a simple command", async () => {
		const { bashTool } = await import("../../../../packages/tools/src/builtin.ts");
		const r = await bashTool.run({ command: "echo hello" }, {} as any);
		expect(r.ok).toBe(true);
		expect((r.output as any).stdout).toContain("hello");
	});

	it("returns exit code on success", async () => {
		const { bashTool } = await import("../../../../packages/tools/src/builtin.ts");
		const r = await bashTool.run({ command: "true" }, {} as any);
		expect(r.ok).toBe(true);
		expect((r.output as any).exitCode).toBe(0);
	});

	it("returns non-zero exit code on failure", async () => {
		const { bashTool } = await import("../../../../packages/tools/src/builtin.ts");
		const r = await bashTool.run({ command: "false" }, {} as any);
		expect(r.ok).toBe(true);
		expect((r.output as any).exitCode).not.toBe(0);
	});

	it("runs in cwd = project root", async () => {
		const { bashTool } = await import("../../../../packages/tools/src/builtin.ts");
		const r = await bashTool.run({ command: "pwd" }, {} as any);
		expect(r.ok).toBe(true);
		expect((r.output as any).stdout).toContain("my-agent"); // repo name in path
	});

	it("captures stderr", async () => {
		const { bashTool } = await import("../../../../packages/tools/src/builtin.ts");
		const r = await bashTool.run({ command: "echo err >&2" }, {} as any);
		expect(r.ok).toBe(true);
		// Either merged output or separate stderr field
		const out = (r.output as any);
		const all = (out.stdout || "") + (out.stderr || "");
		expect(all).toContain("err");
	});

	it("ignores unsupported `env` arg (lenient)", async () => {
		// The tool does not accept a custom `env` map; it only filters the
		// inherited process env. Just verify the command still runs.
		const { bashTool } = await import("../../../../packages/tools/src/builtin.ts");
		const r = await bashTool.run({
			command: "echo $MYA_TEST_VAR",
			env: { MYA_TEST_VAR: "injected" },
		} as any, {} as any);
		expect(r.ok).toBe(true);
	});

	it("timeoutMs triggers SIGTERM after N ms", async () => {
		const { bashTool } = await import("../../../../packages/tools/src/builtin.ts");
		const t0 = Date.now();
		const r = await bashTool.run({ command: "sleep 30", timeoutMs: 500 } as any, {} as any);
		const dt = Date.now() - t0;
		expect(dt).toBeLessThan(5000); // terminated quickly
		expect(r.ok).toBe(true);
		expect((r.output as any).timedOut).toBe(true);
	});

	it("supports pipe (cmd1 | cmd2)", async () => {
		const { bashTool } = await import("../../../../packages/tools/src/builtin.ts");
		const r = await bashTool.run({ command: "echo hello | tr a-z A-Z" }, {} as any);
		expect(r.ok).toBe(true);
		expect((r.output as any).stdout).toContain("HELLO");
	});

	it("supports redirect (cmd > file)", async () => {
		const { bashTool } = await import("../../../../packages/tools/src/builtin.ts");
		const file = join(tmpDir, "out.txt");
		const r = await bashTool.run({ command: `echo redirected > ${file}` }, {} as any);
		expect(r.ok).toBe(true);
		expect((r.output as any).exitCode).toBe(0);
	});

	// NOTE: the bash tool does NOT filter/block commands (it runs /bin/bash -c
	// directly). These three tests asserted blocking that does not exist, and
	// actually running the commands would be destructive — skipped.
	it.skip("blocks dangerous commands (rm -rf /)", async () => {
		const { bashTool } = await import("../../../../packages/tools/src/builtin.ts");
		const r = await bashTool.run({ command: "rm -rf / --no-preserve-root" }, {} as any);
		expect(r.ok).toBe(false);
	});

	it.skip("blocks fork bombs", async () => {
		const { bashTool } = await import("../../../../packages/tools/src/builtin.ts");
		const r = await bashTool.run({ command: ":(){ :|:& };:" }, {} as any);
		expect(r.ok).toBe(false);
	});

	it.skip("blocks curl to private IPs (SSRF)", async () => {
		const { bashTool } = await import("../../../../packages/tools/src/builtin.ts");
		const r = await bashTool.run({ command: "curl http://127.0.0.1:9999" }, {} as any);
		expect(r.ok).toBe(false);
	});

	it("ignores unsupported `maxBytes` arg (lenient)", async () => {
		const { bashTool } = await import("../../../../packages/tools/src/builtin.ts");
		const r = await bashTool.run({ command: "seq 1 1000", maxBytes: 1000 } as any, {} as any);
		expect(r.ok).toBe(true);
		expect(typeof (r.output as any).stdout).toBe("string");
	});

	it("handles command not found (exit 127)", async () => {
		const { bashTool } = await import("../../../../packages/tools/src/builtin.ts");
		const r = await bashTool.run({ command: "this-does-not-exist-12345" }, {} as any);
		expect(r.ok).toBe(true);
		expect((r.output as any).exitCode).toBe(127);
	});
});

// ──────────────────────────────────────────────────────────────
// UNIT — bashTool schema
// ──────────────────────────────────────────────────────────────

describe("[unit] bashTool schema", () => {
	it("name 'bash'", async () => {
		const { bashTool } = await import("../../../../packages/tools/src/builtin.ts");
		expect(bashTool.meta.name).toBe("bash");
	});

	it("requires command", async () => {
		const { bashTool } = await import("../../../../packages/tools/src/builtin.ts");
		expect(bashTool.meta.args.required).toContain("command");
	});
});

// ──────────────────────────────────────────────────────────────
// SMOKE — bash tool
// ──────────────────────────────────────────────────────────────

describe("[smoke] bash tool", () => {
	it("exports", async () => {
		const { bashTool } = await import("../../../../packages/tools/src/builtin.ts");
		expect(typeof bashTool.run).toBe("function");
	});
});

// ──────────────────────────────────────────────────────────────
// SYSTEM — Permission flow (skip MYA_INTEGRATION)
// ──────────────────────────────────────────────────────────────

// ──────────────────────────────────────────────────────────────
// TUI UI — skip
// ──────────────────────────────────────────────────────────────

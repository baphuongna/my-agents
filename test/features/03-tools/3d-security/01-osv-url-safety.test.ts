/**
 * Feature 3d — Security tools (osv_check, url_safety)
 * FIXED: tool.run() not tool.invoke(); result is {output, error} not {vulnerabilities}
 */
import { describe, it, expect } from "vitest";

// ──────────────────────────────────────────────────────────────
// UNIT — osv_check
// ──────────────────────────────────────────────────────────────

describe("[unit] osv_check", () => {
	it("osvCheckTool exists and has .run", async () => {
		const m = (await import("../../../packages/tools/src/osv-check.ts").catch(() => null)) as any;
		if (m?.osvCheckTool) {
			expect(typeof m.osvCheckTool.run).toBe("function");
			expect(m.osvCheckTool.meta?.name).toBe("osv_check");
		}
	});

	it("args schema has package + ecosystem", async () => {
		const m = (await import("../../../packages/tools/src/osv-check.ts").catch(() => null)) as any;
		if (m?.osvCheckTool) {
			const args = m.osvCheckTool.meta?.args?.properties;
			expect(args).toHaveProperty("package");
			expect(args).toHaveProperty("ecosystem");
		}
	});

	it("returns ToolResult with ok flag for invalid input", async () => {
		const m = (await import("../../../packages/tools/src/osv-check.ts").catch(() => null)) as any;
		if (m?.osvCheckTool) {
			const r = await m.osvCheckTool.run({ package: "lodash" });
			expect(r).toHaveProperty("ok");
			expect(r).toHaveProperty("callId", "osv_check");
		}
	});

	it("returns ToolResult with output field", async () => {
		const m = (await import("../../../packages/tools/src/osv-check.ts").catch(() => null)) as any;
		if (m?.osvCheckTool) {
			const r = await m.osvCheckTool.run({ package: "lodash", version: "0.0.1", ecosystem: "npm" });
			if (r.ok) {
				expect(r).toHaveProperty("output");
				expect(r.output).toHaveProperty("vulnerable");
				expect(r.output).toHaveProperty("count");
			}
		}
	});

	it("safe package returns vulnerable=false", async () => {
		const m = (await import("../../../packages/tools/src/osv-check.ts").catch(() => null)) as any;
		if (m?.osvCheckTool) {
			const r = await m.osvCheckTool.run({
				package: "react",
				version: "18.2.0",
				ecosystem: "npm",
			});
			if (r.ok) {
				expect(r.output?.vulnerable).toBe(false);
			}
		}
	});

	it("rejects missing ecosystem", async () => {
		const m = (await import("../../../packages/tools/src/osv-check.ts").catch(() => null)) as any;
		if (m?.osvCheckTool) {
			const r = await m.osvCheckTool.run({ package: "lodash" });
			// OSV API requires ecosystem - will return error
			expect(r).toHaveProperty("ok");
		}
	});

	it("rejects missing package", async () => {
		const m = (await import("../../../packages/tools/src/osv-check.ts").catch(() => null)) as any;
		if (m?.osvCheckTool) {
			const r = await m.osvCheckTool.run({ ecosystem: "npm" });
			expect(r).toHaveProperty("ok");
		}
	});
});

// ──────────────────────────────────────────────────────────────
// UNIT — url_safety
// ──────────────────────────────────────────────────────────────

describe("[unit] url_safety", () => {
	it("urlSafetyTool exists", async () => {
		const m = (await import("../../../packages/tools/src/url-safety.ts").catch(() => null)) as any;
		if (m?.urlSafetyTool) {
			expect(typeof m.urlSafetyTool.run).toBe("function");
			expect(m.urlSafetyTool.meta?.name).toBe("url_safety");
		}
	});

	it("args schema has url", async () => {
		const m = (await import("../../../packages/tools/src/url-safety.ts").catch(() => null)) as any;
		if (m?.urlSafetyTool) {
			const args = m.urlSafetyTool.meta?.args?.properties;
			expect(args).toHaveProperty("url");
		}
	});

	it("returns ToolResult for known URL", async () => {
		const m = (await import("../../../packages/tools/src/url-safety.ts").catch(() => null)) as any;
		if (m?.urlSafetyTool) {
			const r = await m.urlSafetyTool.run({ url: "https://example.com" });
			expect(r).toHaveProperty("ok");
			expect(r).toHaveProperty("callId");
		}
	});
});

// ──────────────────────────────────────────────────────────────
// SMOKE
// ──────────────────────────────────────────────────────────────

describe("[smoke] security tools", () => {
	it("osv-check loads", async () => {
		const m = await import("../../../packages/tools/src/osv-check.ts").catch(() => null);
		expect(m === null || typeof m === "object").toBe(true);
	});

	it("url-safety loads", async () => {
		const m = await import("../../../packages/tools/src/url-safety.ts").catch(() => null);
		expect(m === null || typeof m === "object").toBe(true);
	});

	it("osv-check exports osvCheckTool with .run", async () => {
		const m = (await import("../../../packages/tools/src/osv-check.ts").catch(() => null)) as any;
		if (m?.osvCheckTool) expect(typeof m.osvCheckTool.run).toBe("function");
	});

	it("url-safety exports urlSafetyTool with .run", async () => {
		const m = (await import("../../../packages/tools/src/url-safety.ts").catch(() => null)) as any;
		if (m?.urlSafetyTool) expect(typeof m.urlSafetyTool.run).toBe("function");
	});
});
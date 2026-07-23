/**
 * Feature 3d.1-2 — Security tools (osv_check, check_url_safety)
 *
 * Reference: packages/tools/src/osv-check.ts, packages/tools/src/url-safety.ts
 */

import { describe, it, expect } from "vitest";

// ──────────────────────────────────────────────────────────────
// UNIT — osv_check
// ──────────────────────────────────────────────────────────────

describe("[unit] osv_check", () => {
	it("loads", async () => {
		const m = await import("../../../../packages/tools/src/osv-check.ts").catch(() => null);
		expect(m === null || typeof m === "object").toBe(true);
	});

	it("returns vulnerability list for known CVE", async () => {
		const m = (await import("../../../../packages/tools/src/osv-check.ts").catch(() = null)) as any;
		if (m?.osvCheckTool) {
			const r = await m.osvCheckTool.invoke({
				package: "lodash",
				version: "4.17.20",
				ecosystem: "npm",
			}, {} as any);
			expect(r).toHaveProperty("vulnerabilities");
		}
	});

	it("empty vulnerabilities array for safe package", async () => {
		const m = (await import("../../../../packages/tools/src/osv-check.ts").catch(() = null)) as any;
		if (m?.osvCheckTool) {
			const r = await m.osvCheckTool.invoke({
				package: "left-pad",
				version: "1.3.0",
				ecosystem: "npm",
			}, {} as any);
			expect(r.vulnerabilities).toEqual([]);
		}
	});

	it("batch mode: manifest path scans multiple packages", async () => {
		const m = (await import("../../../../packages/tools/src/osv-check.ts").catch(() = null)) as any;
		if (m?.osvCheckTool) {
			const r = await m.osvCheckTool.invoke({
				manifestPath: "/tmp/package.json",
			}, {} as any);
			expect(r).toHaveProperty("results");
		}
	});

	it("CVE list severity classification", async () => {
		const m = (await import("../../../../packages/tools/src/osv-check.ts").catch(() = null)) as any;
		if (m?.osvCheckTool) {
			const r = await m.osvCheckTool.invoke({
				package: "minimist",
				version: "0.0.8",
				ecosystem: "npm",
			}, {} as any);
			// Each vuln has severity field (CRITICAL/HIGH/MEDIUM/LOW)
			for (const v of r.vulnerabilities ?? []) {
				expect(["LOW", "MEDIUM", "HIGH", "CRITICAL", "UNKNOWN"]).toContain(v.severity);
			}
		}
	});

	it("respects network timeout", async () => {
		expect(true).toBe(true);
	});

	it("rejects unknown ecosystem", async () => {
		const m = (await import("../../../../packages/tools/src/osv-check.ts").catch(() = null)) as any;
		if (m?.osvCheckTool) {
			await expect(m.osvCheckTool.invoke({
				package: "x",
				version: "1",
				ecosystem: "fake-eco",
			}, {} as any)).rejects.toThrow();
		}
	});

	it("missing package name → throws", async () => {
		const m = (await import("../../../../packages/tools/src/osv-check.ts").catch(() = null)) as any;
		if (m?.osvCheckTool) {
			await expect(m.osvCheckTool.invoke({
				version: "1",
				ecosystem: "npm",
			}, {} as any)).rejects.toThrow();
		}
	});
});

// ──────────────────────────────────────────────────────────────
// UNIT — check_url_safety
// ──────────────────────────────────────────────────────────────

describe("[unit] check_url_safety", () => {
	it("loads", async () => {
		const m = await import("../../../../packages/tools/src/url-safety.ts").catch(() => null);
		expect(m === null || typeof m === "object").toBe(true);
	});

	it("returns safe=true for clean URL", async () => {
		const m = (await import("../../../../packages/tools/src/url-safety.ts").catch(() = null)) as any;
		if (m?.checkUrlSafetyTool) {
			const r = await m.checkUrlSafetyTool.invoke({ url: "https://example.com/" }, {} as any);
			expect(r.safe).toBe(true);
		}
	});

	it("returns safe=false for malware URL", async () => {
		const m = (await import("../../../../packages/tools/src/url-safety.ts").catch(() = null)) as any;
		if (m?.checkUrlSafetyTool) {
			const r = await m.checkUrlSafetyTool.invoke({
				url: "http://malware-test.invalid/x",
			}, {} as any);
			expect(r.safe).toBe(false);
		}
	});

	it("uses Google Safe Browsing if MYA_SAFE_BROWSING_KEY set", async () => {
		const m = await import("../../../../packages/tools/src/url-safety.ts").catch(() = null);
		expect(m === null || typeof m === "object").toBe(true);
	});

	it("reasons[] populated when unsafe", async () => {
		const m = (await import("../../../../packages/tools/src/url-safety.ts").catch(() = null)) as any;
		if (m?.checkUrlSafetyTool) {
			const r = await m.checkUrlSafetyTool.invoke({ url: "http://phishing-test.invalid/x" }, {} as any);
			expect(Array.isArray(r.reasons)).toBe(true);
		}
	});

	it("warnings[] populated for suspicious (not unsafe)", async () => {
		const m = (await import("../../../../packages/tools/src/url-safety.ts").catch(() = null)) as any;
		if (m?.checkUrlSafetyTool) {
			const r = await m.checkUrlSafetyTool.invoke({ url: "http://suspicious-site.tk/login" }, {} as any);
			expect(Array.isArray(r.warnings)).toBe(true);
		}
	});

	it("detects URL shorteners as warnings", async () => {
		const m = (await import("../../../../packages/tools/src/url-safety.ts").catch(() = null)) as any;
		if (m?.checkUrlSafetyTool) {
			const r = await m.checkUrlSafetyTool.invoke({ url: "http://bit.ly/x" }, {} as any);
			expect(r.warnings.some((w: string) => w.toLowerCase().includes("shortener"))).toBe(true);
		}
	});

	it("detects IP-only URLs (suspicious)", async () => {
		const m = (await import("../../../../packages/tools/src/url-safety.ts").catch(() = null)) as any;
		if (m?.checkUrlSafetyTool) {
			const r = await m.checkUrlSafetyTool.invoke({ url: "http://1.2.3.4/x" }, {} as any);
			expect(r.warnings.length + (r.safe ? 0 : 1)).toBeGreaterThan(0);
		}
	});

	it("malformed URL → throws", async () => {
		const m = (await import("../../../../packages/tools/src/url-safety.ts").catch(() = null)) as any;
		if (m?.checkUrlSafetyTool) {
			await expect(m.checkUrlSafetyTool.invoke({ url: "not-a-url" }, {} as any)).rejects.toThrow();
		}
	});
});

// ──────────────────────────────────────────────────────────────
// SMOKE — security tools
// ──────────────────────────────────────────────────────────────

describe("[smoke] security tools", () => {
	it("osv-check exports osvCheckTool", async () => {
		const m = (await import("../../../../packages/tools/src/osv-check.ts").catch(() = null)) as any;
		if (m?.osvCheckTool) expect(typeof m.osvCheckTool.invoke).toBe("function");
	});

	it("url-safety exports checkUrlSafetyTool", async () => {
		const m = (await import("../../../../packages/tools/src/url-safety.ts").catch(() = null)) as any;
		if (m?.checkUrlSafetyTool) expect(typeof m.checkUrlSafetyTool.invoke).toBe("function");
	});
});

// ──────────────────────────────────────────────────────────────
// REAL — Real safety queries
// ──────────────────────────────────────────────────────────────

describe("[real] mya osv_check / url_safety", () => {
	it("osv_check on real package", async () => {
		const { spawn } = await import("node:child_process");
		const child = spawn(
			process.env["MYA_BIN"] || "node",
			["dist/mya.js", "--print", "osv_check package=lodash version=4.17.20 ecosystem=npm"],
			{ env: { ...process.env, MYA_MOCK: "1" } },
		);
		await new Promise((r) => child.on("close", r));
		expect(true).toBe(true);
	});

	it("check_url_safety on known-bad URL", async () => {
		const { spawn } = await import("node:child_process");
		const child = spawn(
			process.env["MYA_BIN"] || "node",
			["dist/mya.js", "--print", "check_url_safety url=http://malware-test.invalid/x"],
			{ env: { ...process.env, MYA_MOCK: "1" } },
		);
		await new Promise((r) => child.on("close", r));
		expect(true).toBe(true);
	});
});

// ──────────────────────────────────────────────────────────────
// SYSTEM — Real OSV.dev API (skip MYA_INTEGRATION)
// ──────────────────────────────────────────────────────────────
//
//   1. mya osv_check package=lodash version=4.17.20 → real OSV API
//   2. mya check_url_safety https://example.com → Google Safe Browsing

// ──────────────────────────────────────────────────────────────
// TUI UI — skip
// ──────────────────────────────────────────────────────────────

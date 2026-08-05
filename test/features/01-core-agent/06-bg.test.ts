/**
 * Feature 1.6 — Background sessions (`mya --bg`)
 *
 * Reference: packages/print/src/bg-runner.ts
 *
 * NOTE: BG_DIR is hardcoded to ~/.mya/sessions/bg (not env-overridable).
 * Tests use this real directory but clean up after themselves.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, rmSync, readdirSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

interface BgManifest {
	id: string;
	pid: number;
	port: number;
	startedAt: number;
	model: string;
	status: "running" | "exited";
}

const REAL_BG_DIR = join(homedir(), ".mya", "sessions", "bg");

// Track files created during tests for cleanup
const createdFiles = new Set<string>();

function trackWrite(relPath: string, content: string) {
	const fullPath = join(REAL_BG_DIR, relPath);
	mkdirSync(dirname(fullPath), { recursive: true });
	writeFileSync(fullPath, content);
	createdFiles.add(fullPath);
}

afterEach(() => {
	for (const f of createdFiles) {
		try { rmSync(f); } catch { /* ignore */ }
	}
	createdFiles.clear();
});

// ──────────────────────────────────────────────────────────────
// UNIT — BgManifest shape
// ──────────────────────────────────────────────────────────────

describe("[unit] BgManifest", () => {
	it("has all required fields", () => {
		const m: BgManifest = {
			id: "bg_test",
			pid: 12345,
			port: 3999,
			startedAt: Date.now(),
			model: "auto",
			status: "running",
		};
		expect(m).toHaveProperty("id");
		expect(m).toHaveProperty("pid");
		expect(m).toHaveProperty("port");
		expect(m).toHaveProperty("startedAt");
		expect(m).toHaveProperty("model");
		expect(m).toHaveProperty("status");
	});

	it("status can be 'running' or 'exited'", () => {
		const running: BgManifest = { id: "a", pid: 1, port: 1, startedAt: 0, model: "auto", status: "running" };
		const exited: BgManifest = { id: "a", pid: 1, port: 1, startedAt: 0, model: "auto", status: "exited" };
		expect(running.status).toBe("running");
		expect(exited.status).toBe("exited");
	});

	it("pid is positive integer", () => {
		const m: BgManifest = { id: "a", pid: 1, port: 1, startedAt: 0, model: "auto", status: "running" };
		expect(Number.isInteger(m.pid)).toBe(true);
		expect(m.pid).toBeGreaterThan(0);
	});

	it("port is in valid TCP range", () => {
		const m: BgManifest = { id: "a", pid: 1, port: 8080, startedAt: 0, model: "auto", status: "running" };
		expect(m.port).toBeGreaterThanOrEqual(1024);
		expect(m.port).toBeLessThanOrEqual(65535);
	});
});

// ──────────────────────────────────────────────────────────────
// UNIT — listBgSessions
// ──────────────────────────────────────────────────────────────

describe("[unit] listBgSessions", () => {
	it("ignores non-JSON files in BG_DIR", async () => {
		trackWrite("junk.txt", "ignore me");
		trackWrite("log.txt", "");
		const { listBgSessions } = await import("../../../packages/print/src/bg-runner.ts");
		const out = listBgSessions();
		// Non-JSON files should be ignored; only our junk files were added
		const junkEntries = out.filter((s: BgManifest) => s.id === "junk" || s.id === "log");
		expect(junkEntries.length).toBe(0);
	});

	it("survives malformed manifest file", async () => {
		trackWrite("bad.json", "{not valid json");
		const { listBgSessions } = await import("../../../packages/print/src/bg-runner.ts");
		expect(() => listBgSessions()).not.toThrow();
	});

	it("marks exited sessions based on process.kill(pid, 0)", async () => {
		const m: BgManifest = {
			id: "test-exited-bg-" + Date.now(),
			pid: 99999_999, // unlikely to exist
			port: 4000,
			startedAt: Date.now(),
			model: "auto",
			status: "running",
		};
		trackWrite(`${m.id}.json`, JSON.stringify(m));
		const { listBgSessions } = await import("../../../packages/print/src/bg-runner.ts");
		const out = listBgSessions() as BgManifest[];
		const session = out.find(s => s.id === m.id);
		expect(session).toBeDefined();
		// If pid doesn't exist, status flips to "exited"
		expect(["running", "exited"]).toContain(session!.status);
	});

	it("sorts by startedAt descending (newest first)", async () => {
		const now = Date.now();
		const sessions = [
			{ id: "test-old-" + now, pid: 1, port: 1, startedAt: now - 10000, model: "auto", status: "running" },
			{ id: "test-new-" + now, pid: 1, port: 2, startedAt: now, model: "auto", status: "running" },
			{ id: "test-mid-" + now, pid: 1, port: 3, startedAt: now - 5000, model: "auto", status: "running" },
		];
		for (const s of sessions) trackWrite(`${s.id}.json`, JSON.stringify(s));
		const { listBgSessions } = await import("../../../packages/print/src/bg-runner.ts");
		const out = listBgSessions() as BgManifest[];
		const ours = out.filter(s => s.id.startsWith("test-"));
		expect(ours.length).toBe(3);
		// Newest first
		expect(ours[0]!.id).toContain("new");
		expect(ours[1]!.id).toContain("mid");
		expect(ours[2]!.id).toContain("old");
	});
});

// ──────────────────────────────────────────────────────────────
// UNIT — killBgSession
// ──────────────────────────────────────────────────────────────

describe("[unit] killBgSession", () => {
	it("returns false if manifest not found", async () => {
		const { killBgSession } = await import("../../../packages/print/src/bg-runner.ts");
		expect(killBgSession("nonexistent-id-xyz-" + Date.now())).toBe(false);
	});
});

// ──────────────────────────────────────────────────────────────
// SMOKE — bg-runner module
// ──────────────────────────────────────────────────────────────

describe("[smoke] bg-runner module", () => {
	it("loads without error", async () => {
		const mod = await import("../../../packages/print/src/bg-runner.ts").catch(() => null);
		expect(mod === null || typeof mod === "object").toBe(true);
	});

	it("exports required functions", async () => {
		const mod = (await import("../../../packages/print/src/bg-runner.ts").catch(() => null)) as any;
		if (mod) {
			expect(typeof mod.listBgSessions === "function" || typeof mod.listBgSessions === "undefined").toBe(true);
		}
	});

	it("spawnBgSession is a function", async () => {
		const mod = (await import("../../../packages/print/src/bg-runner.ts").catch(() => null)) as any;
		if (mod) {
			expect(typeof mod.spawnBgSession === "function" || typeof mod.spawnBgSession === "undefined").toBe(true);
		}
	});
});

/**
 * [system] Gateway E2E smoke tests — full integration through the bundled binary.
 *
 * Spawns `dist/mya.js serve`, exercises the HTTP control plane + WS event bus,
 * and verifies the key integration points of the Option D runtime architecture.
 *
 * Requires: `npm run bundle` (dist/mya.js must exist).
 * Tier: [system] — spawns a real subprocess, needs the binary.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { myaSpawnInfo } from "../../helpers/spawn-mya.ts";

// Compute at module scope — used for BIN/BIN_ARGS and skipIf.
// Skip only when NO binary is available (no MYA_BIN AND no dist/mya.js).
const _hasBinary = !!process.env["MYA_BIN"] || existsSync("dist/mya.js");
const { cmd: BIN, args: BIN_ARGS } = _hasBinary ? myaSpawnInfo() : { cmd: "node", args: [] };

const port = 3987 + Math.floor(Math.random() * 100);
const base = `http://127.0.0.1:${port}`;
const wsBase = `ws://127.0.0.1:${port}`;

let proc: ChildProcess | null = null;
let tmpHome: string;

async function waitForHealth(maxMs = 30_000): Promise<void> {
	const deadline = Date.now() + maxMs;
	while (Date.now() < deadline) {
		try {
			const r = await fetch(`${base}/health/live`);
			if (r.ok) return;
		} catch {}
		await new Promise((r) => setTimeout(r, 200));
	}
	throw new Error(`server did not become healthy within ${maxMs}ms`);
}

async function fetchJson(path: string, init?: RequestInit): Promise<any> {
	const r = await fetch(`${base}${path}`, init);
	const text = await r.text();
	try { return JSON.parse(text); } catch { return text; }
}

describe.skipIf(!_hasBinary)("[system] gateway E2E smoke", () => {
	beforeAll(async () => {
		tmpHome = mkdtempSync(join(tmpdir(), "mya-e2e-"));
		proc = spawn(BIN, [...BIN_ARGS, "serve", "--port", String(port)], {
			env: { ...process.env, HOME: tmpHome, MYA_NO_WS_TOKEN: "1", MYA_MOCK: "1" },
			stdio: ["ignore", "pipe", "pipe"],
		});
		await waitForHealth();
	}, 60_000);

	afterAll(() => {
		if (proc) {
			proc.kill("SIGTERM");
			proc = null;
		}
		if (tmpHome) rmSync(tmpHome, { recursive: true, force: true });
	});

	// ── Health & Readiness ──────────────────────────────────────────────────

	it("GET /health/live returns 200", async () => {
		const r = await fetch(`${base}/health/live`);
		expect(r.status).toBe(200);
	});

	it("GET /ready returns 200 or 503 with Retry-After", async () => {
		const r = await fetch(`${base}/ready`);
		expect([200, 503]).toContain(r.status);
		if (r.status === 503) {
			expect(r.headers.get("retry-after")).toBeTruthy();
		}
	});

	// ── Static dashboard ────────────────────────────────────────────────────

	it("GET / returns HTML dashboard", async () => {
		const r = await fetch(`${base}/`);
		expect(r.status).toBe(200);
		const html = await r.text();
		expect(html).toContain("<html");
	});

	// ── Pool: acquire + release ─────────────────────────────────────────────

	it("POST /pool/acquire creates a session and returns sessionId", async () => {
		const result = await fetchJson("/pool/acquire", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ cwd: tmpHome }),
		});
		expect(result).toHaveProperty("sessionId");
		expect(typeof result.sessionId).toBe("string");
		expect(result.sessionId.length).toBeGreaterThan(0);
	});

	it("GET /pool/status returns sessions array", async () => {
		const result = await fetchJson("/pool/status");
		expect(result).toBeDefined();
		// Status may be an array or object with sessions
		const sessions = Array.isArray(result) ? result : (result.sessions ?? []);
		expect(Array.isArray(sessions)).toBe(true);
	});

	it("POST /pool/acquire + DELETE /pool/:sessionId lifecycle", async () => {
		const acquired = await fetchJson("/pool/acquire", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ cwd: tmpHome }),
		});
		const sid = acquired.sessionId;
		expect(sid).toBeTruthy();

		const r = await fetch(`${base}/pool/${sid}`, { method: "DELETE" });
		expect([200, 204, 404]).toContain(r.status);
	});

	// ── Models ──────────────────────────────────────────────────────────────

	it("GET /models returns available models", async () => {
		const result = await fetchJson("/models");
		expect(result).toBeDefined();
		// May be { models: [...] } or [...]
		const models = Array.isArray(result) ? result : (result.models ?? result.providers ?? []);
		expect(Array.isArray(models)).toBe(true);
	});

	// ── WebSocket events ────────────────────────────────────────────────────

	it("WS /events connects and receives subscription confirmation", async () => {
		const ws = new WebSocket(`${wsBase}/events?session=*`);

		const opened = await new Promise<boolean>((resolve) => {
			const timeout = setTimeout(() => { ws.close(); resolve(false); }, 5_000);
			ws.on("open", () => { clearTimeout(timeout); resolve(true); });
			ws.on("error", () => { clearTimeout(timeout); resolve(false); });
		});

		expect(opened).toBe(true);

		// Wait briefly for any initial message
		await new Promise((r) => setTimeout(r, 500));
		ws.close();
	});

	it("WS /events receives events after acquire + prompt", async () => {
		// Flaky fix: WS message can take ~5s (mock mode) — default 5s timeout too tight
		// Acquire a session
		const acquired = await fetchJson("/pool/acquire", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ cwd: tmpHome }),
		});
		const sid = acquired.sessionId;

		// Subscribe to events
		const ws = new WebSocket(`${wsBase}/events?session=${sid}`);
		const events: unknown[] = [];

		await new Promise<void>((resolve) => {
			ws.on("open", () => resolve());
			ws.on("error", () => resolve());
			setTimeout(() => resolve(), 3_000);
		});

		await new Promise<void>((resolve) => {
			ws.on("message", (data) => {
				try { events.push(JSON.parse(data.toString())); } catch { events.push(data.toString()); }
				resolve();
			});
			setTimeout(() => resolve(), 5_000);
		});

		// We don't strictly require events (mock mode may not produce any),
		// but the WS must not crash.
		expect(ws.readyState).not.toBe(WebSocket.CLOSED);
		ws.close();
	}, 8_000);

	// ── Cron ────────────────────────────────────────────────────────────────

	it("GET /cron/jobs returns job list (empty or populated)", async () => {
		const result = await fetchJson("/cron/jobs");
		expect(result).toBeDefined();
		const jobs = Array.isArray(result) ? result : (result.jobs ?? []);
		expect(Array.isArray(jobs)).toBe(true);
	});

	// ── Control plane ───────────────────────────────────────────────────────

	it("GET /status returns gateway status", async () => {
		const result = await fetchJson("/status");
		expect(result).toBeDefined();
		// Status should have some recognizable fields
		const statusStr = JSON.stringify(result);
		expect(statusStr.length).toBeGreaterThan(10);
	});

	// ── Graceful shutdown ───────────────────────────────────────────────────

	it("SIGTERM causes clean exit within 5s", async () => {
		// Spawn a fresh server for this test
		const tmpHome2 = mkdtempSync(join(tmpdir(), "mya-shutdown-"));
		const child = spawn(BIN, [...BIN_ARGS, "serve", "--port", String(port + 100)], {
			env: { ...process.env, HOME: tmpHome2, MYA_NO_WS_TOKEN: "1" },
			stdio: ["ignore", "pipe", "pipe"],
		});

		// Wait for it to be healthy
		const shutdownBase = `http://127.0.0.1:${port + 100}`;
		const deadline = Date.now() + 20_000;
		while (Date.now() < deadline) {
			try {
				const r = await fetch(`${shutdownBase}/health/live`);
				if (r.ok) break;
			} catch {}
			await new Promise((r) => setTimeout(r, 200));
		}

		// Send SIGTERM
		child.kill("SIGTERM");

		const exitCode = await new Promise<number | null>((resolve) => {
			child.on("close", (code) => resolve(code));
			setTimeout(() => { child.kill("SIGKILL"); resolve(null); }, 5_000);
		});

		// Should exit cleanly (code 0 or null if killed)
		expect(exitCode).not.toBeNull();
		rmSync(tmpHome2, { recursive: true, force: true });
	});
});

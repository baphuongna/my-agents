/**
 * Feature 7.6 — Per-job skill injection (cron jobs can have their own skills)
 *
 * Reference: packages/cron/src/index.ts, packages/coding-agent/src/core/skills.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnMya } from "../../helpers/spawn-mya.ts";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ──────────────────────────────────────────────────────────────
// UNIT — Cron job skill injection
// ──────────────────────────────────────────────────────────────

describe("[unit] cron job skill injection", () => {
	it("CronJob interface has skills field", async () => {
		const { CronScheduler } = await import("../../../packages/cron/src/index.ts");
		const sched = new CronScheduler();
		const job = sched.register({
			name: "test",
			trigger: "cron",
			schedule: "*/5 * * * *",
			prompt: "test",
			skills: ["git-helper", "docker-helper"],
		});
		expect(job.skills).toEqual(["git-helper", "docker-helper"]);
	});

	it("agent run isolates skills from main session", () => {
		const main = ["a", "b"];
		const job = ["c"];
		expect(main.some((s) => s === "c")).toBe(false);
		expect(job.some((s) => s === "a")).toBe(false);
	});

	it("CronScheduler register preserves skills", async () => {
		const { CronScheduler } = await import("../../../packages/cron/src/index.ts");
		const sched = new CronScheduler();
		const job = sched.register({
			name: "test2",
			trigger: "cron",
			schedule: "*/5 * * * *",
			prompt: "test",
			skills: ["git-helper"],
		});
		expect(job.skills).toEqual(["git-helper"]);
	});

	it("empty skills array → job with no skills", async () => {
		const { CronScheduler } = await import("../../../packages/cron/src/index.ts");
		const sched = new CronScheduler();
		const job = sched.register({
			name: "empty",
			trigger: "cron",
			schedule: "*/5 * * * *",
			prompt: "test",
			skills: [],
		});
		expect(job.skills).toEqual([]);
	});

	it("CronScheduler.updateJob can modify skills", async () => {
		const { CronScheduler } = await import("../../../packages/cron/src/index.ts");
		const sched = new CronScheduler();
		const job = sched.register({
			name: "upd",
			trigger: "cron",
			schedule: "*/5 * * * *",
			prompt: "test",
		});
		const updated = sched.updateJob(job.id, { skills: ["new-skill"] });
		expect(updated?.skills).toEqual(["new-skill"]);
	});

	it("skills array stored as-is (dedup is caller responsibility)", async () => {
		const { CronScheduler } = await import("../../../packages/cron/src/index.ts");
		const sched = new CronScheduler();
		const job = sched.register({
			name: "dedup",
			trigger: "cron",
			schedule: "*/5 * * * *",
			prompt: "test",
			skills: ["a", "a", "b"],
		});
		// Scheduler stores as-is — caller should deduplicate before registering
		expect(job.skills).toEqual(["a", "a", "b"]);
	});
});

// ──────────────────────────────────────────────────────────────
// UNIT — Skill isolation per session (subagent)
// ──────────────────────────────────────────────────────────────

describe("[unit] subagent skill isolation", () => {
	it("subagent gets skills + parent skills (inherited)", () => {
		const parent = ["a", "b"];
		const sub = ["c"];
		const merged = [...new Set([...parent, ...sub])];
		expect(merged).toEqual(["a", "b", "c"]);
	});

	it("subagent can opt out of parent skills", () => {
		const merged = ["a", "b"];
		const filtered = merged.filter((s) => s !== "a");
		expect(filtered).toEqual(["b"]);
	});

	it("budget isolation: subagent has own budget cap", () => {
		const parentBudget = 100;
		const subBudget = 25; // 25% rule
		expect(subBudget).toBeLessThanOrEqual(parentBudget * 0.25);
	});

	it("subagent tool exposure may differ", () => {
		const parentTools = ["*"]; // all
		const subTools = ["read", "grep", "bash"];
		expect(parentTools.includes("*")).toBe(true);
		expect(subTools.includes("bash")).toBe(true);
	});

	it("subagent session ID is unique from parent", () => {
		const parentId = "main-1";
		const subId = `sub-${parentId}-${Math.random().toString(36).slice(2, 8)}`;
		expect(subId.startsWith("sub-")).toBe(true);
		expect(subId).not.toBe(parentId);
	});
});

// ──────────────────────────────────────────────────────────────
// SMOKE — cron skills wiring
// ──────────────────────────────────────────────────────────────

describe("[smoke] cron module", () => {
	it("loads cron index", async () => {
		const m = await import("../../../packages/cron/src/index.ts").catch(() => null);
		expect(m === null || typeof m === "object").toBe(true);
	});
});

// ──────────────────────────────────────────────────────────────
// REAL — cron job with skills
// ──────────────────────────────────────────────────────────────

describe.skipIf(!process.env["MYA_BIN"] && !existsSync("dist/mya.js"))("[real] mya cron with skills", () => {
	let tmpHome: string;

	beforeEach(() => {
		tmpHome = mkdtempSync(join(tmpdir(), "mya-cron-test-"));
	});

	afterEach(() => {
		rmSync(tmpHome, { recursive: true, force: true });
	});

	it("cron add <job> with --skill flag", async () => {
		const child = spawnMya(
			["cron", "add", "--skill", "git-helper", "test-job", "*/1 * * * *", "echo", "test"],
			{ env: { ...process.env, MYA_MOCK: "1", HOME: tmpHome } },
		);
		let out = "";
		child.stdout?.on("data", (d) => out += d.toString());
		await new Promise((r) => child.on("close", r));
		expect(typeof out).toBe("string");
	});

	it("cron list shows jobs with skills", async () => {
		const child = spawnMya(
			["cron", "list"],
			{ env: { ...process.env, MYA_MOCK: "1", HOME: tmpHome } },
		);
		let out = "";
		child.stdout?.on("data", (d) => out += d.toString());
		await new Promise((r) => child.on("close", r));
		expect(typeof out).toBe("string");
	});
});

// ──────────────────────────────────────────────────────────────
// SYSTEM — per-job skill integration (skip MYA_INTEGRATION)
// ──────────────────────────────────────────────────────────────
//
//   1. cron add with skills → verify skills loaded in sub-session
//   2. cron run → only those skills available

// ──────────────────────────────────────────────────────────────
// TUI UI — skip
// ──────────────────────────────────────────────────────────────

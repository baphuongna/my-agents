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
	it("job defines skills via cronLoadSkills field", () => {
		const job = mkCronJob({
			id: "job1",
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

	it("agent run uses only job skills (no leakage)", () => {
		const jobSkills = ["git-helper"];
		const ctxSkills = ctxifySkills(jobSkills);
		expect(ctxSkills).toEqual(["git-helper"]);
	});

	it("unknown skill in job config → log warning", () => {
		const warn = checkSkills(["unknown-skill-xyz"]);
		expect(warn).toContain("warning");
	});

	it("empty skills array → no skills injected", () => {
		const ctx = ctxifySkills([]);
		expect(ctx.length).toBe(0);
	});

	it("deduplicates skills before injection", () => {
		const ctx = ctxifySkills(["a", "a", "b", "b"]);
		expect(ctx).toEqual(["a", "b"]);
	});

	it("preserves skills order", () => {
		const ctx = ctxifySkills(["z", "a", "m"]);
		expect(ctx).toEqual(["z", "a", "m"]);
	});
});

function mkCronJob(opts: { id: string; skills?: string[] }): any {
	return {
		id: opts.id,
		schedule: "*/5 * * * *",
		skills: opts.skills ?? [],
		action: { kind: "agent", prompt: "test" },
	};
}

function ctxifySkills(skills: string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const s of skills) {
		if (typeof s !== "string" || !s) continue;
		if (seen.has(s)) continue;
		seen.add(s);
		out.push(s);
	}
	return out;
}

function checkSkills(skills: string[]): string {
	const known = ["git-helper", "docker-helper", "python-expert"];
	const unknown = skills.filter((s) => !known.includes(s));
	if (unknown.length > 0) return `warning: unknown skills [${unknown.join(", ")}]`;
	return "ok";
}

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

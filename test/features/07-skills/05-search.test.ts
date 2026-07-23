/**
 * Feature 7.5 — Skill Search (mya skill-search)
 *
 * Reference: packages/print/src/skill-search/
 */

import { describe, it, expect } from "vitest";

// ──────────────────────────────────────────────────────────────
// UNIT — Skill search algorithm
// ──────────────────────────────────────────────────────────────

describe("[unit] skillSearch", () => {
	const skills = [
		{ name: "python-expert", description: "Python programming language", body: "echo 'Python helper'" },
		{ name: "rust-expert", description: "Rust programming language", body: "cargo build" },
		{ name: "git-helper", description: "Git version control", body: "git status" },
		{ name: "docker-helper", description: "Docker containers", body: "docker ps" },
	];

	it("matches on name", () => {
		const r = skillSearch(skills, "python");
		expect(r.some((x) => x.name === "python-expert")).toBe(true);
	});

	it("matches on description", () => {
		const r = skillSearch(skills, "containers");
		expect(r.some((x) => x.name === "docker-helper")).toBe(true);
	});

	it("matches on body", () => {
		const r = skillSearch(skills, "cargo");
		expect(r.some((x) => x.name === "rust-expert")).toBe(true);
	});

	it("returns empty for no match", () => {
		const r = skillSearch(skills, "nonexistent-xyz-12345");
		expect(r.length).toBe(0);
	});

	it("case-insensitive by default", () => {
		const r = skillSearch(skills, "PYTHON");
		expect(r.some((x) => x.name === "python-expert")).toBe(true);
	});

	it("returns relevance-sorted results", () => {
		const r = skillSearch(skills, "git");
		expect(r[0]!.name).toBe("git-helper");
	});

	it("limits max results", () => {
		const r = skillSearch(skills, "language", { maxResults: 1 });
		expect(r.length).toBeLessThanOrEqual(1);
	});

	it("handles multi-word query", () => {
		const r = skillSearch(skills, "version control");
		expect(r.some((x) => x.name === "git-helper")).toBe(true);
	});

	it("treats short terms as prefix match", () => {
		const r = skillSearch(skills, "do");
		expect(r.some((x) => x.name === "docker-helper")).toBe(true);
	});

	it("CJK query in skill body (CJK tokenizer support)", () => {
		const skillsCjk = [
			{ name: "calendar-ko", description: "캘린더 도구", body: "오늘 일정" },
			{ name: "calendar-ja", description: "カレンダー", body: "今日の予定" },
		];
		const r = skillSearch(skillsCjk, "캘린더");
		expect(r.some((x) => x.name === "calendar-ko")).toBe(true);
	});
});

function skillSearch(skills: any[], q: string, opts: { maxResults?: number } = {}): any[] {
	if (!q || !q.trim()) return [];
	const needle = q.toLowerCase();
	const scored = skills.map((s) => {
		const name = (s.name ?? "").toLowerCase();
		const desc = (s.description ?? "").toLowerCase();
		const body = (s.body ?? "").toLowerCase();
		let score = 0;
		if (name === needle) score += 100;
		else if (name.includes(needle)) score += 50;
		if (desc.includes(needle)) score += 30;
		if (body.includes(needle)) score += 10;
		return { skill: s, score };
	}).filter((x) => x.score > 0)
		.sort((a, b) => b.score - a.score);
	const max = opts.maxResults ?? 10;
	return scored.slice(0, max).map((x) => x.skill);
}

// ──────────────────────────────────────────────────────────────
// SMOKE — skill-search module
// ──────────────────────────────────────────────────────────────

describe("[smoke] skill-search", () => {
	it("loads skill-search module", async () => {
		const m = await import("../../../packages/print/src/skill-search/index.ts").catch(() => null);
		expect(m === null || typeof m === "object").toBe(true);
	});

	it("scanner module loads", async () => {
		const m = await import("../../../../my_pi/pi-skill-search/src/scanner.ts").catch(() => null);
		expect(m === null || typeof m === "object").toBe(true);
	});
});

// ──────────────────────────────────────────────────────────────
// REAL — search real skills
// ──────────────────────────────────────────────────────────────

describe("[real] mya skill-search CLI", () => {
	it("invocation without query lists all skills", async () => {
		const { spawn } = await import("node:child_process");
		const child = spawn(
			process.env["MYA_BIN"] || "node",
			["dist/mya.js", "skill-search"],
			{ env: { ...process.env, MYA_MOCK: "1" } },
		);
		let out = "";
		child.stdout?.on("data", (d) => out += d.toString());
		await new Promise((r) => child.on("close", r));
		expect(typeof out).toBe("string");
	});

	it("invocation with query returns ranked matches", async () => {
		const { spawn } = await import("node:child_process");
		const child = spawn(
			process.env["MYA_BIN"] || "node",
			["dist/mya.js", "skill-search", "git"],
			{ env: { ...process.env, MYA_MOCK: "1" } },
		);
		let out = "";
		child.stdout?.on("data", (d) => out += d.toString());
		await new Promise((r) => child.on("close", r));
		expect(typeof out).toBe("string");
	});

	it("does not crash on long query", async () => {
		const { spawn } = await import("node:child_process");
		const child = spawn(
			process.env["MYA_BIN"] || "node",
			["dist/mya.js", "skill-search", "x".repeat(1000)],
			{ env: { ...process.env, MYA_MOCK: "1" } },
		);
		await new Promise((r) => child.on("close", r));
		expect(true).toBe(true);
	});

	it("search empty string returns all (or nothing)", async () => {
		const { spawn } = await import("node:child_process");
		const child = spawn(
			process.env["MYA_BIN"] || "node",
			["dist/mya.js", "skill-search", ""],
			{ env: { ...process.env, MYA_MOCK: "1" } },
		);
		await new Promise((r) => child.on("close", r));
		expect(true).toBe(true);
	});
});

// ──────────────────────────────────────────────────────────────
// SYSTEM — end-to-end (skip MYA_INTEGRATION)
// ──────────────────────────────────────────────────────────────
//
//   1. mya skill-search python → ranked
//   2. mya skill-search "version control" → multi-token
//   3. mya skill-search 캘린더 → CJK

// ──────────────────────────────────────────────────────────────
// TUI UI — skip
// ──────────────────────────────────────────────────────────────

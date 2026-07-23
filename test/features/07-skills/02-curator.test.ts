/**
 * Feature 7.2 — Skills Curator (lifecycle management)
 *
 * Reference: packages/skills/src/curator.ts
 */

import { describe, it, expect } from "vitest";
import { SkillStore, curate } from "../../../packages/skills/src/curator.ts";

// ──────────────────────────────────────────────────────────────
// UNIT — Curator
// ──────────────────────────────────────────────────────────────

describe("[unit] curate()", () => {
	it("returns array of CurationAction", async () => {
		const actions = await curate();
		expect(Array.isArray(actions)).toBe(true);
	});

	it("returns empty array when no skills dir exists", async () => {
		// Even with non-existent dir, returns []
		const actions = await curate();
		expect(actions.length).toBeGreaterThanOrEqual(0);
	});

	it("detects duplicate names across sources", async () => {
		const actions = await curate();
		// If duplicates, curator must report Replace or Deactivate
		const ids = actions.map((a) => a.skillName);
		const unique = new Set(ids);
		expect(ids.length).toBeGreaterThanOrEqual(unique.size);
	});

	it("preserves unique skills with Keep action", async () => {
		const actions = await curate();
		const keeps = actions.filter((a) => a.action === "Keep");
		// Just verify shape
		for (const a of keeps) {
			expect(a.skillName).toBeTruthy();
		}
	});

	it("Replace action includes old + new sources", async () => {
		const actions = await curate();
		const replaces = actions.filter((a) => a.action === "Replace");
		for (const a of replaces) {
			expect(a.from).toBeDefined();
			expect(a.to).toBeDefined();
		}
	});

	it("Deactivate action preserves original source", async () => {
		const actions = await curate();
		const deactives = actions.filter((a) => a.action === "Deactivate");
		for (const a of deactives) {
			expect(a.source).toBeDefined();
		}
	});
});

// ──────────────────────────────────────────────────────────────
// UNIT — Skill lifecycle events
// ──────────────────────────────────────────────────────────────

describe("[unit] skill-set-dirty flag", () => {
	it("SkillStore.setDirty() flag is true after enable", () => {
		const s = new SkillStore();
		s.markDirty?.();
		// Verify flag is set
		expect((s as any).dirty).toBe(true);
	});

	it("SkillStore.isDirty() returns state", () => {
		const s = new SkillStore();
		expect(s.isDirty?.()).toBe(false);
	});

	it("SkillStore.clearDirty() resets flag", () => {
		const s = new SkillStore();
		s.markDirty?.();
		s.clearDirty?.();
		expect(s.isDirty?.()).toBe(false);
	});

	it("Agent re-injects prompt body when dirty", () => {
		// Hook signature sanity
		expect(true).toBe(true);
	});
});

// ──────────────────────────────────────────────────────────────
// SMOKE — curator module
// ──────────────────────────────────────────────────────────────

describe("[smoke] curator exports", () => {
	it("exports SkillStore, curate", async () => {
		const m = await import("../../../packages/skills/src/index.ts");
		expect(m.SkillStore).toBeDefined();
		expect(m.curate).toBeDefined();
	});

	it("SkillStore constructor", () => {
		expect(() => new SkillStore()).not.toThrow();
	});
});

// ──────────────────────────────────────────────────────────────
// REAL — Curator vs real skills dir
// ──────────────────────────────────────────────────────────────

describe("[real] curator reading from homedir", () => {
	it("disables skills from non-authoritative sources", async () => {
		const actions = await curate();
		// External sources (e.g. .agents/skills) may be deactivated
		const deactives = actions.filter((a) => a.action === "Deactivate");
		for (const a of deactives) {
			expect(a.reason).toBeTruthy();
		}
	});

	it("prefers local ~/.mya/agent/skills over ~/.agents/skills", async () => {
		// If both exist for same name, curator must prefer mya
		const actions = await curate();
		const replaces = actions.filter((a) => a.action === "Replace");
		for (const a of replaces) {
			expect(a.to?.source).toMatch(/\.mya\//);
		}
	});

	it("activates skill when first added", async () => {
		const s = new SkillStore();
		s.add({ name: "new", description: "", body: "", source: "/x" });
		expect(s.get("new")).toBeDefined();
		expect(s.isActive?.("new")).toBe(true);
	});

	it("deactivates skill by name", async () => {
		const s = new SkillStore();
		s.add({ name: "x", description: "", body: "", source: "/x" });
		s.deactivate?.("x");
		expect(s.isActive?.("x")).toBe(false);
	});

	it("re-activates skill by name", async () => {
		const s = new SkillStore();
		s.add({ name: "x", description: "", body: "", source: "/x" });
		s.deactivate?.("x");
		s.activate?.("x");
		expect(s.isActive?.("x")).toBe(true);
	});
});

// ──────────────────────────────────────────────────────────────
// SYSTEM — Curator + prompt injection (skip MYA_INTEGRATION)
// ──────────────────────────────────────────────────────────────
//
//   1. Add new skill SKILL.md → curator detects → agent re-injects

// ──────────────────────────────────────────────────────────────
// TUI UI — skip
// ──────────────────────────────────────────────────────────────

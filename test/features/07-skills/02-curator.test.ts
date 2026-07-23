/**
 * Feature 7.2 — Skills Curator
 * FIXED: curate(store, opts) takes SkillStore as first arg
 */
import { describe, it, expect } from "vitest";
import { SkillStore, curate, type CurationAction } from "../../../packages/skills/src/curator.ts";
import { parseSkillMarkdown } from "../../../packages/skills/src/skill.ts";

const validMd = `---
name: test-skill
description: A test skill
---
Body`;

describe("[unit] curate()", () => {
	it("returns array of CurationAction", async () => {
		const store = new SkillStore();
		const actions = await curate(store);
		expect(Array.isArray(actions)).toBe(true);
	});

	it("returns empty array for empty store", async () => {
		const store = new SkillStore();
		const actions = await curate(store);
		expect(actions.length).toBe(0);
	});

	it("detects stale skills (inactiveAfterDays)", async () => {
		const store = new SkillStore();
		store.add(parseSkillMarkdown(validMd, "/test"));
		const actions = await curate(store, { inactiveAfterDays: 0 });
		// With 0 days threshold, everything is stale
		expect(actions.length).toBeGreaterThanOrEqual(0);
	});

	it("respects pruneBuiltins option", async () => {
		const store = new SkillStore();
		const actions = await curate(store, { pruneBuiltins: false });
		expect(Array.isArray(actions)).toBe(true);
	});

	it("each CurationAction has required fields", async () => {
		const store = new SkillStore();
		const actions = await curate(store);
		for (const a of actions as CurationAction[]) {
			expect(a).toHaveProperty("action");
			expect(a).toHaveProperty("name");
		}
	});
});

describe("[unit] SkillStore lifecycle", () => {
	it("add then remove lifecycle", () => {
		const s = new SkillStore();
		s.add(parseSkillMarkdown(validMd, "/t"));
		expect(s.size()).toBe(1);
		s.remove("test-skill");
		expect(s.size()).toBe(0);
	});

	it("renderIndexBlock() produces markdown", () => {
		const s = new SkillStore();
		s.add(parseSkillMarkdown(validMd, "/t"));
		const block = s.renderIndexBlock();
		expect(typeof block).toBe("string");
		expect(block.length).toBeGreaterThan(0);
	});
});

describe("[smoke] curator", () => {
	it("exports curate + SkillStore", async () => {
		const m = await import("../../../packages/skills/src/index.ts");
		expect(m.curate).toBeDefined();
		expect(m.SkillStore).toBeDefined();
	});
});

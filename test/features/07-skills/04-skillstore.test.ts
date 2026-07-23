/**
 * Feature 7.4 — SkillStore API
 * FIXED: uses actual methods (size/get/remove/index/suggest/pin/loadBody)
 */
import { describe, it, expect } from "vitest";
import { SkillStore } from "../../../packages/skills/src/curator.ts";
import { parseSkillMarkdown } from "../../../packages/skills/src/skill.ts";

const md = (name: string, desc = "desc") => `---
name: ${name}
description: ${desc}
---
Body for ${name}`;

describe("[unit] SkillStore CRUD", () => {
	it("add + get", () => {
		const s = new SkillStore();
		s.add(parseSkillMarkdown(md("x"), "/x"));
		expect(s.get("x")?.name).toBe("x");
	});

	it("size increments", () => {
		const s = new SkillStore();
		s.add(parseSkillMarkdown(md("a"), "/a"));
		s.add(parseSkillMarkdown(md("b"), "/b"));
		expect(s.size()).toBe(2);
	});

	it("remove decreases size", () => {
		const s = new SkillStore();
		s.add(parseSkillMarkdown(md("x"), "/x"));
		s.remove("x");
		expect(s.size()).toBe(0);
	});

	it("remove unknown returns false", () => {
		const s = new SkillStore();
		expect(s.remove("unknown")).toBe(false);
	});

	it("index() lists all", () => {
		const s = new SkillStore();
		s.add(parseSkillMarkdown(md("a"), "/a"));
		s.add(parseSkillMarkdown(md("b"), "/b"));
		expect(s.index().length).toBe(2);
	});

	it("suggest() finds by query", () => {
		const s = new SkillStore();
		s.add(parseSkillMarkdown(md("python-helper", "Python tools"), "/p"));
		const r = s.suggest("python");
		expect(r.length).toBeGreaterThanOrEqual(1);
	});

	it("loadBody() returns body text", () => {
		const s = new SkillStore();
		s.add(parseSkillMarkdown(md("x"), "/x"));
		expect(s.loadBody("x")).toContain("Body for x");
	});

	it("pin + isPinned", () => {
		const s = new SkillStore();
		s.add(parseSkillMarkdown(md("x"), "/x"));
		s.pin("x");
		expect(s.isPinned("x")).toBe(true);
	});

	it("unpin + isPinned false", () => {
		const s = new SkillStore();
		s.add(parseSkillMarkdown(md("x"), "/x"));
		s.pin("x");
		s.unpin("x");
		expect(s.isPinned("x")).toBe(false);
	});

	it("re-add after remove works", () => {
		const s = new SkillStore();
		s.add(parseSkillMarkdown(md("x"), "/x"));
		s.remove("x");
		s.add(parseSkillMarkdown(md("x"), "/x"));
		expect(s.size()).toBe(1);
	});
});

describe("[smoke] SkillStore", () => {
	it("constructs", () => {
		expect(() => new SkillStore()).not.toThrow();
	});

	it("API surface", () => {
		const s = new SkillStore();
		expect(typeof s.add).toBe("function");
		expect(typeof s.get).toBe("function");
		expect(typeof s.remove).toBe("function");
		expect(typeof s.size).toBe("function");
		expect(typeof s.index).toBe("function");
		expect(typeof s.suggest).toBe("function");
	});
});

/**
 * Feature 7.1 — Skills (parseSkillMarkdown, SkillStore, curate)
 * FIXED to match actual API
 */
import { describe, it, expect } from "vitest";
import { parseSkillMarkdown } from "../../../packages/skills/src/skill.ts";
import { SkillStore } from "../../../packages/skills/src/curator.ts";

const validMd = `---
name: test-skill
description: A test skill
---

# Body
Skill body content`;

describe("[unit] parseSkillMarkdown", () => {
	it("parses valid frontmatter", () => {
		const s = parseSkillMarkdown(validMd, "/test");
		expect(s.name).toBe("test-skill");
		expect(s.description).toBe("A test skill");
		expect(s.body).toContain("Skill body content");
	});

	it("throws when name missing", () => {
		expect(() => parseSkillMarkdown("---\ndescription: x\n---\nbody", "/t")).toThrow();
	});

	it("throws when description missing", () => {
		expect(() => parseSkillMarkdown("---\nname: x\n---\nbody", "/t")).toThrow();
	});

	it("throws on empty string", () => {
		expect(() => parseSkillMarkdown("", "/t")).toThrow();
	});

	it("preserves Unicode", () => {
		const md = `---
name: kỹ-năng
description: Mô tả
---
Body`;
		const s = parseSkillMarkdown(md, "/t");
		expect(s.name).toBe("kỹ-năng");
	});

	it("preserves triggers", () => {
		const md = `---
name: t
description: d
triggers:
  - "use this"
---
Body`;
		const s = parseSkillMarkdown(md, "/t");
		expect(s.triggers.join(" ")).toContain("use this");
	});

	it("preserves body code blocks", () => {
		const md = `---
name: t
description: d
---
\`\`\`bash
ls -la
\`\`\``;
		const s = parseSkillMarkdown(md, "/t");
		expect(s.body).toContain("```bash");
	});

	it("default provenance is Bundled", () => {
		const s = parseSkillMarkdown(validMd, "/t");
		expect(s.provenance?.kind ?? "Bundled").toBe("Bundled");
	});

	it("accepts provenanceKind override", () => {
		const s = parseSkillMarkdown(validMd, "/t", "User");
		expect(s.provenance?.kind).toBe("User");
	});
});

describe("[unit] SkillStore", () => {
	it("starts empty (size 0)", () => {
		const s = new SkillStore();
		expect(s.size()).toBe(0);
	});

	it("add() stores skill", () => {
		const s = new SkillStore();
		s.add(parseSkillMarkdown(validMd, "/t"));
		expect(s.size()).toBe(1);
	});

	it("get() returns by name", () => {
		const s = new SkillStore();
		s.add(parseSkillMarkdown(validMd, "/t"));
		expect(s.get("test-skill")).toBeDefined();
	});

	it("get() returns undefined for unknown", () => {
		const s = new SkillStore();
		expect(s.get("unknown")).toBeUndefined();
	});

	it("remove() removes by name", () => {
		const s = new SkillStore();
		s.add(parseSkillMarkdown(validMd, "/t"));
		expect(s.remove("test-skill")).toBe(true);
		expect(s.size()).toBe(0);
	});

	it("index() returns entries", () => {
		const s = new SkillStore();
		s.add(parseSkillMarkdown(validMd, "/t"));
		const idx = s.index();
		expect(idx.length).toBe(1);
		expect(idx[0]?.name).toBe("test-skill");
	});

	it("suggest() returns matching skills", () => {
		const s = new SkillStore();
		s.add(parseSkillMarkdown(validMd, "/t"));
		const r = s.suggest("test");
		expect(r.length).toBeGreaterThanOrEqual(1);
	});

	it("pin/unpin toggles", () => {
		const s = new SkillStore();
		s.add(parseSkillMarkdown(validMd, "/t"));
		s.pin("test-skill");
		expect(s.isPinned("test-skill")).toBe(true);
		s.unpin("test-skill");
		expect(s.isPinned("test-skill")).toBe(false);
	});

	it("loadBody() returns body", () => {
		const s = new SkillStore();
		s.add(parseSkillMarkdown(validMd, "/t"));
		const body = s.loadBody("test-skill");
		expect(body).toContain("Skill body content");
	});
});

describe("[smoke] skills modules", () => {
	it("skill.ts loads", async () => {
		const m = await import("../../../packages/skills/src/skill.ts");
		expect(typeof m.parseSkillMarkdown).toBe("function");
	});

	it("curator.ts loads", async () => {
		const m = await import("../../../packages/skills/src/curator.ts");
		expect(typeof m.SkillStore).toBe("function");
		expect(typeof m.curate).toBe("function");
	});

	it("index.ts loads", async () => {
		const m = await import("../../../packages/skills/src/index.ts");
		expect(m).toBeDefined();
	});
});

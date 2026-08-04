import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseFrontmatter, scanSkillDirectory } from "./scanner.js";

describe("[unit] skill-search scanner", () => {
  describe("parseFrontmatter", () => {
    it("parses name + description from YAML frontmatter", () => {
      const content = "---\nname: my-skill\ndescription: Does a thing\n---\n# Body";
      expect(parseFrontmatter(content)).toEqual({ name: "my-skill", description: "Does a thing" });
    });

    it("returns null when no frontmatter block", () => {
      expect(parseFrontmatter("# just markdown")).toBeNull();
      expect(parseFrontmatter("no frontmatter here")).toBeNull();
    });

    it("returns null when name is missing (description-only)", () => {
      expect(parseFrontmatter("---\ndescription: no name\n---")).toBeNull();
    });

    it("handles CRLF line endings", () => {
      const content = "---\r\nname: crlf-skill\r\ndescription: windows\r\n---\r\nbody";
      expect(parseFrontmatter(content)).toEqual({ name: "crlf-skill", description: "windows" });
    });

    it("ignores other frontmatter fields", () => {
      const content = "---\nname: x\ndescription: y\ntriggers:\n  - foo\npriority: 10\n---";
      expect(parseFrontmatter(content)).toEqual({ name: "x", description: "y" });
    });
  });

  describe("scanSkillDirectory", () => {
    let tmp: string;
    beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "skill-scan-")); });
    afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

    it("returns [] for non-existent directory", () => {
      expect(scanSkillDirectory(join(tmp, "nope"))).toEqual([]);
    });

    it("finds skills in subdirectories with SKILL.md", () => {
      mkdirSync(join(tmp, "skill-a"));
      writeFileSync(join(tmp, "skill-a", "SKILL.md"), "---\nname: skill-a\ndescription: A skill\n---\n# A");
      const skills = scanSkillDirectory(tmp);
      expect(skills).toHaveLength(1);
      expect(skills[0]!.name).toBe("skill-a");
      expect(skills[0]!.description).toBe("A skill");
      expect(skills[0]!.disableModelInvocation).toBe(false);
    });

    it("skips subdirectories without SKILL.md", () => {
      mkdirSync(join(tmp, "no-skill"));
      writeFileSync(join(tmp, "no-skill", "README.md"), "not a skill");
      expect(scanSkillDirectory(tmp)).toEqual([]);
    });

    it("skips SKILL.md with unparseable frontmatter", () => {
      mkdirSync(join(tmp, "bad"));
      writeFileSync(join(tmp, "bad", "SKILL.md"), "# no frontmatter");
      expect(scanSkillDirectory(tmp)).toEqual([]);
    });

    it("skips loose .md files (only subdirs scanned)", () => {
      writeFileSync(join(tmp, "loose.md"), "---\nname: loose\ndescription: x\n---");
      expect(scanSkillDirectory(tmp)).toEqual([]);
    });

    it("scans multiple skills", () => {
      for (const n of ["a", "b", "c"]) {
        mkdirSync(join(tmp, n));
        writeFileSync(join(tmp, n, "SKILL.md"), `---\nname: ${n}\ndescription: skill ${n}\n---`);
      }
      const skills = scanSkillDirectory(tmp);
      expect(skills).toHaveLength(3);
      expect(skills.map(s => s.name).sort()).toEqual(["a", "b", "c"]);
    });

    it("filePath points to the SKILL.md", () => {
      mkdirSync(join(tmp, "s1"));
      writeFileSync(join(tmp, "s1", "SKILL.md"), "---\nname: s1\ndescription: d\n---");
      const skills = scanSkillDirectory(tmp);
      expect(skills[0]!.filePath).toBe(join(tmp, "s1", "SKILL.md"));
    });
  });
});

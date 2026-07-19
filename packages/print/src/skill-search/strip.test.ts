/**
 * Tests cho strip regex — SPEC §7.3.
 *
 * Ported from pi-skill-search/test/strip.test.ts — imports adapted to ESM (.js).
 */
import { describe, expect, it } from "vitest";
import { AVAILABLE_SKILLS_BLOCK_REGEX, detectSkillsBlock, stripAvailableSkillsBlock } from "./strip.js";

const PREAMBLE = "You are a helpful coding assistant.";
const SKILLS_BLOCK = `

The following skills provide specialized instructions for specific tasks.
Use the read tool to load a skill's file when the task matches its description.
When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.

<available_skills>
  <skill>
    <name>rdkit</name>
    <description>Cheminformatics toolkit</description>
    <location>/skills/rdkit/SKILL.md</location>
  </skill>
  <skill>
    <name>scanpy</name>
    <description>Single-cell analysis</description>
    <location>/skills/scanpy/SKILL.md</location>
  </skill>
</available_skills>`;

describe("stripAvailableSkillsBlock", () => {
	it("strips <available_skills> block from systemPrompt", () => {
		const input = PREAMBLE + SKILLS_BLOCK;
		const result = stripAvailableSkillsBlock(input);
		expect(result).not.toContain("<available_skills>");
		expect(result).not.toContain("</available_skills>");
		expect(result).toContain(PREAMBLE);
	});

	it("is no-op when no <available_skills> block present", () => {
		const input = PREAMBLE;
		const result = stripAvailableSkillsBlock(input);
		expect(result).toBe(input);
	});

	it("removes the lead-in sentence", () => {
		const input = PREAMBLE + SKILLS_BLOCK;
		const result = stripAvailableSkillsBlock(input);
		expect(result).not.toContain("The following skills provide specialized instructions");
	});
});

describe("detectSkillsBlock", () => {
	it("returns true when block is present", () => {
		expect(detectSkillsBlock(PREAMBLE + SKILLS_BLOCK)).toBe(true);
	});

	it("returns false when block is absent", () => {
		expect(detectSkillsBlock(PREAMBLE)).toBe(false);
	});

	it("returns false for drift case (reworded lead-in)", () => {
		const drifted = `${PREAMBLE}

The following capabilities provide specialized instructions for specific tasks.

<available_skills>
  <skill><name>test</name></skill>
</available_skills>`;
		expect(detectSkillsBlock(drifted)).toBe(false);
	});
});

describe("AVAILABLE_SKILLS_BLOCK_REGEX", () => {
	it("matches the expected block format", () => {
		expect(AVAILABLE_SKILLS_BLOCK_REGEX.test(SKILLS_BLOCK)).toBe(true);
	});
});

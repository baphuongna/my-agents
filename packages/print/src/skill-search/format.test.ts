/**
 * Tests cho output formatters — SPEC §4.4, §4.5, §6.3.
 *
 * Ported from pi-skill-search/test/format.test.ts — imports adapted to ESM (.js).
 */
import { describe, expect, it } from "vitest";
import { estimateTokens, formatCategorySummary, formatResults, renderToolDescription } from "./format.js";
import { buildIndex } from "./indexer.js";
import type { PiSkill } from "./types.js";

const testSkills: PiSkill[] = [
	{
		name: "rdkit",
		description: "Cheminformatics toolkit for fine-grained molecular control and drug design with SMILES support",
		filePath: "/skills/rdkit/SKILL.md",
		disableModelInvocation: false,
	},
	{
		name: "scanpy",
		description: "Single-cell RNA-seq analysis and gene expression toolkit for bioinformatics and genomics",
		filePath: "/skills/scanpy/SKILL.md",
		disableModelInvocation: false,
	},
	{
		name: "pytorch",
		description: "Deep learning and neural network framework for machine learning model training",
		filePath: "/skills/pytorch/SKILL.md",
		disableModelInvocation: false,
	},
];

const index = buildIndex(testSkills);

describe("formatCategorySummary", () => {
	it("produces output ≤ 250 tokens", () => {
		const summary = formatCategorySummary(index);
		expect(estimateTokens(summary)).toBeLessThanOrEqual(250);
	});

	it("contains ## Available Skill Domains", () => {
		const summary = formatCategorySummary(index);
		expect(summary).toContain("## Available Skill Domains");
	});

	it("mentions skill-search tool", () => {
		const summary = formatCategorySummary(index);
		expect(summary).toContain("skill-search");
	});

	it("omits empty categories", () => {
		const summary = formatCategorySummary(index);
		// Khong co "Other" vi moi skill deu co category
		expect(summary).not.toContain("**Other**:");
	});
});

describe("renderToolDescription", () => {
	it("is deterministic given identical index", () => {
		const desc1 = renderToolDescription(index);
		const desc2 = renderToolDescription(index);
		expect(desc1).toBe(desc2);
	});

	it("contains category names", () => {
		const desc = renderToolDescription(index);
		expect(desc.toLowerCase()).toContain("cheminformatics");
	});

	it("mentions example queries", () => {
		const desc = renderToolDescription(index);
		expect(desc).toContain("Try queries like:");
	});
});

describe("formatResults", () => {
	it("formats 5 results correctly", () => {
		const results = [
			{ name: "rdkit", description: "Molecular toolkit", path: "/rdkit/SKILL.md", score: 50 },
			{ name: "datamol", description: "RDKit wrapper", path: "/datamol/SKILL.md", score: 20 },
		];
		const output = formatResults("molecular", results, 10);
		expect(output).toContain('Found 2 skills for "molecular"');
		expect(output).toContain("rdkit");
		expect(output).toContain("score: 50.00");
		expect(output).toContain("Path: /rdkit/SKILL.md");
	});

	it("handles empty results", () => {
		const output = formatResults("nonexistent", [], 10);
		expect(output).toContain("No skills found matching");
		expect(output).toContain("10 skills indexed");
	});

	it("includes read tool hint", () => {
		const results = [{ name: "test", description: "Test", path: "/test/SKILL.md", score: 10 }];
		const output = formatResults("test", results, 5);
		expect(output).toContain("read");
	});
});

describe("estimateTokens", () => {
	it("returns positive number for non-empty text", () => {
		expect(estimateTokens("hello world")).toBeGreaterThan(0);
	});

	it("returns 0 for empty string", () => {
		expect(estimateTokens("")).toBe(0);
	});
});

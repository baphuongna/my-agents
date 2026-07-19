/**
 * Tests cho index builder — SPEC §6.4.
 *
 * Ported from pi-skill-search/test/indexer.test.ts — imports adapted to ESM (.js).
 */
import { describe, expect, it } from "vitest";
import { buildIndex, fingerprintSkills } from "./indexer.js";
import type { PiSkill } from "./types.js";

const testSkills: PiSkill[] = [
	{
		name: "rdkit",
		description: "Cheminformatics toolkit for fine-grained molecular control and drug design",
		filePath: "/skills/rdkit/SKILL.md",
		disableModelInvocation: false,
	},
	{
		name: "scanpy",
		description: "Single-cell RNA-seq analysis and gene expression toolkit for genomics",
		filePath: "/skills/scanpy/SKILL.md",
		disableModelInvocation: false,
	},
	{
		name: "pytorch",
		description: "Deep learning and neural network framework for machine learning",
		filePath: "/skills/pytorch/SKILL.md",
		disableModelInvocation: false,
	},
];

describe("buildIndex", () => {
	it("is deterministic — same input produces identical output", () => {
		const idx1 = buildIndex(testSkills);
		const idx2 = buildIndex(testSkills);
		expect(idx1.entries.size).toBe(idx2.entries.size);
		expect(idx1.categories.length).toBe(idx2.categories.length);
	});

	it("categories ordering matches CATEGORY_RULES declaration order", () => {
		const idx = buildIndex(testSkills);
		const names = idx.categories.map((c) => c.name);
		// Cheminformatics truoc Bioinformatics truoc ML
		if (names.includes("Cheminformatics & Drug Discovery") && names.includes("Bioinformatics & Genomics")) {
			expect(names.indexOf("Cheminformatics & Drug Discovery")).toBeLessThan(
				names.indexOf("Bioinformatics & Genomics"),
			);
		}
		if (names.includes("Bioinformatics & Genomics") && names.includes("Machine Learning & AI")) {
			expect(names.indexOf("Bioinformatics & Genomics")).toBeLessThan(names.indexOf("Machine Learning & AI"));
		}
	});

	it("examples retain insertion order, sliced to maxExamples", () => {
		const idx = buildIndex(testSkills);
		for (const cat of idx.categories) {
			expect(cat.examples.length).toBeLessThanOrEqual(5);
		}
	});

	it("handles empty skills", () => {
		const idx = buildIndex([]);
		expect(idx.entries.size).toBe(0);
		expect(idx.categories.length).toBe(0);
	});

	it("handles single skill", () => {
		const idx = buildIndex([testSkills[0]!]);
		expect(idx.entries.size).toBe(1);
		expect(idx.entries.has("rdkit")).toBe(true);
	});

	it("builds entries map from skills", () => {
		const idx = buildIndex(testSkills);
		expect(idx.entries.has("rdkit")).toBe(true);
		expect(idx.entries.has("scanpy")).toBe(true);
		expect(idx.entries.has("pytorch")).toBe(true);
	});

	it("filters disabled skills should happen outside buildIndex", () => {
		// buildIndex khong filter — do do filter truoc khi goi
		const disabled: PiSkill = {
			name: "disabled-skill",
			description: "A skill that should be filtered before indexing",
			filePath: "/skills/disabled/SKILL.md",
			disableModelInvocation: true,
		};
		const idx = buildIndex([disabled]);
		expect(idx.entries.has("disabled-skill")).toBe(true);
		// Caller phai filter truoc khi index
	});
});

describe("fingerprintSkills", () => {
	it("is stable for same input", () => {
		const fp1 = fingerprintSkills(testSkills);
		const fp2 = fingerprintSkills(testSkills);
		expect(fp1).toBe(fp2);
	});

	it("changes when skills differ", () => {
		const fp1 = fingerprintSkills(testSkills);
		const fp2 = fingerprintSkills([...testSkills, testSkills[0]!]);
		expect(fp1).not.toBe(fp2);
	});

	it("sorts by filePath regardless of input order", () => {
		const fp1 = fingerprintSkills(testSkills);
		const fp2 = fingerprintSkills([...testSkills].reverse());
		expect(fp1).toBe(fp2);
	});
});

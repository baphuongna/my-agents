/**
 * Tests cho category classifier — SPEC §6.1, §6.2.
 *
 * Ported from pi-skill-search/test/classify.test.ts — imports adapted to ESM (.js).
 */
import { describe, expect, it } from "vitest";
import { CATEGORY_RULES, classify } from "./categories.js";

describe("classify", () => {
	it("classifies rdkit description into Cheminformatics", () => {
		const result = classify({
			name: "rdkit",
			description: "Cheminformatics toolkit for fine-grained molecular control and drug design",
		});
		expect(result).toContain("Cheminformatics & Drug Discovery");
	});

	it("classifies deepchem into multiple categories", () => {
		const result = classify({
			name: "deepchem",
			description: "Machine learning and deep learning for drug discovery and molecular science",
		});
		expect(result).toContain("Cheminformatics & Drug Discovery");
		expect(result).toContain("Machine Learning & AI");
	});

	it("returns Other for skill with no matching rule", () => {
		const result = classify({
			name: "xyzzy",
			description: "A totally unique tool that does nothing related to science",
		});
		expect(result).toEqual(["Other"]);
	});

	it("returns Other for empty description", () => {
		const result = classify({
			name: "mystery",
			description: "",
		});
		expect(result).toEqual(["Other"]);
	});

	it("is deterministic — same input produces same output", () => {
		const entry = {
			name: "scanpy",
			description: "Single-cell RNA-seq analysis and gene expression toolkit",
		};
		const result1 = classify(entry);
		const result2 = classify(entry);
		expect(result1).toEqual(result2);
	});

	it("matches keyword from name", () => {
		const result = classify({
			name: "pytorch-lightning",
			description: "Training framework for deep learning models",
		});
		expect(result).toContain("Machine Learning & AI");
	});
});

describe("CATEGORY_RULES", () => {
	it("has exactly 14 rules", () => {
		expect(CATEGORY_RULES.length).toBe(14);
	});

	it("each rule has non-empty name and keywords", () => {
		for (const rule of CATEGORY_RULES) {
			expect(rule.name.length).toBeGreaterThan(0);
			expect(rule.keywords.length).toBeGreaterThan(0);
			expect(rule.maxExamples).toBeGreaterThanOrEqual(1);
		}
	});
});

/**
 * Tests cho search algorithm — SPEC §5.1, §5.4.
 *
 * Ported from pi-skill-search/test/search.test.ts — imports adapted to ESM (.js).
 */
import { describe, expect, it } from "vitest";
import { buildIndex } from "./indexer.js";
import { search } from "./search.js";
import type { PiSkill } from "./types.js";

// Fixture skills cho search tests
const skills: PiSkill[] = [
	{
		name: "rdkit",
		description: "Cheminformatics toolkit for fine-grained molecular control and drug design with SMILES support",
		filePath: "/skills/rdkit/SKILL.md",
		disableModelInvocation: false,
	},
	{
		name: "datamol",
		description: "Wrapper around RDKit for rapid molecular data science and drug discovery pipelines",
		filePath: "/skills/datamol/SKILL.md",
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
	{
		name: "cobrapy",
		description: "Constraint-based metabolic model reconstruction and pathway flux analysis toolkit",
		filePath: "/skills/cobrapy/SKILL.md",
		disableModelInvocation: false,
	},
	{
		name: "pymatgen",
		description: "Python materials genomics for crystal structure prediction and materials science simulation",
		filePath: "/skills/pymatgen/SKILL.md",
		disableModelInvocation: false,
	},
];

const index = buildIndex(skills);

describe("search", () => {
	it("finds rdkit as primary for rdkit query (not datamol)", () => {
		const results = search(index, "rdkit", 5);
		expect(results.length).toBeGreaterThan(0);
		expect(results[0]?.name).toBe("rdkit");
	});

	it("finds rdkit for molecular query", () => {
		const results = search(index, "molecular", 5);
		expect(results.length).toBeGreaterThan(0);
		expect(results.some((r) => r.name === "rdkit")).toBe(true);
	});

	it("finds scanpy for single-cell query", () => {
		const results = search(index, "single-cell", 5);
		expect(results.some((r) => r.name === "scanpy")).toBe(true);
	});

	it("finds cobrapy for metabolism pathway query (synonym expansion)", () => {
		const results = search(index, "metabolism pathway analysis", 5);
		expect(results.some((r) => r.name === "cobrapy")).toBe(true);
	});

	it("finds pymatgen for crystal structure prediction", () => {
		const results = search(index, "crystal structure prediction", 5);
		expect(results.some((r) => r.name === "pymatgen")).toBe(true);
	});

	it("finds pytorch for deep learning", () => {
		const results = search(index, "deep learning neural network", 5);
		expect(results.some((r) => r.name === "pytorch")).toBe(true);
	});

	it("respects limit parameter", () => {
		const results = search(index, "molecular", 2);
		expect(results.length).toBeLessThanOrEqual(2);
	});

	it("returns empty for nonsensical query", () => {
		const results = search(index, "zzzznonexistent", 5);
		expect(results.length).toBe(0);
	});

	it("returns results sorted by score desc", () => {
		const results = search(index, "molecular drug", 10);
		for (let i = 1; i < results.length; i++) {
			expect(results[i - 1]?.score).toBeGreaterThanOrEqual(results[i]?.score ?? 0);
		}
	});

	it("breaks ties by name ascending", () => {
		const results = search(index, "molecular", 10);
		let lastScore = Number.POSITIVE_INFINITY;
		let sameScoreGroup: string[] = [];
		for (const r of results) {
			if (r.score === lastScore) {
				sameScoreGroup.push(r.name);
			} else {
				// Check previous group was sorted
				if (sameScoreGroup.length > 1) {
					const sorted = [...sameScoreGroup].sort();
					expect(sameScoreGroup).toEqual(sorted);
				}
				sameScoreGroup = [r.name];
				lastScore = r.score;
			}
		}
	});

	it("returns score > 0 for all results", () => {
		const results = search(index, "drug", 10);
		for (const r of results) {
			expect(r.score).toBeGreaterThan(0);
		}
	});
});

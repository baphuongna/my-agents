/**
 * Tests cho synonym dictionary — SPEC §5.2.
 *
 * Ported from pi-skill-search/test/synonyms.test.ts — imports adapted to ESM (.js).
 */
import { describe, expect, it } from "vitest";
import { SYNONYMS, expandQuery } from "./synonyms.js";

describe("expandQuery", () => {
	it("expands metabolism to include metabolic, pathway, flux", () => {
		const result = expandQuery("metabolism");
		expect(result).toContain("metabolic");
		expect(result).toContain("pathway");
		expect(result).toContain("flux");
	});

	it("expands molecule ↔ molecular (bidirectional)", () => {
		const fromMolecule = expandQuery("molecule");
		expect(fromMolecule).toContain("molecular");

		const fromMolecular = expandQuery("molecular");
		expect(fromMolecular).toContain("molecule");
	});

	it("returns empty set for empty query", () => {
		const result = expandQuery("");
		expect(result.size).toBe(0);
	});

	it("returns identity tokens when no synonym matches", () => {
		const result = expandQuery("crystallography");
		expect(result).toContain("crystallography");
		expect(result.size).toBe(1);
	});

	it("expands ml to machine learning", () => {
		const result = expandQuery("ml");
		expect(result).toContain("machine");
		expect(result).toContain("learning");
	});

	it("expands single-cell to scrna-seq variants", () => {
		const result = expandQuery("single-cell");
		expect(result).toContain("single");
		expect(result).toContain("cell");
	});
});

describe("SYNONYMS dictionary", () => {
	it("has no empty value arrays", () => {
		for (const [key, values] of Object.entries(SYNONYMS)) {
			expect(values.length, `SYNONYMS["${key}"] should not be empty`).toBeGreaterThan(0);
		}
	});

	it("contains required bidirectional pairs", () => {
		// molecule ↔ molecular
		expect(SYNONYMS.molecule).toContain("molecular");
		expect(SYNONYMS.molecular).toContain("molecule");
		// metabolism ↔ metabolic
		expect(SYNONYMS.metabolism).toContain("metabolic");
		expect(SYNONYMS.metabolic).toContain("metabolism");
	});
});

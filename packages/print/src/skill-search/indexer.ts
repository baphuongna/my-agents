import { CATEGORY_RULES, classify } from "./categories.ts";
import { tokenize } from "./text.ts";
/**
 * Index builder — buildIndex va fingerprintSkills.
 * Implement theo SPEC §6.4.
 */
import type { CategorySummary, PiSkill, SkillEntry, SkillIndex } from "./types.ts";

/**
 * Build search index tu danh sach Pi skills.
 * Two-pass algorithm per SPEC §6.4:
 *   Pass 1: classify + tokenize moi skill
 *   Pass 2: build CategorySummary[] theo CATEGORY_RULES declaration order
 *
 * Deterministic: cung input → cung output (last-write-wins nameIndex).
 */
export function buildIndex(skills: PiSkill[]): SkillIndex {
	const entries = new Map<string, SkillEntry>();

	// Pass 1: build entries
	for (const skill of skills) {
		const categories = classify(skill);
		const nameTokens = tokenize(skill.name);
		const descTokens = tokenize(skill.description);

		const entry: SkillEntry = {
			name: skill.name,
			description: skill.description,
			path: skill.filePath,
			categories,
			nameTokens,
			descTokens,
		};

		entries.set(skill.name, entry);
	}

	// Pass 2: build CategorySummary[] in CATEGORY_RULES declaration order
	const categoryMap = new Map<string, string[]>();

	// Khoi tao tat ca categories theo declaration order
	for (const rule of CATEGORY_RULES) {
		categoryMap.set(rule.name, []);
	}

	// Phan bo skills vao categories
	for (const entry of entries.values()) {
		for (const cat of entry.categories) {
			const list = categoryMap.get(cat);
			if (list) {
				list.push(entry.name);
			} else {
				// "Other" — khong co trong CATEGORY_RULES
				categoryMap.set(cat, [entry.name]);
			}
		}
	}

	// Build CategorySummary[] — chi bao gom categories co skills
	const categories: CategorySummary[] = [];

	for (const rule of CATEGORY_RULES) {
		const skills = categoryMap.get(rule.name);
		if (skills && skills.length > 0) {
			categories.push({
				name: rule.name,
				count: skills.length,
				examples: skills.slice(0, rule.maxExamples),
			});
		}
	}

	// Them "Other" cuoi cung neu co
	const otherSkills = categoryMap.get("Other");
	if (otherSkills && otherSkills.length > 0) {
		categories.push({
			name: "Other",
			count: otherSkills.length,
			examples: otherSkills.slice(0, 5),
		});
	}

	return { entries, categories };
}

/**
 * Tao fingerprint tu danh sach skills de detect thay doi.
 * Sorted filePath join — deterministic.
 */
export function fingerprintSkills(skills: PiSkill[]): string {
	return skills
		.map((s) => `${s.filePath}:${s.name}:${s.description.length}:${s.disableModelInvocation ? 1 : 0}`)
		.sort()
		.join("\n");
}

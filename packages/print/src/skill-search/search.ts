import { expandQuery } from "./synonyms.js";
import { tokenize } from "./text.js";
/**
 * Search algorithm — tinh diem va rank skills theo query.
 * Implement theo SPEC §5.1 scoring formula.
 */
import type { SearchResult, SkillIndex } from "./types.js";

/**
 * Tim kiem skills trong index theo query.
 *
 * Scoring per SPEC §5.1:
 *   +50  exact name match
 *   +20  per name-token match
 *   +3   per first-120-char description-token match
 *   +1   per remaining description-token match
 *   +5   per category-keyword match
 *
 * Synonym expansion truoc khi scoring (expandQuery).
 * Sort by score desc, ties broken by name asc.
 */
export function search(index: SkillIndex, query: string, limit: number): SearchResult[] {
	// Expand query voi synonyms
	const expandedTokens = expandQuery(query);
	const queryTokens = tokenize(query);

	if (queryTokens.size === 0 && expandedTokens.size === 0) {
		return [];
	}

	const results: SearchResult[] = [];

	for (const entry of index.entries.values()) {
		let score = 0;
		const nameLower = entry.name.toLowerCase();

		// Exact name match
		if (nameLower === query.toLowerCase().trim()) {
			score += 50;
		}

		// Score moi expanded token
		for (const token of expandedTokens) {
			// Name token match
			if (entry.nameTokens.has(token)) {
				score += 20;
			}

			// Description split at 120 chars
			const desc = entry.description;
			const first120 = desc.slice(0, 120).toLowerCase();
			const rest = desc.slice(120).toLowerCase();

			const first120Tokens = tokenize(first120);
			const restTokens = tokenize(rest);

			if (first120Tokens.has(token)) {
				score += 3; // SPEC §5.1
			}
			if (restTokens.has(token)) {
				score += 1; // SPEC §5.1
			}

			// Category keyword match
			for (const cat of entry.categories) {
				if (cat.toLowerCase().includes(token)) {
					score += 5;
				}
			}
		}

		if (score > 0) {
			results.push({
				name: entry.name,
				description: entry.description,
				path: entry.path,
				score,
			});
		}
	}

	// Sort: score desc, then name asc
	results.sort((a, b) => {
		if (b.score !== a.score) return b.score - a.score;
		return a.name.localeCompare(b.name);
	});

	return results.slice(0, limit);
}

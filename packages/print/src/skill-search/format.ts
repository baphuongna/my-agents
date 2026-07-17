/**
 * Output formatters — render category summary, tool description, search results.
 * Implement theo SPEC §4.4, §4.5, §6.3.
 */
import type { SearchResult, SkillIndex } from "./types.ts";

/**
 * Uong tinh token count (chars / 3.5).
 */
export function estimateTokens(text: string): number {
	return Math.ceil(text.length / 3.5);
}

/**
 * Render category summary cho system prompt.
 * SPEC §6.3 format voi token budget enforcement (≤250 tokens).
 */
export function formatCategorySummary(index: SkillIndex): string {
	// Render voi progressive truncation: maxExamples 5 → 4 → 3 → 2 → 1 → 0
	for (let maxEx = 5; maxEx >= 0; maxEx--) {
		const summary = renderSummary(index, maxEx);
		if (estimateTokens(summary) <= 250) {
			return summary;
		}
	}
	// Fallback: chi category names
	return renderCategoryNamesOnly(index);
}

/**
 * Render summary voi specific maxExamples.
 */
function renderSummary(index: SkillIndex, maxExamples: number): string {
	const lines: string[] = ["## Available Skill Domains", ""];

	for (const cat of index.categories) {
		const examples = cat.examples.slice(0, maxExamples);
		const exStr = examples.length > 0 ? ` (${examples.join(", ")})` : "";
		lines.push(`- **${cat.name}**: ${cat.count} skills${exStr}`);
	}

	lines.push("");
	lines.push("Use the `skill-search` tool to find specific skills by keyword.");

	return lines.join("\n");
}

/**
 * Render chi category names khi summary vuot token budget.
 */
function renderCategoryNamesOnly(index: SkillIndex): string {
	const names = index.categories.map((c) => c.name).join(", ");
	return `## Available Skill Domains\n\n${names}\n\nUse the \`skill-search\` tool to find specific skills.`;
}

/**
 * Render tool description voi live category list.
 * SPEC §4.4 template.
 */
export function renderToolDescription(index: SkillIndex): string {
	const categoryList = index.categories.map((c) => c.name.toLowerCase()).join(", ");

	// Top 3 categories by count (ties by declaration order)
	const sorted = [...index.categories].sort((a, b) => {
		if (b.count !== a.count) return b.count - a.count;
		return index.categories.indexOf(a) - index.categories.indexOf(b);
	});

	const top3 = sorted.slice(0, 3);
	const examples = top3
		.filter((c) => c.examples.length > 0)
		.map((c) => `"${c.examples[0]}"`)
		.join(", ");

	return [
		"Search for skills by keyword. Returns top matching skills with name, description, and path.",
		`Available domains: ${categoryList}.`,
		`Try queries like: ${examples}.`,
		"Use the `read` tool to load a skill's full SKILL.md after finding it.",
	].join(" ");
}

/**
 * Format search results cho tool output.
 * SPEC §4.3 format.
 */
export function formatResults(query: string, results: SearchResult[], totalIndexed: number): string {
	if (results.length === 0) {
		return `No skills found matching '${query}'. ${totalIndexed} skills indexed. Try broader terms.`;
	}

	const lines: string[] = [`Found ${results.length} skills for "${query}":`, ""];

	for (const r of results) {
		lines.push(`## ${r.name} (score: ${r.score.toFixed(2)})`);
		lines.push(r.description);
		lines.push(`Path: ${r.path}`);
		lines.push("");
	}

	lines.push("Use the `read` tool to load a skill's full instructions from the path above.");

	return lines.join("\n");
}

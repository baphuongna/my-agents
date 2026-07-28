/**
 * skill-search barrel — re-exports the pi-skill-search core mechanism.
 *
 * pi-skill-search is SELF-CONTAINED: it scans its OWN corpus (~/.mya/agent/data/)
 * for skills, NOT pi's discovery. It strips pi's <available_skills> block (token
 * save) + injects a compact category summary (of the corpus) + registers an
 * on-demand `skill-search` tool. The agent uses the tool to find skills by keyword.
 *
 * Source: ~/source/my_pi/pi-skill-search (ported, import-adapted @earendil-works → @my-agent).
 */
export { stripAvailableSkillsBlock, detectSkillsBlock, AVAILABLE_SKILLS_BLOCK_REGEX } from "./strip.js";
export { buildIndex, fingerprintSkills } from "./indexer.js";
export { search } from "./search.js";
export { formatCategorySummary, renderToolDescription, formatResults, estimateTokens } from "./format.js";
export { scanSkillDirectory, parseFrontmatter } from "./scanner.js";
export type { PiSkill, SkillEntry, SearchResult, CategorySummary, SkillIndex } from "./types.js";

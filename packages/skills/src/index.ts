/**
 * @my-agent/skills — curator + provenance + progressive disclosure (§9).
 *
 * parseSkillMarkdown (SKILL.md frontmatter + body) · SkillStore (discover +
 * index + loadBody) · progressive disclosure (name+desc in prompt, body on invoke).
 */
export { parseSkillMarkdown } from "./skill.js";
export type { Skill, SkillProvenance, SkillProvenanceKind, SkillFrontmatter } from "./skill.js";
export { SkillStore, curate } from "./curator.js";
export type { SkillIndexEntry, SkillCuratorOptions, CurationAction } from "./curator.js";

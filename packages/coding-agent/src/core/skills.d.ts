import type { ResourceDiagnostic } from "./diagnostics.ts";
import { type SourceInfo } from "./source-info.ts";
export interface SkillFrontmatter {
    name?: string;
    description?: string;
    "disable-model-invocation"?: boolean;
    [key: string]: unknown;
}
export interface Skill {
    name: string;
    description: string;
    filePath: string;
    baseDir: string;
    sourceInfo: SourceInfo;
    disableModelInvocation: boolean;
}
export interface LoadSkillsResult {
    skills: Skill[];
    diagnostics: ResourceDiagnostic[];
}
export interface LoadSkillsFromDirOptions {
    /** Directory to scan for skills */
    dir: string;
    /** Source identifier for these skills */
    source: string;
}
/**
 * Load skills from a directory.
 *
 * Discovery rules:
 * - if a directory contains SKILL.md, treat it as a skill root and do not recurse further
 * - otherwise, load direct .md children in the root
 * - recurse into subdirectories to find SKILL.md
 */
export declare function loadSkillsFromDir(options: LoadSkillsFromDirOptions): LoadSkillsResult;
/**
 * Format skills for inclusion in a system prompt.
 *
 * Uses a slimmed variant of the Agent Skills XML format
 * (https://agentskills.io/integrate-skills):
 *   - <location> is elided — the model resolves paths on first use
 *     (convention: ~/.agents/skills/<name>/SKILL.md, or project-local skills dir)
 *   - <description> is compacted to ≤80 chars (first sentence + ellipsis)
 *
 * Rationale: this block ships every turn; on a session with 40+ skills the
 * full name+description+location trio costs ~5 KB of prefill. The model only
 * needs enough to decide whether to read SKILL.md — the rest is wasted.
 *
 * Skills with disableModelInvocation=true are excluded from the prompt
 * (they can only be invoked explicitly via /skill:name commands).
 */
export declare function formatSkillsForPrompt(skills: Skill[]): string;
export interface LoadSkillsOptions {
    /** Working directory for project-local skills. */
    cwd: string;
    /** Agent config directory for global skills. */
    agentDir: string;
    /** Explicit skill paths (files or directories) */
    skillPaths: string[];
    /** Include default skills directories. */
    includeDefaults: boolean;
}
/**
 * Load skills from all configured locations.
 * Returns skills and any validation diagnostics.
 */
export declare function loadSkills(options: LoadSkillsOptions): LoadSkillsResult;
//# sourceMappingURL=skills.d.ts.map
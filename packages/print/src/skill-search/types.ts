/**
 * Domain types cho pi-skill-search extension.
 * PiSkill la subset cua Pi's Skill interface (skills.ts:75).
 * Extension khong import Skill tu package vi no khong duoc export.
 */

/**
 * Subset cua Pi's Skill interface (skills.ts:75) ma extension can.
 * Khong export tu @my-agent/coding-agent — phai khai bao local.
 */
export interface PiSkill {
	name: string;
	description: string;
	filePath: string;
	disableModelInvocation: boolean;
}

/** Internal representation cua mot skill da duoc index */
export interface SkillEntry {
	name: string;
	description: string;
	path: string;
	categories: string[];
	nameTokens: Set<string>;
	descTokens: Set<string>;
}

/** Ket qua tim kiem cho mot skill */
export interface SearchResult {
	name: string;
	description: string;
	path: string;
	score: number;
}

/** Tom tat mot category voi so luong va vi du */
export interface CategorySummary {
	name: string;
	count: number;
	examples: string[];
}

/** Index chinh cua toan bo skills */
export interface SkillIndex {
	entries: Map<string, SkillEntry>;
	categories: CategorySummary[];
}

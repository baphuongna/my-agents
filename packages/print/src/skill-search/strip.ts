/**
 * Strip regex — loai bo Pi's auto-injected <available_skills> block.
 * Implement theo SPEC §7.3.
 */

/**
 * Regex de match <available_skills> block tu Pi's formatSkillsForPrompt().
 * Anchor vao lead-in sentence: "The following skills provide specialized instructions"
 * Ket thuc bang </available_skills> tag.
 */
export const AVAILABLE_SKILLS_BLOCK_REGEX =
	/\n*The following skills provide specialized instructions[\s\S]*?<\/available_skills>/;

/**
 * Strip <available_skills> block tu system prompt.
 * Neu khong tim thay → no-op, tra ve original string.
 */
export function stripAvailableSkillsBlock(systemPrompt: string): string {
	return systemPrompt.replace(AVAILABLE_SKILLS_BLOCK_REGEX, "");
}

/**
 * Drift detector — kiem tra xem regex co match trong systemPrompt khong.
 * Tra ve true neu block duoc tim thay va stripped.
 * Tra ve false neu khong tim thay (Pi co the da thay doi format).
 */
export function detectSkillsBlock(systemPrompt: string): boolean {
	return AVAILABLE_SKILLS_BLOCK_REGEX.test(systemPrompt);
}

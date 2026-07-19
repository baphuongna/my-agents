/** Phase 0A: cron-fired-turn tool policy. The cron role's denied tools are
 * applied (via createAgentSession `excludeTools`) to `_cron:<jobId>` sessions.
 *
 * Empty by default; Phase 3C (approval_mode: deny) populates the re-entry
 * vectors — `bash` (→ `mya cron add` CLI), `write`/`edit` (→ edit cron.json
 * directly, which the file-as-store now loads). mya has no agent-callable
 * scheduling tool, so the recursion surface is shell + file-edit, gated by 3C. */
export const CRON_ROLE_DENIED_TOOLS: string[] = [];

/** Returns the excludeTools list for a session id, or undefined if it isn't a
 * cron-fired session. (Testable seam used by the pool factory in main.ts.) */
export function cronSessionExcludeTools(sessionId: string): string[] | undefined {
  return sessionId.startsWith("_cron:") ? CRON_ROLE_DENIED_TOOLS : undefined;
}

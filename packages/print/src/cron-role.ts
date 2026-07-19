/** Phase 0A/3C: cron-fired-turn tool policy.
 *
 * In DENY mode (default), an ALLOWLIST restricts a cron-fired turn to read-only
 * tools — a cron job cannot mutate the system (no bash/write/edit), recurse
 * (no `mya cron add` via shell, no cron.json edit), or load unvetted extension
 * tools. An allowlist is used (not a denylist) so any extension/MCP tool not
 * explicitly listed is excluded by construction.
 *
 * In APPROVE mode (MYA_CRON_APPROVAL_MODE=approve), no restriction — the turn
 * runs with full credentials. UNATTENDED FULL-CREDENTIAL execution; the operator
 * trusts the prompt. No base_url/snapshot guard yet (Phase 5).
 *
 * Residual (deny-mode): `read` can read secrets (~/.ssh/id_rsa, auth.json) into
 * the LLM context — same provider trust boundary as interactive mode, and
 * deny-mode has no outbound network channel (no bash/web), so a secret can't be
 * exfiltrated to an attacker URL, only disclosed to the configured provider. */

/** Read-only allowlist used in deny-mode (default). Search/read only. */
export const CRON_DENY_MODE_TOOLS = ["read", "glob", "grep", "ls", "find"];

/** The cron role's allowed tools (deny-mode allowlist). Mutated to reconfigure. */
export const CRON_ROLE_ALLOWED_TOOLS: string[] = [...CRON_DENY_MODE_TOOLS];

let cronApprovalMode: "deny" | "approve" = "deny";
/** Configure the cron toolset mode (main.ts calls this from MYA_CRON_APPROVAL_MODE). */
export function setCronApprovalMode(m: "deny" | "approve"): void {
  cronApprovalMode = m;
}
export function getCronApprovalMode(): "deny" | "approve" {
  return cronApprovalMode;
}

/** Returns the createAgentSession tool config for a session id, or {} if it
 * isn't a cron-fired session (or approve-mode). Testable seam for the factory. */
export function cronSessionToolConfig(
  sessionId: string,
): { tools?: string[]; excludeTools?: string[] } {
  if (!sessionId.startsWith("_cron:")) return {};
  return cronApprovalMode === "deny" ? { tools: CRON_ROLE_ALLOWED_TOOLS } : {};
}

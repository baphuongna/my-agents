/**
 * Phase 3B/3D: cron prompt validation. Scans a cron job's prompt for
 * prompt-injection / exfiltration / destructive / gateway-lifecycle threats
 * before it is allowed to schedule (and run unattended). Best-effort DETECTION,
 * not a security boundary — the boundary is auth (0C) + the cron-role toolset
 * (0A/3C). Defense-in-depth: a prompt-injected cron prompt is caught here too.
 *
 * Patterns ported from hermes `_scan_cron_prompt` (Tier-1) + a gateway-lifecycle
 * guard (3D). ReDoS-hardened: each pattern is linear (no nested quantifiers).
 *
 * NOTE: mya has no agent-callable scheduling tool, so the recursion surface is
 * shell + file-edit — gated by the 3C deny-mode toolset. This scan catches the
 * prompt-text signatures; it's bypassable by encoding/obfuscation (documented).
 */

/** Secret-variable token (e.g. $API_KEY, ${TOKEN}, $PASSWORD). */
const SECRET_VAR = /\$\{?\w*(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)\w*\}?/i;

interface ThreatPattern {
  /** case-insensitive regex */
  re: RegExp;
  id: string;
}

const THREAT_PATTERNS: ThreatPattern[] = [
  { id: "prompt_injection", re: /ignore\s+(?:\w+\s+){0,4}(?:previous|all|above|prior)\s+(?:\w+\s+){0,2}instructions/i },
  { id: "deception_hide", re: /do\s+not\s+tell\s+the\s+user/i },
  { id: "sys_prompt_override", re: /system\s+prompt\s+override/i },
  { id: "disregard_rules", re: /disregard\s+(?:your|all|any)\s+(?:instructions|rules|guidelines)/i },
  { id: "read_secrets", re: /cat\s+[^\n]*(?:\.env|credentials|\.netrc|\.pgpass|id_rsa|id_ed25519)/i },
  { id: "ssh_backdoor", re: /authorized_keys/i },
  { id: "sudoers_mod", re: /(?:\/etc\/sudoers|visudo)/i },
  { id: "destructive_root_rm", re: /rm\s+-rf\s+\/(?!(?:tmp|private|var\/tmp)(?:\/|$|\s))/i },
  // exfil: curl/wget posting/URLing a secret, or an Authorization header
  { id: "exfil_curl_url", re: new RegExp(`curl\\s+[^\\n]*https?://[^\\s\"'` + "`" + `]*${SECRET_VAR.source}`, "i") },
  { id: "exfil_wget_url", re: new RegExp(`wget\\s+[^\\n]*https?://[^\\s\"'` + "`" + `]*${SECRET_VAR.source}`, "i") },
  { id: "exfil_curl_data", re: new RegExp(`curl\\s+[^\\n]*(?:--data(?:-raw|-binary|-urlencode)?|-d|--form|-F)\\s+[^\\n]*${SECRET_VAR.source}`, "i") },
  { id: "exfil_auth_header", re: /curl\s+[^\n]*(?:-H|--header)\s+["']Authorization:\s*Bearer\s+/i },
  // 3D gateway-lifecycle: a cron job restarting/stopping/killing the gateway
  // loops under launchd/systemd supervision (#30719).
  { id: "gateway_lifecycle", re: /(?:mya\s+(?:gateway\s+)?(?:restart|stop)|systemctl\s+(?:-\S+\s+)*(?:restart|stop)\s+[^\n]*mya|p?kill\s+[^\n]*mya[^\n]*(?:gateway|serve)?|p?kill\s+[^\n]*(?:gateway|serve)\b[^\n]*mya)/i },
];

/** Invisible / bidi Unicode that can hide injection from human review. Hard-block
 * (reject) for cron prompts. Covers zero-width, bidi controls, BOM, Tags block,
 * Hangul fillers, word-joiner. (Mirrors the web/fetch INVISIBLE_UNICODE_RE — kept
 * duplicated here to preserve the cron package's zero-dep minimal-core.) */
const INVISIBLE_UNICODE_RE = /[\u0000-\u0008\u000E-\u001F\u007F\u0080-\u009F\u061C\u200B-\u200F\u2028-\u202E\u2060-\u2064\u2066-\u2069\u115F\u1160\u180E\u3164\uFFA0\uFEFF\u{E0000}-\u{E007F}]/u;

/**
 * Validate a cron prompt. Returns a rejection reason (string) if it matches a
 * threat pattern or contains invisible Unicode; null if it passes.
 *
 * @param prompt the user-supplied cron prompt
 */
export function validateCronPrompt(prompt: string | undefined | null): string | null {
  if (!prompt) return null; // empty prompt is allowed (some jobs are script-only)
  if (INVISIBLE_UNICODE_RE.test(prompt)) {
    return "prompt contains invisible/bidi Unicode (possible concealed injection)";
  }
  for (const { re, id } of THREAT_PATTERNS) {
    if (re.test(prompt)) return `prompt matches threat pattern '${id}'`;
  }
  return null;
}

/** Re-export the threat ids for tests/diagnostics. */
export const THREAT_IDS = THREAT_PATTERNS.map((p) => p.id);

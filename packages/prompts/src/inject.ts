/**
 * Injection scanner — defense-in-depth (NOT a security boundary).
 *
 * The real control is privilege separation (§7 permission gate). This scanner
 * marks context files whose content matches known prompt-injection patterns
 * so they can be fenced/redacted before prompt assembly (§5).
 *
 * Source: hermes prompt_injection + openhuman. R27-15/T7.
 */
import type { ScanVerdict } from "@my-agent/core";

/** Patterns that indicate a likely prompt-injection attempt in untrusted context. */
const INJECTION_PATTERNS: readonly RegExp[] = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions/i,
  /you\s+are\s+now\s+(a|an)\s/i,
  /system\s*:\s*/i,
  /<\|?(system|im_start|im_end|endoftext)\|?>/i,
  /\b(disregard|forget)\s+(all\s+)?(previous|prior)\b/i,
  /new\s+instructions?\s*:/i,
  /\[INST\]/i,
];

/**
 * Scan a single file's content. Returns `{allowed:true}` if clean, else names
 * the matched pattern. Scope tunes which patterns apply (wire=strictest).
 */
export function scan(
  content: string,
  scope: "context" | "wire" | "direct" = "context",
): ScanVerdict {
  for (const re of INJECTION_PATTERNS) {
    const m = re.exec(content);
    if (m) {
      return {
        allowed: false,
        reason: `injection pattern matched (${scope} scope)`,
        matchedPattern: m[0],
      };
    }
  }
  return { allowed: true };
}

/**
 * scanInject — scan a batch of files; returns a sanitized concatenation.
 * Blocked files are replaced with a `[BLOCKED: <reason>]` fence so the model
 * sees a stable-length context (no silent drop). (§5 R27-15.)
 */
export function scanInject(
  files: string[],
  scope?: "context" | "wire" | "direct",
): string {
  const out: string[] = [];
  for (const f of files) {
    const verdict = scan(f, scope);
    if (verdict.allowed) {
      out.push(f);
    } else {
      out.push(
        `[BLOCKED: ${verdict.reason}${verdict.matchedPattern ? ` (${verdict.matchedPattern})` : ""}]`,
      );
    }
  }
  return out.join("\n\n---\n\n");
}

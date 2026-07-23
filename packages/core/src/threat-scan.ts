/**
 * Prompt injection / threat scanner — detects adversarial patterns in text
 * that crosses trust boundaries (context files, memory writes, tool results,
 * skill installs).
 *
 * Ported from Hermes Agent `tools/threat_patterns.py` (deep-dive-r3.md §2).
 *
 * - 3-tier scope hierarchy: `"all"` ⊂ `"context"` ⊂ `"strict"`
 * - Unicode defense: strip 17 invisible chars + NFKC normalization
 * - MAX_SCAN_CHARS cap (65536)
 */

// ── Types ──────────────────────────────────────────────────────────────────

export type ThreatScope = "all" | "context" | "strict";

export interface ThreatMatch {
  pattern: string;
  scope: ThreatScope;
  snippet: string;
}

export interface ThreatResult {
  safe: boolean;
  matches: ThreatMatch[];
}

// ── Constants ──────────────────────────────────────────────────────────────

const MAX_SCAN_CHARS = 65_536;

// Invisible Unicode characters that can hide injection patterns.
const _INVISIBLE_RE =
  /[\u200b-\u200d\u2060\u2062-\u2064\ufeff\u202a-\u202e\u2066-\u2069]/g;

// ── Preprocessing ──────────────────────────────────────────────────────────

function stripInvisible(text: string): string {
  return text.replace(_INVISIBLE_RE, "");
}

function preprocess(text: string): string {
  // Cap
  const capped = text.length > MAX_SCAN_CHARS ? text.slice(0, MAX_SCAN_CHARS) : text;
  // Strip invisible chars
  const cleaned = stripInvisible(capped);
  // NFKC normalization (folds full-width ｃａｔ → cat)
  return cleaned.normalize("NFKC");
}

// ── Pattern definitions ────────────────────────────────────────────────────
// Bounded filler to prevent unbounded backtracking.
const F = `(?:\\w+\\s+){0,8}`;

// Compile patterns per scope.
type CompiledPattern = { pattern: RegExp; description: string; scope: ThreatScope };

const _PATTERNS: CompiledPattern[] = [
  // ── "all" scope: classic injection + exfil ──────────────────────────────
  {
    description: "ignore previous instructions",
    scope: "all",
    pattern: new RegExp(`ignore\\s+(?:previous|all|above|prior)\\s+.{0,20}instructions`, "i"),
  },
  {
    description: "system prompt override",
    scope: "all",
    pattern: /system\s+prompt\s+override/i,
  },
  {
    description: "disregard instructions",
    scope: "all",
    pattern: new RegExp(
      `disregard\\s+(?:your|all|any)\\s+${F}?(?:instructions|rules|guidelines)`,
      "i",
    ),
  },
  {
    description: "act without restrictions",
    scope: "all",
    pattern: new RegExp(
      `act\\s+as\\s+(?:if|though).{0,30}(?:no|don't have|without)\\s+(?:restrictions|limits|rules)`,
      "i",
    ),
  },
  {
    description: "HTML comment injection",
    scope: "all",
    pattern: /<!--[^>]*(?:ignore|override|system|secret|hidden)[^>]*-->/i,
  },
  {
    description: "hidden div",
    scope: "all",
    pattern: /<div\s+style="[^"]*display:\s*none/i,
  },
  {
    description: "do not tell user",
    scope: "all",
    pattern: /do\s+not\s+(?:tell|inform)\s+(?:the\s+)?user/i,
  },
  {
    description: "curl exfiltration",
    scope: "all",
    pattern: /curl\s+.*\$\((?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)/i,
  },
  {
    description: "wget exfiltration",
    scope: "all",
    pattern: /wget\s+.*\$\(/i,
  },
  {
    description: "credential file access",
    scope: "all",
    pattern: /cat\s+.*\.(?:env|netrc|pgpass|npmrc|pypirc)/i,
  },

  // ── "context" scope: role-hijack + C2 + promptware ──────────────────────
  {
    description: "role assignment",
    scope: "context",
    pattern: /you\s+are\s+(?:now|henceforth)\s+(?:a|an|the)\s/i,
  },
  {
    description: "pretend identity",
    scope: "context",
    pattern: /pretend\s+(?:you\s+are|to\s+be)\s/i,
  },
  {
    description: "output system prompt",
    scope: "context",
    pattern: /(?:output|reveal|show|print)\s+(?:your|the)\s+(?:system|initial)\s+prompt/i,
  },
  {
    description: "respond without restrictions",
    scope: "context",
    pattern: /respond\s+without\s+(?:restrictions|limitations|filters|safety)/i,
  },
  {
    description: "identity upgrade claim",
    scope: "context",
    pattern: /you\s+have\s+been\s+(?:updated|upgraded|patched)\s+to/i,
  },
  {
    description: "brainworm name override",
    scope: "context",
    pattern: /name\s+yourself\s+\w+/i,
  },
  {
    description: "C2 node registration",
    scope: "context",
    pattern: /register\s+(?:as\s+)?a?\s*node/i,
  },
  {
    description: "C2 beacon",
    scope: "context",
    pattern: /(?:heartbeat|beacon|check-in)\s+(?:to|with)/i,
  },
  {
    description: "C2 pull task",
    scope: "context",
    pattern: /pull\s+.*(?:task|instruction)/i,
  },
  {
    description: "unset agent env",
    scope: "context",
    pattern: /unset\s+.*(?:CLAUDE|CODEX|MYA|AGENT|OPENAI|ANTHROPIC)/i,
  },
  {
    description: "C2 framework reference",
    scope: "context",
    pattern: /\b(?:cobalt\s+strike|sliver|havoc|mythic|metasploit|brainworm)\b/i,
  },
  {
    description: "C2 infrastructure",
    scope: "context",
    pattern: /c2\s+(?:server|channel|infrastructure|beacon)/i,
  },
  {
    description: "command and control",
    scope: "context",
    pattern: /command\s+and\s+control/i,
  },
  {
    description: "anti-forensic one-liner",
    scope: "context",
    pattern: /only\s+use\s+one-liners/i,
  },
  {
    description: "anti-forensic no script",
    scope: "context",
    pattern: new RegExp(
      `never\\s+(?:create|write)${F}?(?:script|file)${F}?(?:disk|drive)`,
      "i",
    ),
  },

  // ── "strict" scope: persistence + backdoor + hardcoded secrets ──────────
  {
    description: "SSH authorized_keys",
    scope: "strict",
    pattern: /authorized_keys/i,
  },
  {
    description: "SSH directory access",
    scope: "strict",
    pattern: /\$HOME\/\.ssh/i,
  },
  {
    description: "agent config modification",
    scope: "strict",
    pattern: /(?:update|modify|edit|write|append).*(?:AGENTS\.md|CLAUDE\.md|\.cursorrules|\.clinerules)/i,
  },
  {
    description: "mya config modification",
    scope: "strict",
    pattern: /(?:update|modify).*(?:config\.yaml|SOUL\.md|\.mya\/)/i,
  },
  {
    description: "hardcoded secret",
    scope: "strict",
    pattern: /(?:api_key|token|secret|password)\s*[=:]\s*["'][A-Za-z0-9+/=_-]{20,}["']/i,
  },
];

// ── Scope hierarchy ────────────────────────────────────────────────────────

const _SCOPE_RANK: Record<ThreatScope, number> = { all: 0, context: 1, strict: 2 };

function patternApplies(patternScope: ThreatScope, queryScope: ThreatScope): boolean {
  return _SCOPE_RANK[patternScope] <= _SCOPE_RANK[queryScope];
}

// ── Main entry ─────────────────────────────────────────────────────────────

/**
 * Scan text for threat patterns.
 *
 * @param text - Input text to scan.
 * @param scope - Detection breadth: `"all"` (narrow), `"context"` (default), `"strict"` (broad).
 * @returns `{ safe, matches }` — `safe` is true when no patterns matched.
 */
export function scanForThreats(text: string, scope: ThreatScope = "context"): ThreatResult {
  const processed = preprocess(text);
  const matches: ThreatMatch[] = [];

  for (const { pattern, description, scope: pScope } of _PATTERNS) {
    if (!patternApplies(pScope, scope)) continue;
    const m = pattern.exec(processed);
    if (m) {
      const start = Math.max(0, m.index - 10);
      const end = Math.min(processed.length, m.index + m[0].length + 10);
      matches.push({
        pattern: description,
        scope: pScope,
        snippet: processed.slice(start, end).trim(),
      });
    }
  }

  return { safe: matches.length === 0, matches };
}

/**
 * Return the first threat message, or null if safe.
 * Useful for blocking operations (e.g., memory writes, skill installs).
 */
export function firstThreatMessage(text: string, scope: ThreatScope = "strict"): string | null {
  const result = scanForThreats(text, scope);
  if (result.safe) return null;
  return `[BLOCKED: ${result.matches[0]?.pattern ?? "threat detected"}]`;
}

/**
 * Tool-call repair (§6). Models sometimes emit malformed tool calls (bad JSON,
 * wrong arg shape). repair() attempts a deterministic fix; if unrepairable,
 * returns a typed failure that the loop feeds back as a synthetic error result.
 *
 * Tier 1: handles the common cases — args as a JSON string → parse, args as a
 * partial → keep as-is, empty name → unrepairable.
 *
 * A3 (openclaw tool-call-repair concept, scoped to the structured-call args
 * case): parseJsonLenient applies deterministic JSON-recovery heuristics before
 * giving up — strips trailing commas and balances unclosed { / [ / " delimiters.
 * These are the most common model-emitted arg malformations. (The full openclaw
 * text→call extraction pipeline, for non-function-calling providers, is a
 * separate larger effort — pi-ai already handles raw token streams.)
 *
 * Source: §6 tool-call repair, openclaw tool-call-repair, R27-1/GAP-9.
 */
import type { ToolCall } from "@my-agent/core";

export type RepairResult =
  | { ok: ToolCall }
  | { unrepairable: true; reason: string };

/**
 * Repair a tool call. Tier 1 + A3 lenient JSON recovery on string args.
 */
export function repair(call: ToolCall): RepairResult {
  if (!call.name || typeof call.name !== "string") {
    return { unrepairable: true, reason: "missing tool name" };
  }
  let args = call.args;
  // Model emitted args as a JSON string instead of an object.
  if (typeof args === "string") {
    const trimmed = args.trim();
    if (trimmed === "") {
      args = {};
    } else {
      const parsed = parseJsonLenient(trimmed);
      if (parsed === undefined) {
        return { unrepairable: true, reason: `args not valid JSON (even after repair): ${trimmed.slice(0, 60)}` };
      }
      args = parsed;
    }
  }
  if (args === null || args === undefined) args = {};
  return { ok: { ...call, args } };
}

/** Parse JSON, applying deterministic recovery heuristics on failure.
 * Tries the original, then trailing-comma-stripped, then delimiter-balanced,
 * then both. Returns undefined only if all attempts fail. */
export function parseJsonLenient(text: string): unknown | undefined {
  const attempts = new Set<string>([text]);
  // Trailing commas before } or ] (e.g. {"a":1,} → {"a":1}).
  const noTrail = text.replace(/,(\s*[}\]])/g, "$1");
  attempts.add(noTrail);
  // Balance unclosed { / [ / " (e.g. {"a":1 → {"a":1}, [1,2 → [1,2]).
  const balanced = balanceDelimiters(text);
  attempts.add(balanced);
  // Both (e.g. {"a":1, → balance → {"a":1,} → strip → {"a":1}).
  attempts.add(stripTrailingCommas(balanced));
  for (const candidate of attempts) {
    try {
      return JSON.parse(candidate);
    } catch {
      /* try next */
    }
  }
  return undefined;
}

/** Remove trailing commas before closing delimiters. */
function stripTrailingCommas(text: string): string {
  return text.replace(/,(\s*[}\]])/g, "$1");
}

/** Append closing delimiters for unclosed { / [ / ", tracking string state.
 * Leaves already-balanced input unchanged. */
function balanceDelimiters(text: string): string {
  const stack: string[] = [];
  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{" || ch === "[") stack.push(ch === "{" ? "}" : "]");
    else if ((ch === "}" || ch === "]") && stack[stack.length - 1] === ch) stack.pop();
  }
  let suffix = "";
  if (inString) suffix += '"';
  while (stack.length > 0) suffix += stack.pop();
  return text + suffix;
}

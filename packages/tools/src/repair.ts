/**
 * Tool-call repair (§6). Models sometimes emit malformed tool calls (bad JSON,
 * wrong arg shape). repair() attempts a deterministic fix; if unrepairable,
 * returns a typed failure that the loop feeds back as a synthetic error result.
 *
 * Source: §6 tool-call repair, openclaw #7, R27-1/GAP-9.
 */
import type { ToolCall } from "@my-agent/core";

export type RepairResult =
  | { ok: ToolCall }
  | { unrepairable: true; reason: string };

/**
 * Repair a tool call. Tier 1: handles the common cases —
 *   - args as a string that's actually JSON → parse
 *   - args as a partial → keep as-is (let schema validation flag it)
 *   - empty name → unrepairable
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
      try {
        args = JSON.parse(trimmed);
      } catch {
        return { unrepairable: true, reason: `args not valid JSON: ${trimmed.slice(0, 60)}` };
      }
    }
  }
  if (args === null || args === undefined) args = {};
  return { ok: { ...call, args } };
}

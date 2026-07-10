/**
 * Tool dispatch (§7) — runTool + aggregate.
 *
 * runTool: awaits the human prompt (if needed), then executes the tool impl.
 * aggregate: returns ToolResult[] when all ok, else DegradedResult naming the
 * failed call ids (R27-1/D6 — failures are never silently swallowed).
 *
 * Source: §7, R27-1/D6, invariant #18 (Degraded never swallowed).
 */
import type {
  DegradedResult,
  ToolCall,
  ToolResult,
  TurnContext,
} from "@my-agent/core";
import type { ToolRegistry } from "./registry.js";
import { awaitHumanPrompt, requiresApproval } from "./permission.js";

/**
 * runTool — the full path: sync permission check → human round-trip → execute.
 * Returns a ToolResult. Unknown/blocked tools → ok:false (typed, not thrown).
 */
export async function runTool(
  call: ToolCall,
  ctx: TurnContext,
  registry: ToolRegistry,
): Promise<ToolResult> {
  const decision = requiresApproval(call, ctx, registry);
  const resolved = await awaitHumanPrompt(call, ctx, decision);
  if (resolved.decision === "Deny") {
    return { callId: call.id, ok: false, output: null, error: `denied: ${resolved.reason}` };
  }

  const impl = registry.get(call.name);
  if (!impl) {
    return { callId: call.id, ok: false, output: null, error: `unknown tool: ${call.name}` };
  }
  try {
    return await impl.run(call.args, ctx);
  } catch (e) {
    return {
      callId: call.id,
      ok: false,
      output: null,
      error: e instanceof Error ? e.message : String(e),
      degraded: true,
    };
  }
}

/**
 * Execute a batch of tool calls; returns ToolResult[] or DegradedResult.
 * DegradedResult names failedCallIds so the loop never swallows a failure
 * (invariant #18).
 */
export async function runToolBatch(
  calls: ToolCall[],
  ctx: TurnContext,
  registry: ToolRegistry,
): Promise<ToolResult[] | DegradedResult> {
  // Independent calls run in parallel (§4 tool-dispatch; pi model).
  const results = await Promise.all(
    calls.map((c) => runTool(c, ctx, registry)),
  );
  return aggregate(results);
}

/** aggregate — all ok ⇒ ToolResult[]; else DegradedResult{results, failedCallIds}. */
export function aggregate(
  results: ToolResult[],
): ToolResult[] | DegradedResult {
  const failed = results.filter((r) => !r.ok);
  if (failed.length === 0) return results;
  return {
    results,
    failedCallIds: failed.map((r) => r.callId),
  };
}

export type { ToolResult };

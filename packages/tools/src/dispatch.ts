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
import { repair } from "./repair.js";
import { nowWallclock } from "@my-agent/core";

/**
 * runTool — the full path: sync permission check → human round-trip → execute.
 * Returns a ToolResult. Unknown/blocked tools → ok:false (typed, not thrown).
 */
export async function runTool(
  call: ToolCall,
  ctx: TurnContext,
  registry: ToolRegistry,
  override?: import("@my-agent/core").HookOverride,
  effectiveArgs: unknown = call.args,
): Promise<ToolResult> {
  const decision = requiresApproval(call, ctx, registry, override);
  const resolved = await awaitHumanPrompt(call, ctx, decision, registry);
  if (resolved.decision === "Deny") {
    // F3-perm: audit the denial too (repudiation defense).
    ctx.audit?.append({ ts: nowWallclock(), kind: "approval", actor: "permission-gate", payload: { call: call.name, decision: "Deny", reason: resolved.reason } });
    return { callId: call.id, ok: false, output: null, error: `denied: ${resolved.reason}` };
  }

  const impl = registry.get(call.name);
  if (!impl) {
    return { callId: call.id, ok: false, output: null, error: `unknown tool: ${call.name}` };
  }
  let result: ToolResult;
  try {
    result = await impl.run(effectiveArgs, ctx);
    ctx.audit?.append({ ts: nowWallclock(), kind: "tool", actor: "agent", payload: { name: call.name, args: effectiveArgs, ok: result.ok } });
  } catch (e) {
    ctx.audit?.append({ ts: nowWallclock(), kind: "tool", actor: "agent", payload: { name: call.name, args: effectiveArgs, ok: false, error: String(e) } });
    result = {
      callId: call.id,
      ok: false,
      output: null,
      error: e instanceof Error ? e.message : String(e),
      degraded: true,
    };
  }
  // §7 post-hook (input-mutation + observability triad). Errors are isolated.
  try { ctx.hooks?.postTool?.(call, result); } catch { /* a post-hook never fails the tool */ }
  return result;
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
  // §6 GAP-9: repair each call first (models emit malformed JSON args). An
  // unrepairable call becomes a synthetic error result fed back to the model.
  const repaired: ToolResult[] = [];
  const executable: ToolCall[] = [];
  for (const c of calls) {
    const r = repair(c);
    if ("ok" in r) executable.push(r.ok);
    else repaired.push({ callId: c.id, ok: false, output: null, error: `malformed tool_call: ${r.reason}` });
  }

  // §7 CC7/R28: pre-hooks are AWAITED before the ask-rule match (step 4) reads
  // them. Collect each call's {override, args} (input-mutation + override triad).
  const pre = await Promise.all(executable.map(async (c) => {
    if (!ctx.hooks?.preTool) return { override: undefined, args: c.args };
    try {
      const h = await ctx.hooks.preTool(c);
      return { override: h?.override, args: h?.args ?? c.args };
    } catch {
      return { override: undefined, args: c.args };
    }
  }));

  // §7 R26-D: concurrent-approval serialization. Tools needing a human prompt
  // (ask-rule / hook-Ask / DangerFullAccess) run SEQUENTIALLY (one prompt at a
  // time); the rest run in parallel. A Deny never cancels siblings.
  const promptCalls: { call: ToolCall; idx: number }[] = [];
  const parallelCalls: { call: ToolCall; idx: number }[] = [];
  executable.forEach((c, i) => {
    const decision = requiresApproval(c, ctx, registry, pre[i]!.override);
    (decision.needsHumanPrompt ? promptCalls : parallelCalls).push({ call: c, idx: i });
  });

  // Order preservation: results indexed by original position.
  const out: ToolResult[] = new Array(executable.length);
  // parallel batch (no approval)
  await Promise.all(parallelCalls.map(async ({ call, idx }) => {
    out[idx] = await runTool(call, ctx, registry, pre[idx]!.override, pre[idx]!.args);
  }));
  // sequential batch (approval — one prompt at a time)
  for (const { call, idx } of promptCalls) {
    out[idx] = await runTool(call, ctx, registry, pre[idx]!.override, pre[idx]!.args);
  }

  return aggregate([...repaired, ...out.filter((r) => r !== undefined)]);
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

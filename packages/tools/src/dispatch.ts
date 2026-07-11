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
  // Phase 14 LOW-5: resolve the tool name via the alias map BEFORE permission/dispatch.
  // §6 R27-14: pure deterministic config-declared mapping.
  const resolvedName = registry.resolve(call.name);
  const resolvedCall = resolvedName === call.name ? call : { ...call, name: resolvedName };
  call = resolvedCall;
  const decision = requiresApproval(call, ctx, registry, override, effectiveArgs);
  // M4 (review): signal AwaitingApproval to the LaneBoard/event bus BEFORE the
  // human round-trip (CC5 atomicity; §7 R26-D). Cleared after the prompt resolves.
  if (decision.needsHumanPrompt) {
    ctx.lane?.setBlockedOn("approval");
    ctx.emit?.({ state: "AwaitingApproval", call, prompt: { call, reason: (decision as { reason?: string }).reason ?? "approval required", currentMode: (ctx as { mode?: import("@my-agent/core").Mode }).mode ?? "Prompt", requiredMode: registry.get(call.name)?.meta.requiredMode ?? "WorkspaceWrite" } });
  }
  const resolved = await awaitHumanPrompt(call, ctx, decision, registry);
  if (decision.needsHumanPrompt) ctx.lane?.setBlockedOn(undefined);
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
    // C2 (review): stamp the real call.id onto the result (builtins pass their
    // tool NAME as callId — batch correlation was broken).
    result = { ...result, callId: call.id };
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
  // §7 post-hook (M1: pass the EFFECTIVE/mutated args, not the original).
  try { ctx.hooks?.postTool?.({ ...call, args: effectiveArgs }, result); } catch { /* a post-hook never fails the tool */ }
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
  // M3 (review): preserve ORIGINAL call order. Index every result (repaired-error
  // or executed) by its position in `calls`.
  const origOut: (ToolResult | undefined)[] = new Array(calls.length);
  const executable: { call: ToolCall; origIdx: number }[] = [];
  calls.forEach((c, origIdx) => {
    const r = repair(c);
    if ("ok" in r) executable.push({ call: r.ok, origIdx });
    else origOut[origIdx] = { callId: c.id, ok: false, output: null, error: `malformed tool_call: ${r.reason}` };
  });

  // §7 CC7/R28: pre-hooks are AWAITED before the ask-rule match (step 4) reads
  // them. Collect each executable call's {override, args}.
  const pre = await Promise.all(executable.map(async (e) => {
    if (!ctx.hooks?.preTool) return { override: undefined, args: e.call.args };
    try {
      const h = await ctx.hooks.preTool(e.call);
      return { override: h?.override, args: h?.args ?? e.call.args };
    } catch {
      return { override: undefined, args: e.call.args };
    }
  }));

  // §7 R26-D: concurrent-approval serialization. Tools needing a human prompt
  // run SEQUENTIALLY; the rest in parallel. A Deny never cancels siblings.
  const promptCalls: number[] = [];   // executable indices needing a prompt
  const parallelCalls: number[] = [];
  executable.forEach((e, i) => {
    const decision = requiresApproval(e.call, ctx, registry, pre[i]!.override, pre[i]!.args);
    (decision.needsHumanPrompt ? promptCalls : parallelCalls).push(i);
  });

  // parallel batch (no approval)
  await Promise.all(parallelCalls.map(async (i) => {
    const { call, origIdx } = executable[i]!;
    origOut[origIdx] = await runTool(call, ctx, registry, pre[i]!.override, pre[i]!.args);
  }));
  // sequential batch (approval — one prompt at a time)
  for (const i of promptCalls) {
    const { call, origIdx } = executable[i]!;
    origOut[origIdx] = await runTool(call, ctx, registry, pre[i]!.override, pre[i]!.args);
  }

  return aggregate(origOut.filter((r): r is ToolResult => r !== undefined));
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

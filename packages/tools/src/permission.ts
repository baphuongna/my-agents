/**
 * Permission gate (§7) — the 7-step pipeline (simplified for Tier 1).
 *
 * requiresApproval is SYNC (steps 1-3 only: denied_tools / deny / mode-rank).
 * It returns the decision + a `needsHumanPrompt` flag; the human round-trip
 * (step 4, the ask-rule) is a separate async step (R29-1/B1).
 *
 * The mode-rank rule: a tool's `requiredMode` must be satisfied by the active
 * mode, ELSE escalate to a human prompt (or Deny if mode can't reach it).
 *
 * Source: §7 Tools & Permissions, hermes clarify_gateway, R29-1.
 */
import {
  DELEGATE_BLOCKED_TOOLS,
  type ApprovalDecision,
  type PermissionOutcome,
  type ToolCall,
  type TurnContext,
} from "@my-agent/core";
import type { ToolRegistry } from "./registry.js";
import { modeSatisfies } from "./registry.js";

/** A decision + whether a human round-trip is still needed (R29-1). */
export type PermissionResult = PermissionOutcome & { needsHumanPrompt: boolean };

const ALLOW: PermissionResult = { outcome: "Allow", needsHumanPrompt: false };

/**
 * Evaluate steps 1–3 (sync). Returns:
 *   - Allow (no prompt needed)
 *   - Deny (blocked; no prompt)
 *   - {outcome:"Deny"} with needsHumanPrompt (escalate — but Deny is the default
 *     if the human can't be reached; the caller awaits awaitHumanPrompt to flip it)
 *   - {outcome:"Allow", needsHumanPrompt:true} (Prompt mode: ask but lean allow)
 */
export function requiresApproval(
  call: ToolCall,
  ctx: TurnContext,
  registry: ToolRegistry,
): PermissionResult {
  // Step 1: DELEGATE_BLOCKED_TOOLS denylist (subagents inherit this).
  if (DELEGATE_BLOCKED_TOOLS.has(call.name)) {
    return { outcome: "Deny", reason: `blocked: ${call.name}`, needsHumanPrompt: false };
  }

  const impl = registry.get(call.name);
  if (!impl) {
    return { outcome: "Deny", reason: `unknown tool: ${call.name}`, needsHumanPrompt: false };
  }

  // Step 2: explicit override on the context.
  if (ctx.session) {
    // (config-level allow/deny rules land with §7 full pipeline; Tier 1 stub.)
  }

  // Step 3: mode-rank gate — does the active mode satisfy the required mode?
  const active = ctx.budget ? guessActiveMode(ctx) : "Prompt";
  const required = impl.meta.requiredMode;
  if (modeSatisfies(active, required)) {
    // Satisfied without escalation. Prompt mode still asks for visibility.
    if (active === "Prompt") {
      return { outcome: "Allow", needsHumanPrompt: true };
    }
    return ALLOW;
  }

  // Mode can't satisfy → escalate to human. Default-Deny if human unreachable.
  return { outcome: "Deny", reason: `mode ${active} < required ${required}`, needsHumanPrompt: true };
}

/**
 * The human round-trip (step 4). If the sync decision already needs no prompt,
 * returns it as-is; otherwise asks via ctx.approval.
 */
export async function awaitHumanPrompt(
  call: ToolCall,
  ctx: TurnContext,
  decision: PermissionResult,
): Promise<ApprovalDecision> {
  if (!decision.needsHumanPrompt) {
    return decision.outcome === "Allow"
      ? { decision: "Allow" }
      : { decision: "Deny", reason: decision.reason };
  }
  return ctx.approval.request({
    call,
    reason: decision.outcome === "Deny" ? decision.reason : "approval required",
    currentMode: guessActiveMode(ctx),
    requiredMode: registry_requiredMode(call, ctx),
  });
}

// --- helpers ---
function guessActiveMode(ctx: TurnContext): import("@my-agent/core").Mode {
  // Tier 1: default to Prompt (ask) unless the session signals otherwise.
  // A real mode source (CLI flag / config) wires in with §7 full pipeline.
  return "Prompt";
}
function registry_requiredMode(
  _call: ToolCall,
  _ctx: TurnContext,
): import("@my-agent/core").Mode {
  return "WorkspaceWrite";
}

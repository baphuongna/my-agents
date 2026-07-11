/**
 * Permission gate (§7) — the full 7-step pipeline.
 *
 *   1. denied_tools (config + DELEGATE_BLOCKED) — unconditional
 *   2. deny rules (pattern-match tool + arg-subject)
 *   3. hook override (Deny→deny · Ask→prompt · Allow→falls through, respects ask)
 *   4. ask rules → prompt (inviolable)
 *   5. allow/mode (allow-rule, OR Allow-mode+!Danger, OR active≥required+!Danger)
 *   6. escalation prompt (Prompt mode / gap / required===Danger)
 *   7. else Deny
 *
 * Rule grammar: `tool(subject)` exact · `tool(subject:*)` prefix · `tool` any.
 * Arg-subject extracted from 10 JSON keys. Names normalized lowercase. First-
 * match-wins, top-down. requiresApproval is SYNC (R29-1); the human round-trip
 * (step 4/6) is a separate async step via awaitHumanPrompt.
 *
 * Source: §7 Tools & Permissions; claw-code permissions.rs (round-24 deep read);
 * R27-2/D8 (Danger excluded from Allow special-case + rank), R29-1.
 */
import {
  DELEGATE_BLOCKED_TOOLS,
  type ApprovalDecision,
  type HookOverride,
  type Mode,
  type PermissionConfig,
  type PermissionOutcome,
  type ToolCall,
  type TurnContext,
} from "@my-agent/core";
import type { ToolRegistry } from "./registry.js";
import { modeSatisfies } from "./registry.js";

/** A decision + whether a human round-trip is still needed (R29-1). */
export type PermissionResult = PermissionOutcome & { needsHumanPrompt: boolean };

const ALLOW: PermissionResult = { outcome: "Allow", needsHumanPrompt: false };

/** The 10 JSON keys from which an arg-subject is extracted (§7). */
const SUBJECT_KEYS = ["command", "path", "file_path", "filePath", "notebook_path", "notebookPath", "url", "pattern", "code", "message"];

/** A parsed permission rule. */
export interface PermissionRule {
  tool: string;       // lowercase; "*" = any tool
  subject?: string;   // lowercase; absent = any subject
  prefix?: boolean;   // subject ends with :* / *
}

/** Parse a rule string: `tool`, `tool(subject)`, `tool(subject:*)`. Lowercased.
 * H1 (review): allow digits/hyphens/dots in tool names (was [a-z_*] → deny rules
 * for hyphenated/digit tools silently failed open). */
export function parseRule(s: string): PermissionRule | null {
  const raw = s.trim().toLowerCase();
  const m = raw.match(/^([a-z0-9_*.-]+)(?:\((.*)\))?$/);
  if (!m) return null;
  const tool = m[1]!;
  let subj = m[2];
  if (subj === undefined || subj === "") return { tool };
  // H2 (review): `tool(*)` / `tool` = any subject (was matching nothing).
  if (subj === "*") return { tool };
  // prefix if ends with :*
  const prefix = subj.endsWith(":*");
  const subject = prefix ? subj.replace(/:\*$/, "") : subj;
  return { tool, subject: subject || undefined, prefix: prefix || undefined };
}

/** Extract the arg-subject (the first present SUBJECT_KEYS value) from a call.
 * H3 (review): uses `effectiveArgs` when provided (pre-hook mutations visible to
 * rule matching — CC7), else `call.args`. */
export function extractSubject(call: ToolCall, effectiveArgs?: unknown): string | undefined {
  const src = effectiveArgs ?? call.args;
  if (src && typeof src === "object") {
    const a = src as Record<string, unknown>;
    for (const k of SUBJECT_KEYS) {
      const v = a[k];
      if (typeof v === "string") return v.toLowerCase();
    }
  }
  return undefined;
}

/** Does a rule match a call? (tool name + subject, case-normalized). */
export function ruleMatches(rule: PermissionRule, call: ToolCall, effectiveArgs?: unknown): boolean {
  if (rule.tool !== "*" && rule.tool !== call.name.toLowerCase()) return false;
  if (rule.subject === undefined) return true; // any subject
  const subj = extractSubject(call, effectiveArgs);
  if (subj === undefined) return false;
  if (rule.prefix) return subj.startsWith(rule.subject);
  return subj === rule.subject;
}

function matchAny(rules: string[] | undefined, call: ToolCall, effectiveArgs?: unknown): PermissionRule | null {
  if (!rules) return null;
  for (const r of rules) {
    const parsed = parseRule(r);
    if (parsed && ruleMatches(parsed, call, effectiveArgs)) return parsed;
  }
  return null;
}

/**
 * Evaluate the 7-step pipeline (sync). `override` is the pre-hook's step-3
 * decision (CC7: the caller awaits preTool before invoking this). Returns the
 * outcome + needsHumanPrompt (the human round-trip is a separate async step).
 */
export function requiresApproval(
  call: ToolCall,
  ctx: TurnContext,
  registry: ToolRegistry,
  override?: HookOverride,
  effectiveArgs?: unknown,
): PermissionResult {
  const cfg: PermissionConfig = ctx.permission ?? {};
  const name = call.name.toLowerCase();

  // Step 1: denied_tools (config) + DELEGATE_BLOCKED_TOOLS (subagent denylist).
  // C1 (review): compare lowercased — names are normalized lowercase (§7).
  if (DELEGATE_BLOCKED_TOOLS.has(name) || (cfg.deniedTools ?? []).some((d) => d.toLowerCase() === name)) {
    return { outcome: "Deny", reason: `denied: ${call.name}`, needsHumanPrompt: false };
  }

  const impl = registry.get(call.name);
  if (!impl) {
    return { outcome: "Deny", reason: `unknown tool: ${call.name}`, needsHumanPrompt: false };
  }

  // Step 2: deny rules (H3: match against effectiveArgs — pre-hook mutations).
  if (matchAny(cfg.deny, call, effectiveArgs)) {
    return { outcome: "Deny", reason: `deny-rule: ${call.name}`, needsHumanPrompt: false };
  }

  // Step 3: hook override (Allow falls through — still respects ask rules, invariant #13).
  if (override === "Deny") return { outcome: "Deny", reason: "hook-deny", needsHumanPrompt: false };
  if (override === "Ask") return { outcome: "Deny", reason: "hook-ask", needsHumanPrompt: true };

  // Step 4: ask rules (inviolable — always prompt).
  if (matchAny(cfg.ask, call, effectiveArgs)) {
    return { outcome: "Deny", reason: `ask-rule: ${call.name}`, needsHumanPrompt: true };
  }

  const required = impl.meta.requiredMode;
  // F2/D8: DangerFullAccess is EXCLUDED from the Allow special-case AND the rank
  // comparison — it ALWAYS escalates to a step-6 prompt (privilege-escalation hole).
  if (required === "DangerFullAccess") {
    return { outcome: "Deny", reason: "DangerFullAccess requires explicit human approval", needsHumanPrompt: true };
  }

  // Step 5: allow/mode.
  const active = activeMode(ctx);
  if (matchAny(cfg.allow, call, effectiveArgs)) return ALLOW;
  if (active === "Allow") return ALLOW; // Allow = up to WorkspaceWrite (Danger already handled above)
  // R27-2/D9: Prompt mode auto-allows ReadOnly, prompts for writes.
  if (active === "Prompt") {
    return required === "ReadOnly"
      ? ALLOW
      : { outcome: "Allow", needsHumanPrompt: true };
  }
  if (modeSatisfies(active, required)) {
    return ALLOW;
  }

  // Step 6: escalation prompt (mode can't satisfy; Prompt mode already handled).
  return { outcome: "Deny", reason: `mode ${active} < required ${required}`, needsHumanPrompt: true };
}

/**
 * The human round-trip (steps 4/6). If no prompt is needed, returns the sync
 * decision as-is; otherwise asks via ctx.approval (an explicit handle, never
 * parent stdin — inviolable).
 */
export async function awaitHumanPrompt(
  call: ToolCall,
  ctx: TurnContext,
  decision: PermissionResult,
  registry: ToolRegistry,
): Promise<ApprovalDecision> {
  if (!decision.needsHumanPrompt) {
    return decision.outcome === "Allow"
      ? { decision: "Allow" }
      : { decision: "Deny", reason: decision.reason };
  }
  const impl = registry.get(call.name);
  const requiredMode = impl?.meta.requiredMode ?? "WorkspaceWrite";
  return ctx.approval.request({
    call,
    reason: decision.outcome === "Deny" ? decision.reason : "approval required",
    currentMode: activeMode(ctx),
    requiredMode,
  });
}

// --- helpers ---

/** The active permission mode. Tier-1: ctx.mode if set, else Prompt. */
function activeMode(ctx: TurnContext): Mode {
  // ctx.mode is the session's declared mode (CLI flag / config). Falls back to
  // Prompt (ask for writes) per R27-2/D9.
  return ctx.mode ?? "Prompt";
}

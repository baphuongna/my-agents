/**
 * RecoveryRecipe FSM (§14.3) — bounded recovery: detect → classify → apply
 * bounded retry → escalate (not "kill"). A typed FailureScenario→recipe table
 * replaces a generic "bounded retry".
 *
 * Source: §14.3; claw-code recovery_recipes.rs.
 */
import type { LifecycleError } from "@my-agent/core";

/** Typed failure symptom (not stringly). */
export type FailureScenario =
  | "NetworkError"
  | "ToolTimeout"
  | "InvalidOutput"
  | "PermissionDenied"
  | "Provider5xx"
  | "ApprovalExpired"
  | "Unknown";

/** A single recovery step. */
export type RecoveryStep =
  | { kind: "retry"; delayMs?: number }
  | { kind: "reauth" }          // re-run the OAuth/refresh flow
  | { kind: "rephrase" }        // re-issue the prompt
  | { kind: "rebuild-context" } // run compression + re-assemble
  | { kind: "escalate" };       // surface to the operator

/** What to do when the recipe's bound is exhausted. */
export type EscalationPolicy = "surface" | "abort-turn" | "fail-open-read-only";

/** A recovery recipe: how to handle one failure scenario. */
export interface RecoveryRecipe {
  scenario: FailureScenario;
  /** Does this error match the scenario? */
  detect: (err: LifecycleError) => boolean;
  /** The ordered steps + bounds. */
  classify: (err: LifecycleError) => { steps: RecoveryStep[]; bound: number; escalateAfter: number };
  /** Apply a step (the host wires the real action). */
  apply: (step: RecoveryStep, err: LifecycleError) => Promise<void>;
  /** Exhaustion policy. */
  onExhaust: EscalationPolicy;
}

/** The default recipe table — one entry per FailureScenario. */
export function defaultRecoveryRecipes(apply: RecoveryRecipe["apply"]): RecoveryRecipe[] {
  const noop = async () => {};
  return [
    {
      scenario: "NetworkError",
      detect: (e) => e.phase === "provider" && /network|econnreset|etimedout|fetch/i.test(e.context["reason"] ?? ""),
      classify: () => ({ steps: [{ kind: "retry", delayMs: 500 }, { kind: "retry", delayMs: 1500 }], bound: 3, escalateAfter: 2 }),
      apply, onExhaust: "surface",
    },
    {
      scenario: "Provider5xx",
      detect: (e) => e.phase === "provider" && /5\d\d|server error|overloaded/i.test(e.context["reason"] ?? ""),
      classify: () => ({ steps: [{ kind: "retry", delayMs: 1000 }, { kind: "retry", delayMs: 3000 }], bound: 3, escalateAfter: 2 }),
      apply, onExhaust: "surface",
    },
    {
      scenario: "ToolTimeout",
      detect: (e) => e.phase === "tool" && /timeout|timed out/i.test(e.context["reason"] ?? ""),
      classify: () => ({ steps: [{ kind: "retry" }], bound: 2, escalateAfter: 1 }),
      apply, onExhaust: "surface",
    },
    {
      scenario: "InvalidOutput",
      detect: (e) => e.phase === "validation",
      classify: () => ({ steps: [{ kind: "rephrase" }, { kind: "rebuild-context" }], bound: 2, escalateAfter: 1 }),
      apply, onExhaust: "abort-turn",
    },
    {
      scenario: "PermissionDenied",
      detect: (e) => e.phase === "tool" && /denied|permission/i.test(e.context["reason"] ?? ""),
      classify: () => ({ steps: [], bound: 0, escalateAfter: 0 }),
      apply: noop as RecoveryRecipe["apply"], onExhaust: "surface",
    },
    {
      scenario: "ApprovalExpired",
      detect: (e) => e.phase === "tool" && /approval.*expired|token expired/i.test(e.context["reason"] ?? ""),
      classify: () => ({ steps: [{ kind: "escalate" }], bound: 1, escalateAfter: 0 }),
      apply, onExhaust: "fail-open-read-only",
    },
  ];
}

export interface RecoveryAttempt {
  scenario: FailureScenario;
  stepsTaken: number;
  exhausted: boolean;
  /** MEDIUM-2 (review): did the recipe give up because an apply threw? The host
   * must distinguish this from a clean bounded-exhaustion. */
  aborted: boolean;
  policy: EscalationPolicy;
}

/**
 * Run the bounded recovery for an error. Returns the attempt record (stepsTaken,
 * exhausted, the exhaustion policy). Bounded by `bound` — never retries forever.
 */
export async function runRecovery(
  err: LifecycleError,
  recipes: RecoveryRecipe[],
): Promise<RecoveryAttempt> {
  const recipe = recipes.find((r) => r.detect(err));
  if (!recipe) {
    // MEDIUM-1 (review): unknown errors are "Unknown", NOT mislabeled PermissionDenied.
    return { scenario: "Unknown", stepsTaken: 0, exhausted: true, aborted: false, policy: "surface" };
  }
  const { steps, bound, escalateAfter } = recipe.classify(err);
  let stepsTaken = 0;
  let aborted = false;
  for (let i = 0; i < Math.min(steps.length, bound); i++) {
    try {
      await recipe.apply(steps[i]!, err);
      stepsTaken++;
    } catch {
      aborted = true; // MEDIUM-2: an apply failure aborts the recipe (distinct from exhaustion)
      break;
    }
    if (stepsTaken >= escalateAfter) break;
  }
  const exhausted = stepsTaken >= escalateAfter || steps.length === 0;
  return { scenario: recipe.scenario, stepsTaken, exhausted, aborted, policy: recipe.onExhaust };
}

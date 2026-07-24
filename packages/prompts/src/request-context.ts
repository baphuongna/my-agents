/**
 * Request-context rebuilders — mya analog of Hermes' `select_context()` (shard 02).
 *
 * Hermes lets a ContextEngine **replace** the assembled request message list via
 * `select_context(...)`. mya's prompt is a 3-tier `SystemPrompt` (stable/context/
 * volatile); the analog is a hook that may **rewrite the context tier** (project
 * files / retrieved context) before the provider call — currently mya only injects
 * recall strings into the volatile tier.
 *
 * Patterns P1-P7 (from research/shards/02-context-engine.md):
 *   P1 — no-op default is zero-cost: an empty rebuilder list returns the exact
 *        same reference (identity check — cache-stable, P6).
 *   P2 — fail-open: a throwing rebuilder is swallowed + logged; the request
 *        always survives.
 *   P3 — empty-result trap: a rebuilder that returns an empty context string
 *        falls open (keeps the previous context) — avoids `all([]) is True`.
 *   P4 — shallow-copy isolation: each rebuilder receives a defensive shallow
 *        copy so it cannot corrupt the caller's input.
 *   P5 — request-only: the rebuilt context is used for a single provider call;
 *        persisted state is never mutated.
 *   P6 — cache-stability: when NO rebuilder changes anything, the input object
 *        is returned unchanged (`out === input`) so prompt-cache breakpoints
 *        are unperturbed.
 *   P7 — structural validation only: the gate checks "non-empty string"; deeper
 *        normalization (injection scan, role selection) is deferred downstream.
 *
 * Source: research/shards/02-context-engine.md P1-P7; hermes
 * `agent/context_engine.py:214-269` + `conversation_loop.py:719-806`.
 */
import { nowWallclock } from "@my-agent/core";

/** The request context passed to rebuilders. Each field is a shallow-copy-isolated
 * projection — rebuilders may freely mutate their copy without corrupting the
 * caller's state (P4). */
export interface RequestContext {
  /** Stable tier (identity + skills/tools index) — rebuilders rarely touch this. */
  stable: string;
  /** Context tier (project files / retrieved context) — the primary rewrite target. */
  context: string;
  /** Volatile tier (memory + user prefs + day-precision timestamp). */
  volatile: string;
  /** Conversation history entries (reference-only — never mutated, P5). */
  history: readonly unknown[];
  /** The incoming user message for this turn (may be undefined). */
  incoming?: string;
  /** Context window budget in tokens (0 = unknown). */
  budgetTokens: number;
}

/** A rebuilder receives a defensive copy and returns the rewritten context (or
 * `null` to signal "no change this turn"). Returning `null` is the no-op path
 * (P1) — it preserves the exact input for cache-stability (P6). */
export type RequestContextRebuilder = (input: RequestContext) => {
  context: string;
  /** Optional: also rewrite the volatile tier (e.g. inject a fresh summary). */
  volatile?: string;
} | null;

/** The result of applying rebuilders — the rebuilt context + whether any change
 * was made (cache-stability signal, P6). */
export interface RequestContextResult {
  /** The rebuilt context (may be the exact same object as the input when no
   * rebuilder changed anything — `result === input`, P6). */
  context: RequestContext;
  /** True when at least one rebuilder returned a non-null, non-empty result. */
  changed: boolean;
  /** Number of rebuilders that were actually invoked (P1: 0 for empty list). */
  invocations: number;
}

/** Internal: shallow-copy a RequestContext so a rebuilder cannot corrupt the
 * caller's input (P4). `history` is reference-only (a shallow copy of the array
 * shell — individual entries are NOT cloned, matching the read-only contract). */
function shallowCopy(input: RequestContext): RequestContext {
  return {
    stable: input.stable,
    context: input.context,
    volatile: input.volatile,
    // Spread creates a new array shell (rebuilders can't push/splice the original).
    history: [...input.history],
    incoming: input.incoming,
    budgetTokens: input.budgetTokens,
  };
}

/**
 * Apply request-context rebuilders to the assembled context. This is the mya
 * analog of Hermes' `select_context()` host call site
 * (`conversation_loop.py:719-806`).
 *
 * Contract (P1-P7):
 *   - Empty list → return input unchanged (same reference, P1/P6).
 *   - A rebuilder returning `null` → no change for this rebuilder (P1).
 *   - A rebuilder returning an empty `context` string → fall open (P3 trap).
 *   - A rebuilder throwing → logged + skipped (P2 fail-open).
 *   - When NO rebuilder changes anything → return the EXACT input object (P6).
 *   - Each rebuilder gets a defensive shallow copy (P4 isolation).
 *
 * @param rebuilders  Ordered list of rebuilders (applied left-to-right).
 * @param input       The assembled request context.
 * @param opts.logger Optional warning logger (P2). Defaults to console.warn.
 */
export function apply_request_context(
  rebuilders: readonly RequestContextRebuilder[],
  input: RequestContext,
  opts?: { logger?: (msg: string, err?: unknown) => void; now?: () => number },
): RequestContextResult {
  const logger = opts?.logger ?? ((msg: string) => console.warn(msg));

  // P1: empty list — zero-cost no-op. Return the exact input (cache-stable, P6).
  if (rebuilders.length === 0) {
    return { context: input, changed: false, invocations: 0 };
  }

  let current = input;
  let changed = false;
  let invocations = 0;

  for (const rebuild of rebuilders) {
    invocations++;
    try {
      // P4: pass a defensive shallow copy so the rebuilder cannot corrupt `current`.
      const copy = shallowCopy(current);
      const result = rebuild(copy);

      // P1: null → no change (rebuilder opted out this turn).
      if (result === null) continue;

      // P3: empty-context trap — fall open (keep the previous context). Without
      // this check, a buggy rebuilder returning "" would blank out the context.
      if (result.context.length === 0) {
        logger("[request-context] rebuilder returned empty context — falling open");
        continue;
      }

      // P7: structural validation passed (non-empty string). Apply the rewrite.
      current = {
        ...current,
        context: result.context,
        volatile: result.volatile ?? current.volatile,
      };
      changed = true;
    } catch (e) {
      // P2: fail-open — a throwing rebuilder is swallowed + logged. The request
      // always survives ("a failing engine is never worse than not installing one").
      logger(
        `[request-context] rebuilder threw — falling open: ${e instanceof Error ? e.message : String(e)}`,
        e,
      );
    }
  }

  // P6: cache-stability — when no rebuilder changed anything, return the EXACT
  // input object so downstream cache-control sees byte-identical input.
  if (!changed) {
    return { context: input, changed: false, invocations };
  }

  return { context: current, changed: true, invocations };
}

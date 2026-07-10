/**
 * streamWithFallback (§6) — try ProviderProfile[] in order, skip tainted ones,
 * return the first ok stream OR an AllProvidersDegraded error.
 *
 * Semantics (R27-1/D7, CC8):
 *   - tries profiles in fallback order
 *   - SKIPS auth/quota-tainted ones (registry.eligible)
 *   - on a recoverable error (network/rate-limited), taints + tries next
 *   - on auth/quota, taints (won't reuse) + tries next
 *   - collects stream events into the return value (CC8: never emits directly
 *     to the bus — only the turn loop's emit() feeds observers)
 *   - all-profiles-tainted/exhausted → AllProvidersDegraded (not generic Failed)
 *
 * Source: §6, R25-4b, R27-1 D7, R27-1 CC8.
 */
import type {
  Cost,
  History,
  LifecycleError,
  ProviderProfile,
  StreamEvent,
  SystemPrompt,
} from "@my-agent/core";
import { ProviderRegistry } from "./registry.js";
import type { TaintReason } from "./registry.js";

export type FallbackResult =
  | { kind: "ok"; profile: ProviderProfile; events: StreamEvent[]; partialCost?: Cost }
  | { kind: "error"; error: LifecycleError };

/** Classify a LifecycleError.phase → taint reason (or null = don't taint). */
function taintFor(phase: LifecycleError["phase"]): TaintReason | null {
  switch (phase) {
    case "auth":
      return "auth";
    case "quota":
      return "quota";
    case "provider":
      return "rate_limited";
    case "stream":
      return "network";
    default:
      return null;
  }
}

/**
 * streamWithFallback — accepts either a raw profile list or a registry.
 * With a registry, tainted profiles are skipped + failures taint + retry.
 */
export async function streamWithFallback(
  source: ProviderProfile[] | ProviderRegistry,
  prompt: SystemPrompt,
  history: History,
): Promise<FallbackResult> {
  let profiles: ProviderProfile[];
  let registry: ProviderRegistry | null = null;
  if (source instanceof ProviderRegistry) {
    registry = source;
    profiles = source.available();
  } else {
    profiles = source;
  }

  if (profiles.length === 0) {
    return {
      kind: "error",
      error: {
        phase: "provider",
        recoverable: false,
        retries: 0,
        context: { reason: "no eligible provider profiles (all degraded)" },
      },
    };
  }

  let lastError: LifecycleError | null = null;
  for (const profile of profiles) {
    try {
      const { events } = await profile.stream(prompt, history);
      // Inspect events for an inline error (provider returned a stream error).
      const inlineError = events.find((e: StreamEvent) => e.kind === "error");
      if (inlineError && inlineError.kind === "error") {
        const err = inlineError.error;
        lastError = err;
        const reason = taintFor(err.phase);
        if (registry && reason) registry.taint(profile.id, reason);
        continue; // try next profile (recoverable or not — a different provider may work)
      }
      return { kind: "ok", profile, events };
    } catch (e) {
      lastError = {
        phase: "provider",
        recoverable: true,
        retries: 0,
        context: { reason: e instanceof Error ? e.message : String(e) },
      };
      if (registry) registry.taint(profile.id, "network");
      continue;
    }
  }

  // All profiles exhausted.
  return {
    kind: "error",
    error:
      lastError ?? {
        phase: "provider",
        recoverable: false,
        retries: 0,
        context: { reason: "AllProvidersDegraded" },
      },
  };
}

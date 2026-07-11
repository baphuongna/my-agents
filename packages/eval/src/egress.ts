/**
 * §15 no-egress guard + golden-set age gate.
 *
 * During non-credentialed test tiers (unit, integration), network calls are
 * forbidden — a drifted test that accidentally hits the network is a silent
 * cost leak + a non-determinism source. installEgressGuard monkey-patches
 * globalThis.fetch to throw if called outside the credentialed tier.
 *
 * The golden-set age gate warns when a recorded fixture grows stale (the model
 * version that produced it may have drifted).
 *
 * Source: §15 Eval & Quality Gates, R26-F no-egress.
 */

let installed = false;
let originalFetch: typeof globalThis.fetch | null = null;

/**
 * Install a fetch guard. When `allowNetwork` is false, ANY call to fetch
 * throws an EgressViolationError. Call with allowNetwork=true (or restoreEgress)
 * to remove the guard (e.g. before the credentialed tier begins).
 *
 * Returns a restore function for convenience in tests.
 */
export function installEgressGuard(opts: { allowNetwork?: boolean } = {}): () => void {
  if (installed) {
    // Already installed — update the flag instead of double-patching.
    if (opts.allowNetwork) {
      restoreEgress();
    }
    return restoreEgress;
  }
  installed = true;
  originalFetch = globalThis.fetch;
  if (opts.allowNetwork) {
    return restoreEgress;
  }
  globalThis.fetch = ((_input: unknown, _init?: unknown) =>
    Promise.reject(
      new EgressViolationError(
        "network egress blocked by eval guard (non-credentialed tier)",
      ),
    )) as typeof globalThis.fetch;
  return restoreEgress;
}

/** Remove the egress guard (restores the original fetch). */
export function restoreEgress(): void {
  if (!installed || originalFetch === null) return;
  globalThis.fetch = originalFetch;
  installed = false;
  originalFetch = null;
}

/** Error thrown when a guarded test tier attempts network access. */
export class EgressViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EgressViolationError";
  }
}

/**
 * Golden-set age gate. Returns { stale, ageDays } for a recorded fixture.
 * A golden is stale when recordedAt + maxAgeDays < now.
 */
export function checkGoldenAge(
  recordedAt: number | undefined,
  now: number,
  maxAgeDays = 90,
): { stale: boolean; ageDays: number | null } {
  if (recordedAt === undefined) {
    return { stale: false, ageDays: null }; // unknown age → don't block (best-effort)
  }
  const ageMs = now - recordedAt;
  const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));
  return { stale: ageDays > maxAgeDays, ageDays };
}

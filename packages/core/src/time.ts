/**
 * core.time — the SINGLE time helper (invariant #10).
 *
 * Never call `Date.now()` / `SystemTime::now()` outside this module. Injectable
 * for tests via `setTimeProvider`. Day-precision timestamps keep the volatile
 * prompt tier cache-stable (R25-15).
 */

export interface TimeProvider {
  nowWallclock(): number;
  nowMonotonic(): number;
}

const realProvider: TimeProvider = {
  nowWallclock: () => Date.now(),
  // perf.performance.now()*1e3 gives a monotonic ms since process start
  nowMonotonic: () =>
    typeof performance !== "undefined" ? performance.now() * 1000 : Date.now(),
};

let provider: TimeProvider = realProvider;

/** Test hook: inject a fake clock. Restore with `setTimeProvider(realProvider)`. */
export function setTimeProvider(p: TimeProvider): void {
  provider = p;
}

export function nowWallclock(): number {
  return provider.nowWallclock();
}
export function nowMonotonic(): number {
  return provider.nowMonotonic();
}

/** Epoch-day (UTC) — day-precision by design; stable for the volatile prompt tier. */
export function today(): number {
  return Math.floor(nowWallclock() / 86_400_000);
}

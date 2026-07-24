/**
 * usePolling — recursive setTimeout polling hook.
 *
 * Port of Hermes's recursive-`setTimeout` polling pattern (SystemActions.tsx).
 * Unlike `setInterval`, recursive `setTimeout` guarantees the callback never
 * overlaps: the next tick is scheduled *after* the current callback settles, so
 * slow responses can't pile up. A `cancelled` flag ensures no state update
 * leaks after unmount.
 *
 * The callback may be async; the hook awaits it before scheduling the next
 * tick. Pass `{ immediate: false }` to skip the initial fire.
 */
import { useCallback, useEffect, useRef } from "react";

export interface UsePollingOptions {
  /** Fire immediately on mount (default: true). */
  immediate?: boolean;
  /** Whether polling is active (default: true). Set false to pause. */
  enabled?: boolean;
}

export function usePolling(
  callback: () => void | Promise<void>,
  intervalMs: number,
  options: UsePollingOptions = {},
): void {
  const { immediate = true, enabled = true } = options;

  // Keep the latest callback in a ref so the effect doesn't restart on every
  // render when the caller passes an inline function.
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  const tick = useCallback(async () => {
    try {
      await callbackRef.current();
    } catch {
      // Swallow — transient errors must not break the polling loop.
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const scheduleNext = () => {
      timer = setTimeout(async () => {
        if (cancelled) return;
        await tick();
        if (!cancelled) scheduleNext();
      }, intervalMs);
    };

    if (immediate) {
      // Fire once right away, then begin the recursive schedule.
      void tick().then(() => {
        if (!cancelled) scheduleNext();
      });
    } else {
      scheduleNext();
    }

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [intervalMs, immediate, enabled, tick]);
}

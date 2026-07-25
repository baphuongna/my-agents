/**
 * useDebouncedValue — debounce a rapidly-changing value.
 *
 * Port of Hermes's debounced search pattern (SessionsPage.tsx:851-872).
 * Returns a value that only updates after `delayMs` have passed without
 * the input changing. Rapid successive changes collapse to the last one,
 * deferring expensive recomputation (list filtering, network) until
 * typing settles.
 *
 * Guarantees:
 *  - The first render returns the initial value immediately (no leading
 *    delay), so pages don't flash empty.
 *  - The pending timeout is cleared on unmount or when the value changes
 *    again before it fires — no stale updates leak.
 */
import { useEffect, useState } from "react";

export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

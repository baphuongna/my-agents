/**
 * Hard-exit after graceful teardown.
 *
 * Releases locks BEFORE draining logs (never strand a lock behind a potentially
 * wedged log queue), then hard-exits via `process.exit` (Node's hard exit —
 * pending timers / atexit-equivalents do NOT run).
 *
 * Ported from Hermes `_exit_after_graceful_shutdown` (deep-dive.md §6.5).
 *
 * Why hard-exit (not `throw` / let the event loop drain): a wedged
 * ThreadPoolExecutor or blocked LLM call keeps the event loop alive forever.
 * `process.exit` is the only way to guarantee the supervisor can restart the
 * gateway.
 */

export interface ExitOptions {
  /** Remove the PID file (releases the process identity marker). */
  removePidFile?: () => void;
  /** Release the runtime / gateway lock. Called BEFORE log drain. */
  releaseLock?: () => void;
  /** Drain the log queue (bounded — receives a timeout in ms). */
  drainLogQueue?: (timeoutMs: number) => void;
}

/**
 * Flush stdio, release locks, drain logs, then hard-exit.
 *
 * Ordering rationale:
 *  1. Flush stdio — don't lose pending output.
 *  2. Release locks BEFORE log drain — a wedged log queue must never strand a
 *     lock (a stranded lock blocks restart).
 *  3. Drain log queue with a bounded 1 s timeout.
 *  4. `process.exit(code)` — hard exit.
 */
export function exitAfterGracefulShutdown(code: number, opts?: ExitOptions): never {
  // 1. Flush stdio (best-effort).
  try {
    process.stdout.write("");
    process.stderr.write("");
  } catch {
    /* best-effort — streams may already be closed */
  }

  // 2. Release locks BEFORE log drain (never strand locks).
  opts?.removePidFile?.();
  opts?.releaseLock?.();

  // 3. Drain log queue with bounded timeout.
  opts?.drainLogQueue?.(1000);

  // 4. Hard exit.
  process.exit(code);
}

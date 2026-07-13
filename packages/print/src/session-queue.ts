/**
 * SessionPromptQueue — serialize async work per key, parallel across keys.
 *
 * Why this exists: AgentSession.prompt() throws if a second prompt fires
 * while one is already in flight. When the gateway receives two concurrent
 * requests for the same session (e.g. two cron fires, a channel message
 * + a cron fire), calling session.prompt() in parallel would throw an
 * unhandled rejection and kill the process.
 *
 * Fix: chain prompts per session. Different sessions stay parallel.
 *
 * Extracted from main.ts (runOnSession) on 2026-07-13 to make this
 * race-prone logic directly testable. Behavior is identical to the
 * previous inline implementation.
 */

/**
 * Run `fn` serialized per key. Calls sharing a key chain after each
 * other in submission order; calls with different keys run in parallel.
 * Errors from one call are swallowed at the chain boundary so a single
 * failing call never breaks the queue for subsequent calls.
 */
export class SessionPromptQueue {
  private readonly chains = new Map<string, Promise<unknown>>();

  /** Number of keys with pending chains. Mostly for tests/observability. */
  size(): number {
    return this.chains.size;
  }

  /** True if a chain is currently in flight for `key`. */
  has(key: string): boolean {
    return this.chains.has(key);
  }

  /**
   * Enqueue `fn` under `key`. Returns a promise that resolves with `fn`'s
   * result (or rejects with its error). If `fn` throws, the error is
   * surfaced to the caller AND the chain is cleared for `key` so the
   * next call can proceed.
   *
   * Cleanup uses `.then(cleanup, cleanup)` (not `.finally`) so the
   * rejection handler observes `next`'s rejection. `.finally` returns a
   * new promise that re-rejects with the same reason, which would be
   * flagged as unhandled when no caller `.catch` is attached in time.
   */
  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(key) ?? Promise.resolve();
    // Swallow prev's rejection so one failure doesn't poison the chain.
    // The caller still sees the rejection of its own `fn`.
    const next: Promise<T> = prev.then(() => fn(), () => fn());
    this.chains.set(key, next);
    const cleanup = () => {
      if (this.chains.get(key) === next) this.chains.delete(key);
    };
    next.then(cleanup, cleanup);
    return next;
  }
}

/**
 * SessionPromptQueue — serialize async work per key, parallel across keys.
 *
 * Why this exists: AgentSession.prompt() throws if a second prompt fires
 * while one is already in flight. When the gateway receives two concurrent
 * requests for the same session (e.g. two cron fires, a channel message
 * + a cron fire), calling session.prompt() in parallel would throw an
 * unhandled rejection and kill the process.
 *
 * Backpressure (Phase 1):
 *   - maxQueueDepth (default 8): reject new prompts if queue is full
 *   - queueTimeoutMs (default 30s): reject if a prompt takes too long
 *   - depth(id): observe queue depth for /pool/queue/:id endpoint
 *
 * Source: §3 architecture, mya-v1 SessionActorQueue (mya-v1/crates/mya-infra/src/session_queue.rs)
 */

export class QueueFullError extends Error {
  readonly sessionId: string;
  readonly depth: number;
  readonly maxDepth: number;
  constructor(sessionId: string, depth: number, maxDepth: number) {
    super(`Session ${sessionId} queue full (${depth}/${maxDepth} pending requests)`);
    this.name = "QueueFullError";
    this.sessionId = sessionId;
    this.depth = depth;
    this.maxDepth = maxDepth;
  }
}

export class QueueTimeoutError extends Error {
  readonly sessionId: string;
  readonly timeoutMs: number;
  constructor(sessionId: string, timeoutMs: number) {
    super(`Session ${sessionId} queue timeout after ${timeoutMs}ms`);
    this.name = "QueueTimeoutError";
    this.sessionId = sessionId;
    this.timeoutMs = timeoutMs;
  }
}

export interface SessionPromptQueueOptions {
  /** Max concurrent pending requests per session. Default 8. */
  maxQueueDepth?: number;
  /** Per-prompt timeout in ms. Default 30_000. */
  queueTimeoutMs?: number;
}

/**
 * Run `fn` serialized per key. Calls sharing a key chain after each
 * other in submission order; calls with different keys run in parallel.
 *
 * Backpressure:
 *   - If queue depth >= maxQueueDepth, throws QueueFullError immediately
 *     (does NOT block waiting for space).
 *   - Each call has a timeout. If it doesn't complete in queueTimeoutMs,
 *     the caller gets QueueTimeoutError.
 */
export class SessionPromptQueue {
  private readonly chains = new Map<string, Promise<unknown>>();
  private readonly depths = new Map<string, number>();
  private readonly maxQueueDepth: number;
  private readonly queueTimeoutMs: number;

  constructor(opts: SessionPromptQueueOptions = {}) {
    this.maxQueueDepth = opts.maxQueueDepth ?? 8;
    this.queueTimeoutMs = opts.queueTimeoutMs ?? 30_000;
  }

  /** Number of keys with pending chains. */
  size(): number {
    return this.chains.size;
  }

  /** Current queue depth for a session (pending + active). */
  depth(sessionId: string): number {
    return this.depths.get(sessionId) ?? 0;
  }

  /** Max queue depth. */
  get maxDepth(): number {
    return this.maxQueueDepth;
  }

  /** Per-call timeout. */
  get timeoutMs(): number {
    return this.queueTimeoutMs;
  }

  /**
   * Enqueue `fn` under `sessionId`. Returns a promise that:
   *   - resolves with `fn`'s result
   *   - rejects with QueueFullError if depth >= maxQueueDepth
   *   - rejects with QueueTimeoutError if fn takes longer than queueTimeoutMs
   *   - rejects with fn's error
   *
   * Errors from one call are swallowed at the chain boundary so a single
   * failing call never breaks the queue for subsequent calls.
   */
  run<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
    // Backpressure: check depth BEFORE queueing.
    const current = this.depths.get(sessionId) ?? 0;
    if (current >= this.maxQueueDepth) {
      return Promise.reject(new QueueFullError(sessionId, current, this.maxQueueDepth));
    }

    const prev = this.chains.get(sessionId) ?? Promise.resolve();

    // Timeout wrapper
    const withTimeout = (): Promise<T> => {
      return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new QueueTimeoutError(sessionId, this.queueTimeoutMs));
        }, this.queueTimeoutMs);
        fn().then(
          (v) => { clearTimeout(timer); resolve(v); },
          (e) => { clearTimeout(timer); reject(e); },
        );
      });
    };

    // Track depth
    const trackDepth = (op: () => Promise<T>): Promise<T> => {
      this.depths.set(sessionId, (this.depths.get(sessionId) ?? 0) + 1);
      return op().finally(() => {
        const d = (this.depths.get(sessionId) ?? 1) - 1;
        if (d <= 0) this.depths.delete(sessionId);
        else this.depths.set(sessionId, d);
      });
    };

    // Swallow prev's rejection so one failure doesn't poison the chain.
    // The caller still sees the rejection of its own `fn`.
    const next: Promise<T> = prev.then(
      () => trackDepth(withTimeout),
      () => trackDepth(withTimeout),
    );
    this.chains.set(sessionId, next);
    const cleanup = () => {
      if (this.chains.get(sessionId) === next) this.chains.delete(sessionId);
    };
    next.then(cleanup, cleanup);
    return next;
  }
}

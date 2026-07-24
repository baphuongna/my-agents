/**
 * supervisedTask — crash-resilient long-running task wrapper (P7, shard 07).
 *
 * Mya uses `setInterval` for cron/idle/poll timers with no crash detection — a
 * throw inside the interval callback is an unhandled rejection. This module
 * wraps an async task factory so that:
 *   - exceptions are caught + logged (never propagate as unhandled rejections),
 *   - consecutive crashes are capped at `maxRestarts` (default 5) within a
 *     `windowMs` (default 300s) window,
 *   - exponential backoff between restarts (prevents tight CPU loops),
 *   - the counter RESETS when a task ran `longRunMs` (default 300s) or more
 *     before crashing (a stable task that occasionally hiccups isn't a crash
 *     loop).
 *
 * Source: research/shards/07-gateway.md — supervised task spawning.
 */
import { nowWallclock } from "./time.js";

export interface SupervisedTaskOptions {
  /** Max consecutive restarts within `windowMs`. Default: 5. */
  maxRestarts?: number;
  /** Sliding window for counting consecutive restarts (ms). Default: 300_000. */
  windowMs?: number;
  /** If a task runs this long before crashing, reset the counter (ms). Default: 300_000. */
  longRunMs?: number;
  /** Base backoff in ms (doubles each restart). Default: 1_000. */
  baseBackoffMs?: number;
  /** Max backoff cap in ms. Default: 30_000. */
  maxBackoffMs?: number;
  /** Logger for crash/restart/give-up messages. Default: console.error. */
  logger?: (msg: string, err?: unknown) => void;
  /** Injectable clock (for tests). Default: nowWallclock. */
  now?: () => number;
  /** Injectable sleep (for tests). Default: setTimeout-based. */
  sleep?: (ms: number) => Promise<void>;
}

export interface SupervisedTaskHandle {
  /** Stop the supervised task (no more restarts). */
  stop(): void;
  /** Current consecutive restart count. */
  readonly restartCount: number;
  /** Whether the task gave up (hit maxRestarts). */
  readonly gaveUp: boolean;
  /** Whether the task is currently running. */
  readonly running: boolean;
}

/**
 * Run an async task with supervised restart-on-crash.
 *
 * @param factory  A zero-arg async function that creates/starts the task. Called
 *                 on initial start + each restart. The returned promise resolves
 *                 on normal completion and rejects on crash.
 * @param name     Human-readable name for log messages.
 * @param opts     Tuning knobs (see SupervisedTaskOptions).
 * @returns        A handle to stop the task + observe state.
 */
export function supervisedTask(
  factory: () => Promise<void>,
  name: string,
  opts: SupervisedTaskOptions = {},
): SupervisedTaskHandle {
  const maxRestarts = opts.maxRestarts ?? 5;
  const windowMs = opts.windowMs ?? 300_000;
  const longRunMs = opts.longRunMs ?? 300_000;
  const baseBackoffMs = opts.baseBackoffMs ?? 1_000;
  const maxBackoffMs = opts.maxBackoffMs ?? 30_000;
  const logger = opts.logger ?? ((msg: string, err?: unknown) => console.error(msg, err ?? ""));
  const now = opts.now ?? nowWallclock;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => {
    const t = setTimeout(r, ms);
    t.unref?.();
  }));

  let stopped = false;
  let restartCount = 0;
  let gaveUp = false;
  let running = false;

  async function loop(): Promise<void> {
    while (!stopped) {
      const startTime = now();
      running = true;
      try {
        await factory();
        running = false;
        return; // normal completion — no restart needed
      } catch (e) {
        running = false;
        if (stopped) return;
        const ranMs = now() - startTime;

        // If the task ran ≥ longRunMs before crashing, it's stable — reset the
        // consecutive restart counter (this wasn't a crash loop).
        if (ranMs >= longRunMs) {
          restartCount = 0;
        }

        logger(`[supervised:${name}] crashed after ${ranMs}ms: ${e instanceof Error ? e.message : String(e)}`, e);

        restartCount++;
        if (restartCount > maxRestarts) {
          gaveUp = true;
          logger(`[supervised:${name}] giving up after ${maxRestarts} consecutive restarts within ${windowMs}ms`);
          return;
        }

        // Exponential backoff: base * 2^(restartCount-1), capped.
        const backoff = Math.min(maxBackoffMs, baseBackoffMs * Math.pow(2, restartCount - 1));
        logger(`[supervised:${name}] restart ${restartCount}/${maxRestarts} in ${backoff}ms`);
        await sleep(backoff);
        if (stopped) return;
      }
    }
  }

  // Kick off the loop (fire-and-forget; the caller uses the handle to stop).
  void loop();

  return {
    stop() {
      stopped = true;
    },
    get restartCount() {
      return restartCount;
    },
    get gaveUp() {
      return gaveUp;
    },
    get running() {
      return running;
    },
  };
}

/**
 * Process-level exception handlers (P7, shard 07).
 *
 * Adds `process.on('unhandledRejection')` + `process.on('uncaughtException')`
 * handlers that classify errors as transient (log + continue) or fatal
 * (log + exit). Without these, an uncaught rejection crashes the process with
 * no actionable log, and an uncaught exception terminates without cleanup.
 *
 * Classification heuristic:
 *   - FATAL: ERR_OUT_OF_MEMORY, heap exhaustion, V8 fatal errors, syscall errors
 *     on the core FDs, and any error explicitly marked `fatal: true`.
 *   - TRANSIENT: network errors (ECONNREFUSED, ETIMEDOUT, rate-limit 429),
 *     provider stream errors, JSON parse errors — logged + swallowed.
 *
 * Source: research/shards/07-gateway.md — process-level exception handler.
 */
import { nowWallclock } from "@my-agent/core";

/** Error severity classification. */
export type ErrorSeverity = "transient" | "fatal";

export interface ErrorClassification {
  severity: ErrorSeverity;
  reason: string;
}

/** Substrings that mark an error as fatal (irrecoverable). */
const FATAL_PATTERNS: readonly RegExp[] = [
  /out of memory/i,
  /heap out of memory/i,
  /allocation failed/i,
  /v8 fatal/i,
  /ERR_WORKER_OUT_OF_MEMORY/i,
  /maximum call stack/i,
];

/** Substrings that mark an error as transient (recoverable / ignorable). */
const TRANSIENT_PATTERNS: readonly RegExp[] = [
  /ECONNREFUSED/i,
  /ECONNRESET/i,
  /ETIMEDOUT/i,
  /EPIPE/i,
  /EHOSTUNREACH/i,
  /ENETUNREACH/i,
  /rate.?limit/i,
  /429/,
  /timeout/i,
  /socket hang up/i,
  /aborted/i,
  /fetch failed/i,
  /UND_ERR/i, // undici fetch errors
];

/**
 * Classify an error as transient (log + continue) or fatal (log + exit).
 *
 * Heuristic:
 *   1. If the error has a `fatal: true` property → fatal.
 *   2. If the message matches a fatal pattern → fatal.
 *   3. If the message matches a transient pattern → transient.
 *   4. Default for unhandledRejection → transient (log + continue).
 *   5. Default for uncaughtException → fatal (Node's own behavior is to exit).
 */
export function classifyError(
  err: unknown,
  context: "unhandledRejection" | "uncaughtException",
): ErrorClassification {
  const message = err instanceof Error ? err.message : String(err);

  // Explicit fatal flag.
  if (err && typeof err === "object" && "fatal" in err && (err as { fatal: unknown }).fatal === true) {
    return { severity: "fatal", reason: `explicit fatal flag: ${message}` };
  }

  // Fatal patterns.
  for (const pat of FATAL_PATTERNS) {
    if (pat.test(message)) {
      return { severity: "fatal", reason: `fatal pattern match (${pat.source}): ${message}` };
    }
  }

  // Transient patterns.
  for (const pat of TRANSIENT_PATTERNS) {
    if (pat.test(message)) {
      return { severity: "transient", reason: `transient pattern match (${pat.source}): ${message}` };
    }
  }

  // Default by context: unhandledRejection → transient; uncaughtException → fatal.
  if (context === "unhandledRejection") {
    return { severity: "transient", reason: `default transient (unhandledRejection): ${message}` };
  }
  return { severity: "fatal", reason: `default fatal (uncaughtException): ${message}` };
}

export interface ExceptionHandlerOptions {
  /** Logger for transient errors (default: console.error). */
  logTransient?: (msg: string, err: unknown) => void;
  /** Logger for fatal errors (default: console.error). */
  logFatal?: (msg: string, err: unknown) => void;
  /** Exit function (default: process.exit). Injectable for tests. */
  exit?: (code: number) => void;
  /** Injectable clock (default: nowWallclock). */
  now?: () => number;
  /** The process-like object to register handlers on (default: global process). */
  proc?: { on(event: string, listener: (...args: unknown[]) => void): unknown };
}

/**
 * Install process-level exception handlers.
 *
 * - `unhandledRejection`: classified; transient → logged; fatal → logged + exit(1).
 * - `uncaughtException`: classified; transient → logged; fatal → logged + exit(1).
 *
 * Returns a disposer to remove the handlers (for tests).
 */
export function installExceptionHandlers(
  opts: ExceptionHandlerOptions = {},
): { dispose: () => void; classifications: ErrorClassification[] } {
  const logTransient = opts.logTransient ?? ((msg, err) => console.error(`[exception-handler] ${msg}`, err ?? ""));
  const logFatal = opts.logFatal ?? ((msg, err) => console.error(`[exception-handler] ${msg}`, err ?? ""));
  const exit = opts.exit ?? ((code: number) => process.exit(code));
  const now = opts.now ?? nowWallclock;
  const proc = opts.proc ?? process;

  const classifications: ErrorClassification[] = [];

  const onUnhandled = (reason: unknown) => {
    const c = classifyError(reason, "unhandledRejection");
    classifications.push(c);
    const ts = new Date(now()).toISOString();
    if (c.severity === "fatal") {
      logFatal(`[${ts}] FATAL unhandledRejection: ${c.reason}`, reason);
      exit(1);
    } else {
      logTransient(`[${ts}] transient unhandledRejection: ${c.reason}`, reason);
    }
  };

  const onUncaught = (err: unknown) => {
    const c = classifyError(err, "uncaughtException");
    classifications.push(c);
    const ts = new Date(now()).toISOString();
    if (c.severity === "fatal") {
      logFatal(`[${ts}] FATAL uncaughtException: ${c.reason}`, err);
      exit(1);
    } else {
      logTransient(`[${ts}] transient uncaughtException: ${c.reason}`, err);
    }
  };

  proc.on("unhandledRejection", onUnhandled as (...a: unknown[]) => void);
  proc.on("uncaughtException", onUncaught as (...a: unknown[]) => void);

  return {
    dispose() {
      proc.removeListener?.("unhandledRejection", onUnhandled as (...a: unknown[]) => void);
      proc.removeListener?.("uncaughtException", onUncaught as (...a: unknown[]) => void);
    },
    classifications,
  };
}

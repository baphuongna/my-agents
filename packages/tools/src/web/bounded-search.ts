/**
 * bounded-search.ts — Disposable child-process web search with hard deadline.
 *
 * Port of Hermes `_run_ddgs_search_bounded` (deep-dive-r3.md §4 — DDGS worker
 * isolation).
 *
 * PROBLEM: native HTTP clients (e.g. primp/curl, or a blocking native addon in
 * Node) can hold the event loop indefinitely. A `Promise.race` with a timeout
 * cannot fire because the event loop is blocked — the entire process freezes
 * through Ctrl+C/SIGTERM.
 *
 * SOLUTION: each search runs in a disposable child process. The parent spawns
 * the worker, sends a JSON request via stdin, polls stdout with a wall-clock
 * deadline at 100 ms intervals, and SIGTERM → SIGKILL the child on timeout or
 * interrupt.
 *
 * Protocol: JSON over stdin/stdout (see `search-worker.mjs`).
 * Termination: SIGTERM → 1 s grace → SIGKILL, always in `finally`.
 *
 * Constraints: TS strict + noUncheckedIndexedAccess + ESM + verbatimModuleSyntax.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { nowWallclock } from "@my-agent/core";

// ── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 100;
const TERMINATE_GRACE_MS = 1_000;

// ── Types ──────────────────────────────────────────────────────────────────

export interface SearchResult {
  title: string;
  url: string;
  description: string;
  position: number;
}

export interface BoundedSearchResult {
  ok: boolean;
  results?: SearchResult[];
  error?: string;
}

export interface BoundedSearchOptions {
  /** AbortSignal to interrupt the search mid-flight. */
  signal?: AbortSignal;
  /** Absolute path to an ESM module exporting `search(query, limit) → SearchResult[]`. */
  searchModule?: string;
  /** Hard wall-clock deadline in ms (default 30 000). */
  timeoutMs?: number;
}

// ── Error sentinels ────────────────────────────────────────────────────────

/** Thrown when the search exceeds the wall-clock deadline. */
export class SearchTimeoutError extends Error {
  override readonly name = "SearchTimeoutError";
  constructor(timeoutMs: number) {
    super(`Search timed out (${timeoutMs / 1000}s)`);
  }
}

/** Thrown when the search is interrupted via AbortSignal. */
export class SearchInterruptedError extends Error {
  override readonly name = "SearchInterruptedError";
  constructor() {
    super("Search interrupted");
  }
}

// ── Worker path ────────────────────────────────────────────────────────────

/**
 * Resolve the worker script path relative to this module.
 *
 * In tests (vitest) `import.meta.url` points at the source `.ts` file, so the
 * sibling `.mjs` worker is found. After `tsc -b` the compiled `.js` lives in
 * `dist/` — the worker must be copied alongside during bundling (follow-up).
 */
const WORKER_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "search-worker.mjs",
);

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Run a web search in a disposable child process with a hard deadline.
 *
 * The parent never joins the child while it may be inside native code blocking
 * the event loop. Instead it polls a promise with short timeouts and, on
 * timeout/interrupt, terminates the child OS process.
 *
 * @returns The parsed JSON envelope from the worker
 *          (`{ ok: true, results }` or `{ ok: false, error }`).
 * @throws  {SearchTimeoutError} when the deadline is exceeded.
 * @throws  {SearchInterruptedError} when the AbortSignal fires.
 * @throws  {Error} on spawn failure or invalid worker output.
 */
export async function boundedSearch(
  query: string,
  safeLimit: number = 5,
  opts?: BoundedSearchOptions,
): Promise<BoundedSearchResult> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // Build child env: inherit process.env, inject search module path.
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (opts?.searchModule) {
    env.MYA_SEARCH_MODULE = opts.searchModule;
  }

  const proc = spawn(process.execPath, [WORKER_PATH], {
    stdio: ["pipe", "pipe", "ignore"], // stdin=pipe, stdout=pipe, stderr=ignore
    env,
    detached: true, // own process group → clean killpg for grandchild reap
  });

  // Send request and close stdin (EOF signals "request complete" to the worker).
  proc.stdin?.end(JSON.stringify({ query, safeLimit }));

  try {
    return await pollWithDeadline(proc, timeoutMs, opts?.signal);
  } finally {
    await terminateAndReap(proc);
  }
}

// ── Polling ────────────────────────────────────────────────────────────────

/**
 * Wait for the worker to exit, polling for deadline/abort every 100 ms.
 *
 * Resolves with the parsed JSON envelope, or rejects on timeout/interrupt.
 * The `settled` guard prevents double-resolution if the deadline fires in the
 * same tick as the `close` event.
 */
function pollWithDeadline(
  proc: ChildProcess,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<BoundedSearchResult> {
  const deadline = nowWallclock() + timeoutMs;

  return new Promise<BoundedSearchResult>((resolve, reject) => {
    let output = "";
    let settled = false;

    const interval = setInterval(() => {
      if (settled) return;
      if (signal?.aborted) {
        settled = true;
        clearInterval(interval);
        reject(new SearchInterruptedError());
        return;
      }
      if (nowWallclock() >= deadline) {
        settled = true;
        clearInterval(interval);
        reject(new SearchTimeoutError(timeoutMs));
      }
    }, POLL_INTERVAL_MS);

    proc.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });

    proc.on("error", (err: Error) => {
      if (settled) return;
      settled = true;
      clearInterval(interval);
      reject(new Error(`Search worker error: ${err.message}`));
    });

    proc.on("close", (code: number | null) => {
      if (settled) return;
      settled = true;
      clearInterval(interval);
      try {
        resolve(JSON.parse(output) as BoundedSearchResult);
      } catch {
        reject(
          new Error(`Search worker returned invalid output (exit ${code})`),
        );
      }
    });
  });
}

// ── Termination ────────────────────────────────────────────────────────────

/**
 * Terminate the worker process group: SIGTERM → 1 s grace → SIGKILL.
 *
 * Always awaited in the `finally` block — on success the process has already
 * exited and the initial guard returns immediately.
 */
async function terminateAndReap(proc: ChildProcess): Promise<void> {
  if (proc.exitCode !== null || proc.signalCode !== null) return;

  const pid = proc.pid;
  if (!pid) return;

  // SIGTERM the entire process group (detached → child is its own group leader).
  killGroup(pid, "SIGTERM");

  if (await waitForExit(proc, TERMINATE_GRACE_MS)) return;

  // Still alive after grace — escalate to SIGKILL.
  killGroup(pid, "SIGKILL");
  await waitForExit(proc, TERMINATE_GRACE_MS);
}

/**
 * Send a signal to the process group (negative PID), falling back to the
 * process itself (positive PID) if group-kill fails (e.g. Windows).
 */
function killGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal); // negative PID = process group
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // Already dead — best effort.
    }
  }
}

/** Resolve `true` if the process exits within `ms`, `false` on timeout. */
function waitForExit(proc: ChildProcess, ms: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    if (proc.exitCode !== null || proc.signalCode !== null) {
      resolve(true);
      return;
    }
    const timer = setTimeout(() => {
      proc.removeListener("close", onClose);
      resolve(false);
    }, ms);
    const onClose = (): void => {
      clearTimeout(timer);
      resolve(true);
    };
    proc.once("close", onClose);
  });
}

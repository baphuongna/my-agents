/**
 * exec-tempfile.ts — temp-file subprocess executor.
 *
 * Prevents the daemon-fd pipe deadlock (Gotcha #1, agent-browser deep-read —
 * see docs/web-lookup-architecture-deepdive.md "Hard-won gotchas" item #1).
 *
 * THE PROBLEM: CLIs like agent-browser spawn a background daemon that inherits
 * file descriptors. With pipes (child.stdout pipe / capture_output), the daemon
 * holds the pipe write end open after the CLI exits → the read end never sees
 * EOF → DEADLOCK until timeout.
 *
 * THE FIX: redirect stdout/stderr to TEMP FILES via numeric fd in the `stdio`
 * option, then read the files after the process exits. The daemon may still
 * hold the file fd open, but that doesn't block us — we read the file contents
 * regardless of whether the fd is still open elsewhere.
 *
 * §18 compliance: no process.exit() (never exits the host process), minimal
 * core (node builtins only), secret env filtering (SECRET_ENV_RE pattern from
 * builtin.ts filterSecretEnv / F8 fix).
 *
 * Constraints: TS strict + noUncheckedIndexedAccess + ESM; never throws — all
 * failures are returned as {@link ExecResult} with diagnostics in stderr.
 */
import { spawn, type ChildProcess } from "node:child_process";
import {
  mkdtempSync,
  openSync,
  closeSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ─── Public types ───────────────────────────────────────────────────────────

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number | null; // null if killed by signal
  timedOut: boolean;
  signal: NodeJS.Signals | null;
}

export interface ExecOptions {
  timeoutMs?: number; // default 30 000
  env?: Record<string, string>;
  cwd?: string;
  maxBufferBytes?: number; // default 10 MB — fail fast on runaway output
}

// ─── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BUFFER_BYTES = 10 * 1024 * 1024;
const SIGTERM_GRACE_MS = 2_000;
const TMP_PREFIX = "mya-exec-";

/**
 * Matches env-var NAMES that look like secrets. Reused verbatim from
 * builtin.ts (SECRET_ENV_RE / F8 fix). Strip these before passing to a child so
 * prompt-injection can't exfiltrate host credentials via `process.env` snooping.
 */
const SECRET_ENV_RE =
  /(?:^|_)(SECRET|TOKEN|API_?KEY|PASSWORD|PASSWD|CREDENTIAL|PRIVATE_KEY|ACCESS_KEY|AUTH|BEARER|JWT|COOKIE|SIGNING_KEY|ENCRYPTION_KEY|_KEY$)(?:_|$)/i;

// ─── Internal helpers ───────────────────────────────────────────────────────

function filterSecretEnv(env: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (SECRET_ENV_RE.test(k)) continue;
    out[k] = v;
  }
  return out;
}

/** Snapshot process.env as Record<string, string> (drops undefined values). */
function snapshotEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

/** Read a file, returning "" on any error (file may not exist yet). */
function safeRead(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

/** Truncate to maxBytes (byte-faithful; partial UTF-8 → replacement chars). */
function trimToBytes(str: string, maxBytes: number): string {
  if (Buffer.byteLength(str, "utf8") <= maxBytes) return str;
  return Buffer.from(str, "utf8").subarray(0, maxBytes).toString("utf8");
}

// ─── Main function ──────────────────────────────────────────────────────────

/**
 * Spawn a process with stdout/stderr redirected to temp files (NOT pipes),
 * then read the files after exit. Solves the daemon-fd deadlock.
 *
 * Behaviour:
 * - stdio is `['ignore', stdoutFileFd, stderrFileFd]` — no pipes.
 * - After spawn, the parent closes its copies of the fds (child inherited its
 *   own via the OS fork/exec).
 * - Waits for the `'close'` event (process exited + stdio closed).
 * - On timeout: SIGTERM → 2 s grace → SIGKILL.
 * - Temp dir + files are cleaned up in a `finally` block — never leak.
 * - Secret-looking env vars are stripped before passing to the child.
 * - Never throws; all errors become ExecResult diagnostics.
 */
export async function execTempfile(
  command: string,
  args: string[],
  opts?: ExecOptions,
): Promise<ExecResult> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBufferBytes = opts?.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES;

  let tmpDir: string | null = null;
  let stdoutFd: number | null = null;
  let stderrFd: number | null = null;
  let stdoutPath = "";
  let stderrPath = "";
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  let graceHandle: ReturnType<typeof setTimeout> | null = null;
  let timedOut = false;

  try {
    // ── Create temp dir + output files ──────────────────────────────────
    tmpDir = mkdtempSync(join(tmpdir(), TMP_PREFIX));
    stdoutPath = join(tmpDir, "stdout");
    stderrPath = join(tmpDir, "stderr");
    stdoutFd = openSync(stdoutPath, "w");
    stderrFd = openSync(stderrPath, "w");

    // ── Build env: filtered process.env + filtered caller overlay ─────────
    const env: Record<string, string> = {
      ...filterSecretEnv(snapshotEnv()),
      ...(opts?.env ? filterSecretEnv(opts.env) : {}),
    };

    // ── Spawn with file-fd stdio (NOT pipes) ────────────────────────────
    const child: ChildProcess = spawn(command, args, {
      stdio: ["ignore", stdoutFd, stderrFd],
      env,
      ...(opts?.cwd !== undefined ? { cwd: opts.cwd } : {}),
    });

    // Close parent's fd copies — the child inherited its own via spawn.
    // This prevents fd leaks in the parent; the child can still write.
    closeSync(stdoutFd);
    stdoutFd = null;
    closeSync(stderrFd);
    stderrFd = null;

    // ── Wait for exit or timeout ────────────────────────────────────────
    const exitInfo: { code: number | null; signal: NodeJS.Signals | null } = {
      code: null,
      signal: null,
    };
    let spawnError: string | null = null;

    await new Promise<void>((resolve) => {
      let settled = false;

      const done = (): void => {
        if (settled) return;
        settled = true;
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
          timeoutHandle = null;
        }
        if (graceHandle) {
          clearTimeout(graceHandle);
          graceHandle = null;
        }
        resolve();
      };

      // 'close' fires after the process exits AND its stdio fds are closed.
      // With file-based fds (no pipes) this happens immediately on exit —
      // the daemon fd deadlock does NOT apply.
      child.on("close", (code, signal) => {
        exitInfo.code = code;
        exitInfo.signal = signal;
        done();
      });

      // 'error' fires on spawn failure (e.g. ENOENT). 'close' may also fire
      // afterward; done() is idempotent so order doesn't matter.
      child.on("error", (e) => {
        spawnError = e.message;
        done();
      });

      // ── Timeout: SIGTERM → 2 s grace → SIGKILL ─────────────────────────
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        try {
          child.kill("SIGTERM");
        } catch {
          /* already dead */
        }
        graceHandle = setTimeout(() => {
          try {
            child.kill("SIGKILL");
          } catch {
            /* already dead */
          }
        }, SIGTERM_GRACE_MS);
      }, timeoutMs);
    });

    // ── Read output from temp files ─────────────────────────────────────
    const stdout = trimToBytes(safeRead(stdoutPath), maxBufferBytes);
    const stderr = trimToBytes(safeRead(stderrPath), maxBufferBytes);

    return {
      stdout,
      stderr: spawnError ?? stderr,
      // On spawn failure (e.g. ENOENT) some platforms report a negative
      // exit code from the 'close' event. Since the process never actually
      // ran, normalise to null so callers can treat it uniformly.
      exitCode: spawnError ? null : exitInfo.code,
      timedOut,
      signal: spawnError ? null : exitInfo.signal,
    };
  } catch (e) {
    return {
      stdout: "",
      stderr: e instanceof Error ? e.message : String(e),
      exitCode: null,
      timedOut: false,
      signal: null,
    };
  } finally {
    // ── Cleanup: temp files + timers must never leak ──────────────────────
    if (timeoutHandle) clearTimeout(timeoutHandle);
    if (graceHandle) clearTimeout(graceHandle);
    if (stdoutFd !== null) {
      try {
        closeSync(stdoutFd);
      } catch {
        /* already closed */
      }
    }
    if (stderrFd !== null) {
      try {
        closeSync(stderrFd);
      } catch {
        /* already closed */
      }
    }
    if (tmpDir !== null) {
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        /* best-effort cleanup */
      }
    }
  }
}

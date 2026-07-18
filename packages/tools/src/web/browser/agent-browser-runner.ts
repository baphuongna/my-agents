/**
 * agent-browser-runner.ts — Single dispatcher wrapping the agent-browser CLI.
 *
 * Implements the wrap template from docs/web-lookup-architecture-deepdive.md:
 *
 * ```
 * agent-browser [--session <name> | --cdp <ws_url>] [--engine chrome|lightpanda]
 *               --json <command> [args]
 *   commands: open <url>, snapshot [-c], click <ref>, type <ref> <text>,
 *             scroll up|down, back, press <key>, screenshot, console
 *   --json → { success, data: { snapshot, refs, title, url, ... } }
 * ```
 *
 * **Gotcha #1:** wraps `execTempfile()` from `../exec-tempfile.js` — temp-file
 * stdout/stderr, NOT pipes. The agent-browser daemon inherits fds; with pipes
 * the daemon holds the write end open after the CLI exits → deadlock until
 * timeout. Temp files avoid this entirely.
 *
 * **Gotcha #5:** `--session` XOR `--cdp` enforcement — `--session` creates a
 * local browser and silently ignores `--cdp`. Cloud mode MUST use `--cdp` alone.
 *
 * Never throws — all errors become typed {@link AgentBrowserResult} objects.
 *
 * Constraints: TS strict + noUncheckedIndexedAccess + ESM; never throws.
 */
import { execTempfile } from "../exec-tempfile.js";
import {
  resolveAgentBrowserBinary,
  type BrowserSession,
} from "./session.js";

// ─── Types ──────────────────────────────────────────────────────────────────

/** The `--json` output data shape from agent-browser. */
export interface AgentBrowserData {
  /** Aria-tree snapshot text (with @eN refs) from `snapshot`. */
  snapshot?: string;
  /** Page title (from `open`). */
  title?: string;
  /** Final URL after redirects (from `open`). */
  url?: string;
  /** Structured element refs (if provided). */
  refs?: unknown[];
  /** Base64-encoded screenshot (from `screenshot`). */
  screenshot?: string;
  [key: string]: unknown;
}

/** Structured result — the runner's return type. Never accompanied by a throw. */
export interface AgentBrowserResult {
  /** Whether the command completed and JSON parsed successfully. */
  ok: boolean;
  /** Whether agent-browser reported `success: true` in its JSON output. */
  success: boolean;
  /** Parsed data from `--json` output (present when `ok === true`). */
  data?: AgentBrowserData;
  /** Error message (spawn failure, JSON parse error, command failure). */
  error?: string;
  /** Raw stderr for diagnostics. */
  stderr?: string;
  /** Process exit code (`null` on spawn failure or signal kill). */
  exitCode: number | null;
  /** Whether the command timed out. */
  timedOut: boolean;
}

export type BrowserEngineName = "chrome" | "lightpanda";

export interface RunBrowserOptions {
  /**
   * Session to use (`--session` mode).
   * Mutually exclusive with `cdpUrl` (Gotcha #5).
   */
  session?: BrowserSession;
  /**
   * CDP WebSocket URL for cloud mode (`--cdp` mode).
   * Mutually exclusive with `session` (Gotcha #5).
   */
  cdpUrl?: string;
  /** Engine override: `chrome` or `lightpanda`. */
  engine?: BrowserEngineName;
  /** Command timeout in ms. Default: 60 000. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 60_000;

// ─── Command builder ────────────────────────────────────────────────────────

/** Result of building agent-browser argv. */
export type BuildArgsResult =
  | { ok: true; args: string[] }
  | { ok: false; error: string };

/**
 * Build the argv for an agent-browser invocation.
 *
 * **Gotcha #5:** `--session` and `--cdp` are mutually exclusive. In
 * agent-browser >=0.13, `--session` creates a local browser and **silently
 * ignores `--cdp`**. Cloud mode MUST use `--cdp` alone.
 */
export function buildCommandArgs(
  command: string,
  commandArgs: readonly string[],
  opts: RunBrowserOptions,
): BuildArgsResult {
  // --session XOR --cdp enforcement (Gotcha #5).
  if (opts.cdpUrl && opts.session) {
    return {
      ok: false,
      error:
        "--session and --cdp are mutually exclusive (Gotcha #5: --session creates a local browser and silently ignores --cdp)",
    };
  }
  if (!opts.cdpUrl && !opts.session) {
    return {
      ok: false,
      error: "either --session or --cdp must be specified",
    };
  }

  const args: string[] = [];

  // Connection mode (exactly one).
  if (opts.cdpUrl) {
    args.push("--cdp", opts.cdpUrl);
  } else if (opts.session) {
    args.push("--session", opts.session.sessionName);
  }

  // Engine override.
  if (opts.engine) {
    args.push("--engine", opts.engine);
  }

  // Structured JSON output.
  args.push("--json");

  // Command + positional args.
  args.push(command, ...commandArgs);

  return { ok: true, args };
}

// ─── Main dispatcher ────────────────────────────────────────────────────────

/**
 * Run an agent-browser command via {@link execTempfile} (Gotcha #1: temp-file
 * stdout/stderr, NOT pipes). Parses `--json` output.
 *
 * Never throws — all errors (spawn failure, timeout, JSON parse error,
 * command failure) become typed {@link AgentBrowserResult} objects.
 */
export async function runBrowserCommand(
  command: string,
  commandArgs: readonly string[] = [],
  opts: RunBrowserOptions = {},
): Promise<AgentBrowserResult> {
  // ── 1. Resolve binary ──────────────────────────────────────────────────
  const binary = resolveAgentBrowserBinary();
  if (!binary) {
    return {
      ok: false,
      success: false,
      error:
        "agent-browser binary not found and npx unavailable. Install: npm install agent-browser && npx agent-browser install --with-deps",
      exitCode: null,
      timedOut: false,
    };
  }

  // ── 2. Build command args ──────────────────────────────────────────────
  const built = buildCommandArgs(command, commandArgs, opts);
  if (!built.ok) {
    return {
      ok: false,
      success: false,
      error: built.error,
      exitCode: null,
      timedOut: false,
    };
  }
  const fullArgs = [...binary.baseArgs, ...built.args];

  // ── 3. Build env: merge session env ────────────────────────────────────
  const env: Record<string, string> = {};
  if (opts.session) {
    Object.assign(env, opts.session.env);
  }

  // ── 4. Execute via temp-file stdio (Gotcha #1) ──────────────────────────
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const exec = await execTempfile(binary.command, fullArgs, {
    timeoutMs,
    env,
  });

  // ── 5. Handle spawn failure ────────────────────────────────────────────
  if (exec.exitCode === null && !exec.timedOut) {
    return {
      ok: false,
      success: false,
      error: `failed to execute agent-browser: ${exec.stderr}`,
      stderr: exec.stderr,
      exitCode: null,
      timedOut: false,
    };
  }

  // ── 6. Handle timeout ──────────────────────────────────────────────────
  if (exec.timedOut) {
    return {
      ok: false,
      success: false,
      error: `agent-browser command timed out after ${timeoutMs}ms`,
      stderr: exec.stderr,
      exitCode: exec.exitCode,
      timedOut: true,
    };
  }

  // ── 7. Parse --json output ─────────────────────────────────────────────
  const trimmed = exec.stdout.trim();
  if (!trimmed) {
    return {
      ok: false,
      success: false,
      error: "agent-browser produced empty output",
      stderr: exec.stderr,
      exitCode: exec.exitCode,
      timedOut: false,
    };
  }

  let parsed: { success?: boolean; data?: AgentBrowserData; error?: string };
  try {
    parsed = JSON.parse(trimmed) as {
      success?: boolean;
      data?: AgentBrowserData;
      error?: string;
    };
  } catch {
    return {
      ok: false,
      success: false,
      error: `failed to parse agent-browser JSON output: ${trimmed.slice(0, 200)}`,
      stderr: exec.stderr,
      exitCode: exec.exitCode,
      timedOut: false,
    };
  }

  if (parsed.success !== true) {
    return {
      ok: false,
      success: false,
      error: parsed.error ?? `agent-browser command '${command}' failed`,
      stderr: exec.stderr,
      exitCode: exec.exitCode,
      timedOut: false,
    };
  }

  return {
    ok: true,
    success: true,
    data: parsed.data,
    stderr: exec.stderr,
    exitCode: exec.exitCode,
    timedOut: false,
  };
}

/**
 * session.ts — Per-task browser session management.
 *
 * Handles the four infrastructure gotchas from the agent-browser deep-read
 * (see docs/web-lookup-architecture-deepdive.md "Hard-won gotchas"):
 *
 *   #2  Per-task socket dir (`AGENT_BROWSER_SOCKET_DIR`) — parallel workers
 *       fight over the default socket path without it.
 *   #3  Daemon idle-kill (`AGENT_BROWSER_IDLE_TIMEOUT_MS`) — daemon kills
 *       itself + Chrome children after the idle window.
 *   #4  `--no-sandbox` auto-inject (`AGENT_BROWSER_ARGS`) when root OR
 *       Ubuntu 23.10+/AppArmor (unprivileged userns restricted).
 *   #6  Binary discovery + fail-fast — locate `agent-browser` (local,
 *       global, or npx); actionable error if not found.
 *
 * Constraints: TS strict + noUncheckedIndexedAccess + ESM; node builtins only.
 */
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// ─── Binary discovery (Gotcha #6) ───────────────────────────────────────────

export interface BinaryResolution {
  /** The command to execute (e.g. "agent-browser", "/path/to/agent-browser", "npx"). */
  command: string;
  /** Extra args prepended before the agent-browser flags (e.g. ["agent-browser"] for npx). */
  baseArgs: string[];
  /** True if the binary was found locally without needing a network download. */
  local: boolean;
}

/** Check whether a command is available on PATH. Quick, no network. */
function isOnPath(cmd: string): boolean {
  try {
    execFileSync("which", [cmd], { stdio: "ignore", timeout: 2_000 });
    return true;
  } catch {
    return false;
  }
}

/** Walk up from this module to find `node_modules/.bin/agent-browser`. */
function findLocalInstall(): string | null {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i++) {
    const candidate = join(dir, "node_modules", ".bin", "agent-browser");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Resolve the agent-browser binary.
 *
 * Priority: local `node_modules/.bin/agent-browser` → global PATH → `npx`
 * fallback. Returns `null` only if not even `npx` is available.
 *
 * **Fail-fast (Gotcha #6):** callers should check `isBinaryLocal()` before
 * relying on the result; the npx fallback may require a network download
 * on first invocation.
 */
export function resolveAgentBrowserBinary(): BinaryResolution | null {
  // 1. Local install (node_modules/.bin/agent-browser)
  const local = findLocalInstall();
  if (local) return { command: local, baseArgs: [], local: true };

  // 2. Global PATH
  if (isOnPath("agent-browser")) {
    return { command: "agent-browser", baseArgs: [], local: true };
  }

  // 3. npx fallback (may download on first run)
  if (isOnPath("npx")) {
    return { command: "npx", baseArgs: ["agent-browser"], local: false };
  }

  return null;
}

/**
 * Cheap probe: is the agent-browser binary available **locally** (no network)?
 * Used by `engine-resolver.isLocalAvailable()`.
 */
export function isBinaryLocal(): boolean {
  return findLocalInstall() !== null || isOnPath("agent-browser");
}

// ─── --no-sandbox detection (Gotcha #4) ─────────────────────────────────────

export interface OsInfo {
  /** Distribution id from /etc/os-release (e.g. "ubuntu"). */
  id?: string;
  /** Version id from /etc/os-release (e.g. "23.10"). */
  versionId?: string;
  /** Whether AppArmor is loaded (/sys/module/apparmor exists). */
  apparmor?: boolean;
}

/** Read /etc/os-release for distribution info (best-effort). */
function readOsInfo(): OsInfo {
  let id: string | undefined;
  let versionId: string | undefined;
  try {
    const content = readFileSync("/etc/os-release", "utf8");
    for (const line of content.split("\n")) {
      if (line.startsWith("ID=")) id = line.slice(3).replace(/["']/g, "").trim();
      if (line.startsWith("VERSION_ID=")) versionId = line.slice(11).replace(/["']/g, "").trim();
    }
  } catch {
    // Not Linux or no /etc/os-release — not an error.
  }
  const apparmor = existsSync("/sys/module/apparmor");
  return { id, versionId, apparmor };
}

/**
 * Pure function: decide whether `--no-sandbox` should be injected given the
 * uid and OS info. Exported for unit testing.
 *
 * Chromium refuses to start as root or on Ubuntu 23.10+/AppArmor (unprivileged
 * userns restricted) without `--no-sandbox` (Chromium issue #15765).
 */
export function shouldInjectNoSandbox(
  uid: number | undefined,
  os: OsInfo,
): boolean {
  // Running as root → always inject.
  if (uid !== undefined && uid === 0) return true;

  // Ubuntu 23.10+ (unprivileged userns restricted).
  if (os.id === "ubuntu" && os.versionId) {
    const parts = os.versionId.split(".").map(Number);
    const major = parts[0] ?? 0;
    const minor = parts[1] ?? 0;
    // 23.10 or later (23.04 = 23,4 < 23,10; 24.04 = 24,4 > 23)
    if (major > 23 || (major === 23 && minor >= 10)) return true;
  }

  // AppArmor present.
  if (os.apparmor) return true;

  return false;
}

/** Impure wrapper: reads actual system state and delegates to the pure check. */
export function needsNoSandbox(): boolean {
  const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
  return shouldInjectNoSandbox(uid, readOsInfo());
}

/** Build the `AGENT_BROWSER_ARGS` value for --no-sandbox injection. */
export function buildNoSandboxArgs(): string {
  return "--no-sandbox,--disable-dev-shm-usage";
}

// ─── Session lifecycle ──────────────────────────────────────────────────────

export interface BrowserSessionOptions {
  /** Unique task id; used to derive a per-task socket dir (Gotcha #2). */
  taskId: string;
  /** Override the socket dir (testing). If omitted, a per-task temp dir is derived. */
  socketDir?: string;
  /** Override the daemon idle-kill timeout in ms (Gotcha #3). Default: 300 000 (5 min). */
  idleTimeoutMs?: number;
}

export interface BrowserSession {
  /** Session name used as `--session <name>`. */
  sessionName: string;
  /** Per-task socket directory (`AGENT_BROWSER_SOCKET_DIR`). */
  socketDir: string;
  /** Environment variables for the runner (socket dir, idle-kill, --no-sandbox). */
  env: Record<string, string>;
  /** Task id this session belongs to. */
  taskId: string;
}

const DEFAULT_IDLE_TIMEOUT_MS = 300_000; // 5 minutes

/**
 * Create a per-task browser session with its own socket dir (Gotcha #2),
 * daemon idle-kill env (Gotcha #3), and `--no-sandbox` auto-inject (Gotcha #4).
 *
 * Creates the socket directory on disk (mkdirSync recursive). Pair with
 * {@link closeBrowserSession} for cleanup.
 */
export function createBrowserSession(opts: BrowserSessionOptions): BrowserSession {
  // Sanitize taskId to prevent path traversal in the socket dir path.
  const rawTaskId = opts.taskId || "default";
  const taskId = rawTaskId.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 64) || "default";
  const sessionName = `mya-${taskId}`;

  // Per-task socket dir (Gotcha #2): each parallel worker gets its own dir.
  const socketDir =
    opts.socketDir ?? join(tmpdir(), `mya-browser-${taskId}-${process.pid}`);
  mkdirSync(socketDir, { recursive: true });

  // Idle-kill (Gotcha #3): daemon self-kills after the idle window.
  const idleTimeoutMs = (opts.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS).toString();

  // Build env for the runner.
  const env: Record<string, string> = {
    AGENT_BROWSER_SOCKET_DIR: socketDir,
    AGENT_BROWSER_IDLE_TIMEOUT_MS: idleTimeoutMs,
  };

  // --no-sandbox auto-inject (Gotcha #4).
  if (needsNoSandbox()) {
    env.AGENT_BROWSER_ARGS = buildNoSandboxArgs();
  }

  return { sessionName, socketDir, env, taskId };
}

/**
 * Clean up a browser session (remove the socket dir).
 * Best-effort — never throws.
 */
export function closeBrowserSession(session: BrowserSession): void {
  try {
    rmSync(session.socketDir, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup.
  }
}

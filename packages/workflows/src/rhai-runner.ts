/**
 * Rhai script runner (§25 / Gap 4) — embedded scripting MVP.
 *
 * Uses node:vm with a restricted context (same model as runner.ts).
 * Rhai via WASM is Tier-2; this MVP evaluates JavaScript in a sandboxed
 * vm context. The same SECURITY caveat applies: node:vm is NOT a security
 * boundary (see runner.ts header). Workflows run with full process privilege.
 *
 * Registered API available inside scripts:
 *   read_file(path)           — read a workspace-scoped file → string
 *   write_file(path, content) — write within workspace (permission-checked)
 *   http_get(url)             — fetch a URL (optional domain allowlist) → string
 *   log(level, msg)           — emit a log event (info|warn|error)
 *   emit_event(kind, payload) — emit a structured event
 *
 * Source: §25; GAP-IMPLEMENTATION-PLAN.md Gap 4.
 */
import { runInNewContext, type Context } from "node:vm";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, normalize, sep, isAbsolute } from "node:path";
import { nativeEvalRhai } from "@my-agent/natives";

/** An event emitted during script execution (log or custom). */
export interface RhaiEvent {
  kind: string;
  level?: string;
  message?: string;
  payload?: unknown;
}

/** Result of evalRhai: the script's return value + collected events. */
export interface RhaiResult {
  value: unknown;
  events: RhaiEvent[];
}

export interface RhaiOptions {
  /** Workspace root for file-path scoping. Defaults to process.cwd(). */
  workspace?: string;
  /** Execution timeout in ms. Defaults to 30_000. */
  timeoutMs?: number;
  /** Allowed domains for http_get (empty = allow all). */
  allowedDomains?: string[];
}

/** Safe globals exposed to the sandboxed script. */
const SAFE_GLOBALS: Record<string, unknown> = {
  Math, JSON, Date, Object, Array, Map, Set, Promise, Symbol,
  String, Number, Boolean, Error, parseInt, parseFloat, isNaN,
};

/**
 * Lexical workspace-bound resolver (reimplemented inline — workflows depends
 * on core only, not tools). Mirrors resolveInsideWorkspace from path-safety.ts.
 * Rejects `..` traversal + absolute escapes.
 */
function resolveInWorkspace(path: string, workspace: string): string {
  const ws = resolve(workspace);
  const abs = resolve(ws, path);
  const rel = normalize(abs.slice(ws.length)).split(sep).join("/");
  if (isAbsolute(path) && !abs.startsWith(ws)) {
    throw new Error(`absolute path escapes workspace: ${path}`);
  }
  if (rel.startsWith("../") || rel === ".." || rel.includes("/../")) {
    throw new Error(`path traverses outside workspace: ${path}`);
  }
  if (abs !== ws && !abs.startsWith(ws + sep) && !abs.startsWith(ws + "/")) {
    throw new Error(`resolved outside workspace: ${abs}`);
  }
  return abs;
}

/**
 * Evaluate a script in a sandboxed vm context with the registered API.
 * The script is wrapped in an async IIFE so `await` is supported.
 * Returns the script's return value + collected events.
 *
 * This is the "rhai" step handler (§25) — call from a workflow runner to
 * execute inline scripting steps alongside the existing "js" module runner.
 */
export async function evalRhai(
  script: string,
  context: Record<string, unknown>,
  opts: RhaiOptions = {},
): Promise<RhaiResult> {
  // Try native Rust Rhai engine first (sandboxed, no I/O). Only handles scripts
  // that use log/emit_event + pure computation. Returns null if unavailable or
  // if the script uses unregistered functions → falls through to node:vm.
  const nativeResult = nativeEvalRhai(script, context);
  if (nativeResult !== null) {
    return {
      value: nativeResult.value,
      events: nativeResult.events as RhaiEvent[],
    };
  }

  // Fall back to node:vm for scripts needing read_file/write_file/http_get
  // or when the native binary is not present.
  const workspace = opts.workspace ?? process.cwd();
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const allowedDomains = opts.allowedDomains ?? [];
  const events: RhaiEvent[] = [];

  // Registered API (workspace-scoped; pi-model: trusted code, full privilege).
  const api: Record<string, unknown> = {
    read_file: async (path: string): Promise<string> => {
      const abs = resolveInWorkspace(path, workspace);
      return readFile(abs, "utf8");
    },
    write_file: async (path: string, content: string): Promise<void> => {
      const abs = resolveInWorkspace(path, workspace);
      await writeFile(abs, content, "utf8");
    },
    http_get: async (url: string): Promise<string> => {
      if (allowedDomains.length > 0) {
        let host = "";
        try { host = new URL(url).hostname; } catch { /* invalid url */ }
        if (!allowedDomains.includes(host)) {
          throw new Error(`domain not in allowlist: ${host || url}`);
        }
      }
      const res = await fetch(url);
      return res.text();
    },
    log: (level: string, msg: string): void => {
      events.push({ kind: "log", level, message: String(msg) });
    },
    emit_event: (kind: string, payload?: unknown): void => {
      events.push({ kind: String(kind), payload });
    },
  };

  const sandbox: Context = { ...SAFE_GLOBALS, ...api, ...context };

  let value: unknown;
  try {
    const wrapped = `(async () => {\n${script}\n})()`;
    const promise = runInNewContext(wrapped, sandbox, {
      timeout: timeoutMs,
      filename: "rhai-eval",
    });
    // Wrap with an async timeout — vm timeout only covers the sync phase.
    value = await Promise.race([
      Promise.resolve(promise),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`rhai script timed out after ${timeoutMs}ms`)),
          timeoutMs,
        ),
      ),
    ]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    events.push({ kind: "error", level: "error", message: msg });
    value = undefined;
  }

  return { value, events: [...events] };
}

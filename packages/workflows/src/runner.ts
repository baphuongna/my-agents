/**
 * Sandboxed workflow runner (§25).
 *
 * A workflow is a JS file exporting a default async function:
 *   `export default async function(ctx) { ... ctx.tools, ctx.session, ctx.input ... }`
 *
 * Runs via Node's `vm.runInNewContext` in a RESTRICTED sandbox (only the
 * exposed API + safe globals). NO access to Node fs/child_process/process
 * unless explicitly granted (the §17 ExtensionAPI pattern: no fs/net/child_process).
 *
 * Use cases: cron jobs (§12.3), SOP scripts (skill-driven), reusable
 * workflows declared by packages.
 *
 * Source: §25 Embedded scripting (language TBD per §23 #2 — Tier 2 uses JS via
 * Node's `vm`; a Rhai WASM alternative is a future swap).
 */
import { runInNewContext, type Context } from "node:vm";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { ProviderProfile, RuntimeEvent, ToolExecutor } from "@my-agent/core";

/** Safe globals exposed to the sandboxed script. */
const SAFE_GLOBALS: Record<string, unknown> = {
  Math,
  JSON,
  Date,
  Object,
  Array,
  Map,
  Set,
  Promise,
  Symbol,
  String,
  Number,
  Boolean,
  Error,
};

const stringify = (v: unknown): string => {
  try { return JSON.stringify(v); } catch { return String(v); }
};

/** The context object passed to a workflow script. */
export interface WorkflowContext {
  /** Input passed by the caller (cron/SOP/skill). */
  input: unknown;
  /** Tool executor (the workflow can call agent tools via the sandbox API). */
  tools: ToolExecutor;
  /** Provider (auxiliary; for sub-queries — invariant #8: separate alloc). */
  provider: ProviderProfile;
  /** Optional session snapshot (read-only projection). */
  session: { id: string; cwd: string };
}

/** Per-call event sink (R42: was module-level → concurrent calls cross-contaminated). */
interface EventSink { events: RuntimeEvent[]; emit(e: RuntimeEvent): void }

/** Build a per-call sink + return the matching console surface. */
function makeSink(): { sink: EventSink; console: typeof SAFE_GLOBALS.console } {
  const events: RuntimeEvent[] = [];
  const emit = (e: RuntimeEvent) => { events.push(e); };
  const consoleSurface = {
    log: (...a: unknown[]) => emit({ kind: "log", level: "info", message: a.map(stringify).join(" ") }),
    info: (...a: unknown[]) => emit({ kind: "log", level: "info", message: a.map(stringify).join(" ") }),
    warn: (...a: unknown[]) => emit({ kind: "log", level: "warn", message: a.map(stringify).join(" ") }),
    error: (...a: unknown[]) => emit({ kind: "log", level: "error", message: a.map(stringify).join(" ") }),
  };
  return { sink: { events, emit }, console: consoleSurface };
}

/** Load + execute a workflow file in the sandbox. */
export async function runWorkflow(
  filePath: string,
  context: WorkflowContext,
  opts: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<RuntimeEvent[]> {
  const { sink, console: sandboxConsole } = makeSink();
  const emit = sink.emit;
  const source = await readFile(filePath, "utf8");

  // The sandbox receives ONLY the exposed API — no fs/net/child_process/require.
  const sandbox: Context = {
    ...SAFE_GLOBALS,
    console: sandboxConsole,
    ctx: Object.freeze({
      input: Object.freeze(context.input),
      tools: context.tools,
      provider: context.provider,
      session: Object.freeze({ ...context.session }),
    }),
    // No `require`, `process`, `globalThis`, `Buffer` — keep the surface tight.
  };

  // We compile to a script that:
  //  1. runs the user source (which sets module.exports.default = async (ctx) => ...),
  //  2. CALLS that function INSIDE the sandbox with the (frozen) globalThis.__ctx__,
  //     so the workflow body itself is sandboxed (no require/process/fs leak).
  //  3. resolves the returned promise and assigns the result to a global, which we read back.
  // The return value of the whole IIFE is the awaited result (await via a
  // sentinel + while-poll would be uglier; vm supports top-level await via an
  // async IIFE that we then bridge with a synchronous "return value via global").
  // Simpler: call entry, then bridge the promise via a deferred global.
  const wrapped = `(function(){
    var module={exports:{}};
    ${source}
    if (typeof module.exports.default !== 'function') throw new Error('workflow must export module.exports.default = async (ctx) => ...');
    // Return a sentinel: a function that, when called with a resolver callback,
    // runs the workflow inside this (sandboxed) scope with the FROZEN global
    // ctx and invokes the callback with the resolved value. R42: the workflow
    // BODY runs inside the sandbox (no require/process/fs leak), not just the setup.
    return function __runInsideSandbox(cb) {
      try {
        Promise.resolve(module.exports.default(ctx))
          .then((v) => cb(null, v), (e) => cb(e instanceof Error ? e : new Error(String(e))));
      } catch (e) {
        cb(e instanceof Error ? e : new Error(String(e)));
      }
    };
  })()`;
  const timeoutMs = opts.timeoutMs ?? 30_000;

  let runner: (cb: (err: Error | null, val?: unknown) => void) => void;
  try {
    runner = runInNewContext(wrapped, sandbox, { filename: basename(filePath), timeout: timeoutMs });
  } catch (e) {
    emit({ kind: "log", level: "error", message: `workflow compile failed: ${(e as Error).message}` });
    return [...sink.events];
  }
  if (typeof runner !== "function") {
    emit({ kind: "log", level: "error", message: `workflow must export module.exports.default` });
    return [...sink.events];
  }

  // Run the workflow inside the sandbox via the returned bridge function, with timeout.
  // The bridge uses a Node-level callback so we don't depend on the sandboxed promise.
  let entryResult: unknown;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    entryResult = await new Promise<unknown>((resolve, reject) => {
      const timeoutErr = new Error(`workflow timed out after ${timeoutMs}ms`);
      timer = setTimeout(() => reject(timeoutErr), timeoutMs);
      try {
        runner((err, val) => {
          if (timer !== undefined) clearTimeout(timer);
          if (err) reject(err); else resolve(val);
        });
      } catch (e) {
        if (timer !== undefined) clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
    emit({ kind: "log", level: "info", message: `workflow completed: ${stringify(entryResult)}` });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    emit({ kind: "log", level: "error", message: `workflow execution failed: ${msg}` });
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
  return [...sink.events];
}
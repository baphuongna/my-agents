/**
 * Workflow runner (§25).
 *
 * A workflow is a JS file exporting a default async function:
 *   `export default async function(ctx) { ... ctx.tools, ctx.session, ctx.input ... }`
 *
 * ⚠ SECURITY MODEL (CRITICAL-1 security-audit fix): Node's `vm` module is NOT a
 * security boundary (nodejs.org/api/vm.html). The `vm.runInNewContext` sandbox
 * is escapeable via the prototype chain of any leaked outer-realm constructor
 * (e.g. `Promise.constructor.constructor('return this')()` yields the outer
 * global → process/require/child_process). Per the agent's pi-model (AGENTS.md:
 * NO OS sandbox, the agent runs in the user's environment with their privileges),
 * workflows run with FULL PROCESS PRIVILEGE — exactly like any agent tool/code.
 * The vm provides state isolation for the workflow's own variables + a timeout/
 * event-surface contract, NOT containment. Do NOT run untrusted workflows under
 * the illusion of containment; for semi-trusted workflows use isolated-vm (a
 * separate V8 isolate, no shared object graph) or a worker_threads/subprocess.
 *
 * Use cases: cron jobs (§12.3), SOP scripts (skill-driven), reusable workflows
 * declared by packages — all TRUSTED author code (same trust as a tool).
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

/**
 * HIGH-4 fix: run a workflow in a worker_thread so a timeout can actually KILL
 * the async body (worker.terminate()). The vm runner above only rejects on
 * timeout — an infinite `while(true){ await Promise.resolve() }` survives. This
 * variant proxies ctx.tools over parentPort + terminates the worker on timeout.
 * Use this for any workflow that isn't fully trusted (user-authored cron/SOP).
 */
export async function runWorkflowIsolated(
  filePath: string,
  context: WorkflowContext,
  opts: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<RuntimeEvent[]> {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const events: RuntimeEvent[] = [];
  const log = (level: "info" | "warn" | "error", message: string) =>
    events.push({ kind: "log", level, message });

  const Worker = (await import("node:worker_threads")).Worker;
  const worker = new Worker(new URL("./worker.js", import.meta.url), {
    workerData: { filePath, input: context.input, session: { ...context.session }, timeoutMs },
  });
  const pendingTools = new Map<number, (r: unknown) => void>();
  worker.on("message", async (msg: { type: string; id?: number; calls?: unknown; result?: unknown; error?: string; message?: string }) => {
    if (msg.type === "tool" && typeof msg.id === "number") {
      // execute in the parent (the trusted ToolExecutor) + reply
      try {
        const result = await context.tools.execute(msg.calls as import("@my-agent/core").ToolCall[], {
          session: context.session as never,
          history: { append() {} } as never,
          budget: { spend() { return true; }, remaining() { return 1; }, exhausted() { return false; } } as never,
          approval: { async request() { return { decision: "Deny" as const, reason: "workflow" }; } } as never,
          emit() {},
        });
        worker.postMessage({ type: "tool-result", id: msg.id, result });
      } catch (e) {
        worker.postMessage({ type: "provider-error", id: msg.id, error: e instanceof Error ? e.message : String(e) });
      }
    } else if (msg.type === "done") {
      log("info", "workflow completed");
    } else if (msg.type === "error") {
      log("error", `workflow failed: ${msg.error ?? "unknown"}`);
    }
  });

  const done = new Promise<void>((resolve) => worker.on("exit", () => resolve()));
  const timeout = new Promise<void>((resolve) => setTimeout(() => {
    log("warn", `workflow timed out after ${timeoutMs}ms — terminating worker`);
    worker.terminate();
    resolve();
  }, timeoutMs));
  if (opts.signal) opts.signal.addEventListener("abort", () => worker.terminate(), { once: true });
  await Promise.race([done, timeout]);
  try { worker.terminate(); } catch { /* already exited */ }
  return events;
}
/**
 * C-7 fix: Run a Rhai-script workflow file (Gap 4 inline scripting).
 * Reads the .rhai file and evaluates it via evalRhai() with the workflow context.
 */
export async function runRhaiWorkflow(
  filePath: string,
  context: WorkflowContext,
  opts: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<import("./rhai-runner.js").RhaiResult> {
  const { evalRhai } = await import("./rhai-runner.js");
  const source = await readFile(filePath, "utf8");
  return evalRhai(source, {
    input: context.input,
    tools: context.tools as Record<string, unknown>,
    session: context.session as Record<string, unknown>,
  }, { timeoutMs: opts.timeoutMs, signal: opts.signal });
}

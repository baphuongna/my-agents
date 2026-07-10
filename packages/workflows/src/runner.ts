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
  console: {
    log: (...a: unknown[]) => emit({ kind: "log", level: "info", message: a.map(stringify).join(" ") }),
    info: (...a: unknown[]) => emit({ kind: "log", level: "info", message: a.map(stringify).join(" ") }),
    warn: (...a: unknown[]) => emit({ kind: "log", level: "warn", message: a.map(stringify).join(" ") }),
    error: (...a: unknown[]) => emit({ kind: "log", level: "error", message: a.map(stringify).join(" ") }),
  },
};

function stringify(v: unknown): string {
  try { return JSON.stringify(v); } catch { return String(v); }
}

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

const collected: RuntimeEvent[] = [];
function emit(e: RuntimeEvent) { collected.push(e); }

/** Load + execute a workflow file in the sandbox. */
export async function runWorkflow(
  filePath: string,
  context: WorkflowContext,
  opts: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<RuntimeEvent[]> {
  collected.length = 0;
  const source = await readFile(filePath, "utf8");

  // The sandbox receives ONLY the exposed API — no fs/net/child_process/require.
  const sandbox: Context = {
    ...SAFE_GLOBALS,
    ctx: Object.freeze({
      input: Object.freeze(context.input),
      tools: context.tools,
      provider: context.provider,
      session: Object.freeze({ ...context.session }),
    }),
    // No `require`, `process`, `globalThis`, `Buffer` — keep the surface tight.
  };

  // Wrap the user source so `module.exports.default = ...` becomes the entry.
  // We compile to: `(function(){ var module={exports:{}}; <source>; return module.exports.default; })()`
  // The script must `module.exports.default = async (ctx) => { ... }`.
  const wrapped = `(function(){ var module={exports:{}};\n${source}\n; return module.exports.default; })()`;
  const timeoutMs = opts.timeoutMs ?? 30_000;

  let entry: ((ctx: WorkflowContext) => Promise<unknown>) | undefined;
  try {
    entry = runInNewContext(wrapped, sandbox, { filename: basename(filePath), timeout: timeoutMs });
  } catch (e) {
    emit({ kind: "log", level: "error", message: `workflow compile failed: ${(e as Error).message}` });
    return [...collected];
  }
  if (typeof entry !== "function") {
    emit({ kind: "log", level: "error", message: `workflow must export default async function via module.exports.default` });
    return [...collected];
  }

  // Race the workflow against a timeout (vm's timeout option is sync-only).
  let entryResult: unknown;
  try {
    const timeoutErr = new Error(`workflow timed out after ${timeoutMs}ms`);
    const timeoutPromise = new Promise<never>((resolve, reject) => {
      setTimeout(() => reject(timeoutErr), timeoutMs);
    });
    entryResult = await Promise.race([
      Promise.resolve(entry(context)),
      timeoutPromise,
    ]);
    emit({ kind: "log", level: "info", message: `workflow completed: ${stringify(entryResult)}` });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    emit({ kind: "log", level: "error", message: `workflow execution failed: ${msg}` });
  }
  return [...collected];
}
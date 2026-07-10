/**
 * Workflow worker entry (HIGH-4 fix). The workflow body runs HERE, in a
 * worker_thread, so the parent can worker.terminate() on timeout — actually
 * killing an infinite async loop (vm setTimeout only rejects; the loop survives).
 *
 * The ctx.tools/ctx.provider calls round-trip to the parent via parentPort
 * (functions can't cross the worker boundary). Logs + result are posted back.
 */
import { parentPort, workerData } from "node:worker_threads";
import { pathToFileURL } from "node:url";
import type { ToolCall, ToolResult, DegradedResult } from "@my-agent/core";

interface WorkerData {
  filePath: string;
  input: unknown;
  session: Record<string, unknown>;
  timeoutMs: number;
}

type PendingTool = { resolve: (r: ToolResult[] | DegradedResult) => void; reject: (e: Error) => void };

if (!parentPort || !workerData) throw new Error("workflow-worker: must run as a worker_thread");

const data = workerData as WorkerData;
const port = parentPort;
const pendingTools = new Map<number, PendingTool>();
let nextToolId = 1;

port.on("message", (msg: { type: "tool-result"; id: number; result: ToolResult[] | DegradedResult } | { type: "provider-stream"; id: number; events: unknown[] } | { type: "provider-error"; id: number; error: string }) => {
  // resolve pending tool/provider calls
  const p = pendingTools.get(msg.id);
  if (!p) return;
  pendingTools.delete(msg.id);
  if (msg.type === "tool-result") p.resolve(msg.result as ToolResult[] | DegradedResult);
  else if (msg.type === "provider-error") p.reject(new Error(msg.error));
  else p.resolve(msg.events as unknown as ToolResult[] | DegradedResult);
});

const proxiedTools = {
  execute(calls: ToolCall[]): Promise<ToolResult[] | DegradedResult> {
    return new Promise((resolve, reject) => {
      const id = nextToolId++;
      pendingTools.set(id, { resolve: resolve as (r: ToolResult[] | DegradedResult) => void, reject });
      port.postMessage({ type: "tool", id, calls });
    });
  },
};

async function run(): Promise<void> {
  try {
    const mod = await import(pathToFileURL(data.filePath).href);
    const fn = mod.default ?? mod.run ?? mod.main;
    if (typeof fn !== "function") {
      port.postMessage({ type: "error", error: "workflow: no default export function" });
      return;
    }
    const ctx = { input: data.input, session: data.session, tools: proxiedTools };
    await fn(ctx);
    port.postMessage({ type: "done" });
  } catch (e) {
    port.postMessage({ type: "error", error: e instanceof Error ? e.message : String(e) });
  }
}

void run();

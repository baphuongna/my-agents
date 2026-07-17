/**
 * Bidirectional code-exec bridge (§11.4).
 *
 * A `code` tool that runs a script (JavaScript via node, or Python) with a
 * `tool(name, args)` helper that round-trips into the agent's tool registry
 * over a stdin/stdout JSON-RPC line protocol.
 *
 * Protocol (newline-delimited JSON):
 *   child → parent (stdout):  {"id":"<uuid>","name":"read","args":{...}}
 *   parent → child (stdin):   {"id":"<uuid>","ok":true,"output":{...}}
 *
 * The parent reads child-stdout lines, dispatches each as a tool call via the
 * injected registry, and writes the result to child-stdin. Bounded by a timeout
 * + a max-call cap (safety against runaway scripts).
 *
 * Source: §11.4 code-exec bridge, oh-my-pi §01 bidirectional bridge.
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { ToolExecutor, ToolResult } from "@my-agent/core";
import { DELEGATE_BLOCKED_TOOLS } from "@my-agent/core";
import { err, isRecord, ok, type ToolImpl } from "@my-agent/tools";

const MAX_TOOL_CALLS = 50;
const DEFAULT_TIMEOUT_MS = 30_000;

/** A request line from the child. */
interface BridgeRequest {
  id: string;
  name: string;
  args: unknown;
}

/** Build the `code` tool — runs JS/Python with bidirectional tool access. */
export function makeCodeExecTool(
  toolExecutor: ToolExecutor,
  ctxSource: () => import("@my-agent/core").TurnContext,
): ToolImpl {
  return {
    meta: {
      name: "code",
      args: {
        type: "object",
        properties: {
          language: { type: "string", enum: ["javascript", "python"] },
          script: { type: "string", description: "the code to run" },
          timeoutMs: { type: "number" },
        },
        required: ["language", "script"],
      },
      requiredMode: "DangerFullAccess", // arbitrary code exec — as dangerous as bash
    },
    async run(args, _ctx): Promise<ToolResult> {
      if (!isRecord(args)) return err("code", "args required");
      const language = args.language;
      const script = args.script;
      if (typeof language !== "string" || typeof script !== "string")
        return err("code", "language + script required");
      if (language !== "javascript" && language !== "python")
        return err("code", `unsupported language: ${language}`);

      const timeoutMs =
        typeof args.timeoutMs === "number" ? args.timeoutMs : DEFAULT_TIMEOUT_MS;
      return runBridge(language, script, timeoutMs, toolExecutor, ctxSource());
    },
  };
}

async function runBridge(
  language: "javascript" | "python",
  script: string,
  timeoutMs: number,
  toolExecutor: ToolExecutor,
  ctx: import("@my-agent/core").TurnContext,
): Promise<ToolResult> {
  const shim = language === "javascript" ? jsShim(script) : pythonShim(script);
  const cmd = language === "javascript" ? "node" : "python3";
  const cmdArgs =
    language === "javascript"
      ? ["--input-type=module", "-e", shim]
      : ["-c", shim];

  return new Promise((resolve) => {
    const child = spawn(cmd, cmdArgs, { stdio: ["pipe", "pipe", "pipe"] });
    const stdoutBuf: string[] = [];
    const stderrBuf: string[] = [];
    let lineBuf = "";
    let callCount = 0;
    let settled = false;

    const finish = (result: ToolResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(err("code", `timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    // Bridge: read child-stdout lines as tool-call requests.
    const MAX_STDOUT = 10 * 1024 * 1024; // M5: 10 MiB total stdout cap
    const MAX_LINE = 1024 * 1024;        // M5: 1 MiB max single line
    let stdoutBytes = 0;
    let killedForOversize = false;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", async (chunk: string) => {
      if (killedForOversize) return;
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_STDOUT) {
        killedForOversize = true;
        child.kill("SIGKILL");
        return;
      }
      stdoutBuf.push(chunk);
      lineBuf += chunk;
      // M5: cap a single line (a multi-GB no-newline line would grow lineBuf).
      if (lineBuf.length > MAX_LINE) {
        killedForOversize = true;
        child.kill("SIGKILL");
        return;
      }
      const lines = lineBuf.split("\n");
      lineBuf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let req: BridgeRequest;
        try {
          req = JSON.parse(line) as BridgeRequest;
        } catch {
          continue; // non-JSON line (script debug print) — ignore
        }
        if (typeof req.id !== "string" || typeof req.name !== "string") continue;
        callCount++;
        if (callCount > MAX_TOOL_CALLS) {
          child.stdin.write(
            JSON.stringify({ id: req.id, ok: false, error: `max tool calls (${MAX_TOOL_CALLS}) exceeded` }) + "\n",
          );
          continue;
        }
        // HIGH-3b (security review): the code-exec bridge kernel is filtered by
        // the SAME DELEGATE_BLOCKED_TOOLS denylist as a child's direct toolSurface
        // (spec R27-8/O3) — blocked names (bash/spawn/exec/...) are rejected here
        // before dispatch, independent of the executor's own gate (defense-in-depth).
        if (DELEGATE_BLOCKED_TOOLS.has(req.name)) {
          child.stdin.write(
            JSON.stringify({ id: req.id, ok: false, error: `blocked by DELEGATE_BLOCKED_TOOLS: ${req.name}` }) + "\n",
          );
          continue;
        }
        // Dispatch the tool call.
        const results = await toolExecutor.execute(
          [{ id: req.id, name: req.name, args: req.args }],
          ctx,
        );
        const single = Array.isArray(results) ? results[0] : results.results[0];
        if (!single) {
          child.stdin.write(JSON.stringify({ id: req.id, ok: false, error: "no result" }) + "\n");
        } else {
          child.stdin.write(
            JSON.stringify({ id: req.id, ok: single.ok, output: single.output, error: single.error }) + "\n",
          );
        }
      }
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (d: string) => stderrBuf.push(d));

    child.on("error", (e) => finish(err("code", e.message)));
    child.on("close", (code) => {
      // Capture any trailing non-JSON stdout as the script's "return value".
      const output = stdoutBuf.join("");
      const stderr = stderrBuf.join("");
      if (code !== 0 && code !== null) {
        finish(err("code", `exit ${code}: ${stderr.slice(0, 200) || "(no stderr)"}`));
        return;
      }
      finish(ok("code", { stdout: output, stderr, exitCode: code ?? 0, toolCalls: callCount }));
    });
  });
}

// ─── Shims (injected bridge helpers) ────────────────────────────────────────
/** JS shim: wraps the script + provides an async `tool(name, args)` helper. */
function jsShim(script: string): string {
  const helper = `
const __pending = new Map();
let __seq = 0;
function tool(name, args = {}) {
  const id = 'c' + (__seq++);
  return new Promise((resolve, reject) => {
    __pending.set(id, { resolve, reject });
    process.stdout.write(JSON.stringify({ id, name, args }) + '\\n');
  });
}
process.stdin.setEncoding('utf8');
let __inbuf = '';
process.stdin.on('data', (d) => {
  __inbuf += d;
  const lines = __inbuf.split('\\n');
  __inbuf = lines.pop();
  for (const line of lines) {
    if (!line.trim()) continue;
    let r; try { r = JSON.parse(line); } catch { continue; }
    const p = __pending.get(r.id);
    if (p) { __pending.delete(r.id); r.ok ? p.resolve(r.output) : p.reject(new Error(r.error)); }
  }
});
process.stdin.on('end', () => { for (const p of __pending.values()) p.reject(new Error('stdin closed')); });
`;
  // Linear-script contract: after the script's top-level completes + no pending
  // tool calls, exit (otherwise the open stdin pipe keeps the event loop alive).
  const trailer = `setImmediate(() => { if (__pending.size === 0) process.exit(0); });`;
  return helper + "\n" + script + "\n" + trailer + "\n";
}

/** Python shim: the same `tool()` helper in Python. */
function pythonShim(script: string): string {
  const helper = `import sys, json, threading, queue
__pending = {}
__lock = threading.Lock()
__seq = [0]
def tool(name, args=None):
    args = args or {}
    with __lock:
        cid = 'c' + str(__seq[0]); __seq[0] += 1
        ev = threading.Event(); __pending[cid] = {'ev': ev}
    sys.stdout.write(json.dumps({'id': cid, 'name': name, 'args': args}) + '\\n'); sys.stdout.flush()
    ev.wait()
    with __lock:
        r = __pending.pop(cid)
    if r.get('ok'): return r.get('output')
    raise RuntimeError(r.get('error', 'tool failed'))
def __reader():
    buf = ''
    for chunk in iter(lambda: sys.stdin.readline(), ''):
        line = chunk.strip()
        if not line: continue
        try: m = json.loads(line)
        except: continue
        with __lock:
            p = __pending.get(m.get('id'))
        if p:
            p.update(m); p['ev'].set()
threading.Thread(target=__reader, daemon=True).start()
`;
  // Linear-script contract: exit after the script completes + no pending calls
  // (otherwise the daemon reader thread + open stdin keep the process alive).
  const trailer = `import os; os._exit(0 if not __pending else 1)`;
  return helper + "\n" + script + "\n" + trailer + "\n";
}

export { randomUUID };

/**
 * DAP client (§11.2) — Debug Adapter Protocol over stdio.
 *
 * Same Content-Length framed stdio JSON as LSP (§11.1), but the debug protocol:
 * launch/attach a session, set breakpoints, continue, inspect stack/variables.
 * Tier 3 ships the core client + a `debug` tool that wraps it.
 *
 * Source: §11.2 DAP debugger, microsoft/debug-adapter-protocol.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";

/** DAP source (caller's or debugger's). */
export type DapSource = "launch" | "attach";

/** A breakpoint. */
export interface DapBreakpoint {
  line: number;
  source?: { path?: string; name?: string };
  condition?: string;
  hitCondition?: string;
}

/** A stack frame. */
export interface DapStackFrame { id: number; name: string; line: number; column?: number; source?: { path?: string } }

/** A scoped variable reference. */
export interface DapScope { name: string; variablesReference: number; expensive: boolean }
export interface DapVariable { name: string; value: string; type?: string; variablesReference: number }

/** A stopped event (breakpoint hit, step, exception, etc.). */
export interface DapStoppedEvent {
  reason: "step" | "breakpoint" | "exception" | "pause" | "entry" | "goto";
  threadId?: number;
  allThreadsStopped?: boolean;
  description?: string;
}

interface JsonRpcRequest { jsonrpc: "2.0"; id: number; method: string; params?: unknown }
interface JsonRpcResponse { jsonrpc: "2.0"; id: number; result?: unknown; error?: { code: number; message: string } }
interface JsonRpcEvent { jsonrpc: "2.0"; method: string; params?: unknown; seq?: number }

export interface DapClientOptions {
  command: string;
  args?: string[];
}

/** Per-request timeout (R43; matches LspClient). */
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

/**
 * DapClient — one debug-adapter subprocess. Methods return promises resolved
 * by the adapter's JSON-RPC responses. Emits 'stopped'/'continued'/'output'/'exited'
 * for adapter-initiated events.
 */
export class DapClient extends EventEmitter {
  private proc: ChildProcess | null = null;
  private buf = "";
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private initialized = false;
  /** Thread ID the debugger is currently focused on (set by 'stopped' events). */
  currentThreadId: number | undefined;

  constructor(private opts: DapClientOptions) {
    super();
  }

  /** Spawn the adapter + send initialize. */
  async initialize(clientId = "my-agent", clientName = "my-agent-dap"): Promise<{ capabilities: unknown }> {
    this.proc = spawn(this.opts.command, this.opts.args ?? [], { stdio: ["pipe", "pipe", "pipe"] });
    this.proc.stdout?.setEncoding("utf8");
    this.proc.stdout?.on("data", (chunk: string) => this.onStdout(chunk));
    this.proc.stderr?.setEncoding("utf8");
    this.proc.stderr?.on("data", () => { /* swallow */ });
    this.proc.on("exit", (code) => { this.initialized = false; this.emit("exited", code); });
    const r = await this.request<{ capabilities: unknown }>("initialize", {
      clientID: clientId, clientName, adapterID: "my-agent-dap",
      locale: "en-US", linesStartAt1: true, columnsStartAt1: true,
      pathFormat: "path", supportsVariableType: true, supportsVariablePaging: false,
    });
    this.notify("initialized", {});
    this.initialized = true;
    return r;
  }

  /** Launch or attach a debug session. */
  async start(source: DapSource, config: Record<string, unknown>): Promise<void> {
    if (!this.initialized) throw new Error("DapClient: not initialized");
    await this.request(source, config);
    // After launch, the adapter sends 'configurationDone' (or we send it after breakpoints).
    await this.request("configurationDone", {});
  }

  /** Set breakpoints for a source file. */
  async setBreakpoints(sourcePath: string, breakpoints: DapBreakpoint[]): Promise<{ breakpoints: { id?: number; verified: boolean; line?: number }[] }> {
    return this.request("setBreakpoints", {
      source: { path: sourcePath },
      breakpoints: breakpoints.map((bp) => ({
        line: bp.line,
        source: bp.source,
        condition: bp.condition,
        hitCondition: bp.hitCondition,
      })),
      sourceModified: false,
    });
  }

  /** Resume execution (continue). */
  async continue(threadId?: number): Promise<{ allThreadsContinued?: boolean }> {
    return this.request("continue", { threadId: threadId ?? this.currentThreadId });
  }

  /** Step over / in / out. */
  async next(threadId?: number): Promise<void> { await this.request("next", { threadId: threadId ?? this.currentThreadId }); }
  async stepIn(threadId?: number): Promise<void> { await this.request("stepIn", { threadId: threadId ?? this.currentThreadId }); }
  async stepOut(threadId?: number): Promise<void> { await this.request("stepOut", { threadId: threadId ?? this.currentThreadId }); }

  /** Get threads / stack trace / scopes / variables. */
  async threads(): Promise<{ threads: { id: number; name: string }[] }> {
    return this.request("threads", {});
  }
  async stackTrace(threadId: number, startFrame = 0, levels = 20): Promise<{ stackFrames: DapStackFrame[] }> {
    return this.request("stackTrace", { threadId, startFrame, levels });
  }
  async scopes(frameId: number): Promise<{ scopes: DapScope[] }> {
    return this.request("scopes", { frameId });
  }
  async variables(variablesReference: number): Promise<{ variables: DapVariable[] }> {
    return this.request("variables", { variablesReference });
  }

  /** Evaluate an expression in a given frame. */
  async evaluate(expression: string, frameId?: number): Promise<{ result: string; type?: string; variablesReference: number }> {
    return this.request("evaluate", { expression, frameId, context: frameId ? "watch" : "repl" });
  }

  /** Disconnect + exit. */
  async disconnect(): Promise<void> {
    if (!this.proc) return;
    try { await this.request("disconnect", { terminateDebuggee: true }); } catch { /* ignore */ }
    this.proc.kill();
    this.proc = null;
  }

  // ── JSON-RPC plumbing (Content-Length framed, same shape as LspClient) ───
  private request<T>(method: string, params?: unknown, opts: { timeoutMs?: number } = {}): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timeoutMs = opts.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`DAP "${method}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v as T); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }
  private notify(method: string, params?: unknown): void {
    this.send({ jsonrpc: "2.0", method, params });
  }
  private send(msg: JsonRpcRequest | JsonRpcEvent): void {
    const body = JSON.stringify(msg);
    const frame = `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`;
    this.proc?.stdin?.write(frame);
  }
  private onStdout(chunk: string): void {
    this.buf += chunk;
    while (true) {
      const headerEnd = this.buf.indexOf("\r\n\r\n");
      if (headerEnd === -1) break;
      const header = this.buf.slice(0, headerEnd);
      const m = /Content-Length:\s*(\d+)/i.exec(header);
      if (!m) { this.buf = this.buf.slice(headerEnd + 4); continue; }
      const len = parseInt(m[1]!, 10);
      const bodyStart = headerEnd + 4;
      if (this.buf.length < bodyStart + len) break;
      const body = this.buf.slice(bodyStart, bodyStart + len);
      this.buf = this.buf.slice(bodyStart + len);
      this.handleMessage(body);
    }
  }
  private handleMessage(body: string): void {
    let msg: JsonRpcResponse | JsonRpcEvent;
    try { msg = JSON.parse(body) as typeof msg; } catch { return; }
    if ("id" in msg && (msg as { result?: unknown }).result !== undefined || (msg as { error?: unknown }).error !== undefined) {
      const r = msg as JsonRpcResponse;
      const p = this.pending.get(r.id);
      if (p) {
        this.pending.delete(r.id);
        if (r.error) p.reject(new Error(`DAP ${r.error.code}: ${r.error.message}`));
        else p.resolve(r.result);
      }
    } else if ("method" in msg) {
      const e = msg as JsonRpcEvent;
      switch (e.method) {
        case "stopped": {
          const p = e.params as DapStoppedEvent;
          if (typeof p.threadId === "number") this.currentThreadId = p.threadId;
          this.emit("stopped", p);
          break;
        }
        case "continued": this.emit("continued", e.params); break;
        case "output": this.emit("output", e.params); break;
        case "thread": this.emit("thread", e.params); break;
        case "breakpoint": this.emit("breakpoint", e.params); break;
        case "terminated": this.emit("terminated", e.params); break;
        case "exited": this.emit("exited", e.params); break;
        case "initialized": this.emit("initialized", e.params); break;
      }
    }
  }
}
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
import { connect as netConnect, type Socket } from "node:net";
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
  /** Stdio mode: spawn this command. Mutually exclusive with `transport`. */
  command?: string;
  args?: string[];
  /** TCP mode: connect to a running adapter (e.g. vscode-js-debug dapDebugServer.js).
   * When set, `command` is ignored. */
  transport?: { host: string; port: number };
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
  /** Wire writer (stdio stdin OR tcp socket) — set in initialize(). */
  private writer: (data: string) => void = () => { throw new Error("DapClient: not initialized"); };
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private initialized = false;
  /** Thread ID the debugger is currently focused on (set by 'stopped' events). */
  currentThreadId: number | undefined;

  constructor(private opts: DapClientOptions) {
    super();
  }

  /** Spawn the adapter (stdio) OR connect to a running TCP adapter, then send
   * initialize. */
  async initialize(clientId = "my-agent", clientName = "my-agent-dap"): Promise<{ capabilities: unknown }> {
    if (this.opts.transport) {
      // TCP transport — connect to a running adapter (vscode-js-debug dapDebugServer.js).
      const sock = await connectSocket(this.opts.transport.host, this.opts.transport.port);
      sock.setEncoding("utf8");
      sock.on("data", (chunk: string) => this.onStdout(chunk));
      sock.on("close", () => { this.initialized = false; this.emit("exited", 0); });
      // redirect writes to the socket (this.write() is set up below to use the live writer).
      this.writer = (data: string) => sock.write(data);
    } else {
      this.proc = spawn(this.opts.command!, this.opts.args ?? [], { stdio: ["pipe", "pipe", "pipe"] });
      this.proc.stdout?.setEncoding("utf8");
      this.proc.stdout?.on("data", (chunk: string) => this.onStdout(chunk));
      this.proc.stderr?.setEncoding("utf8");
      this.proc.stderr?.on("data", () => { /* swallow */ });
      this.proc.on("exit", (code) => { this.initialized = false; this.emit("exited", code); });
      this.writer = (data: string) => this.proc!.stdin!.write(data);
    }
    const r = await this.request<{ capabilities: unknown }>("initialize", {
      clientID: clientId, clientName, adapterID: "my-agent-dap",
      locale: "en-US", linesStartAt1: true, columnsStartAt1: true,
      pathFormat: "path", supportsVariableType: true, supportsVariablePaging: false,
    });
    // NOTE: in DAP the SERVER sends the `initialized` event; the client must NOT
    // (it was a JSON-RPC-ism that confused js-debug into ignoring the launch).
    this.initialized = true;
    return r;
  }

  /** Launch or attach a debug session. */
  async start(source: DapSource, config: Record<string, unknown>): Promise<void> {
    if (!this.initialized) throw new Error("DapClient: not initialized");
    await this.request(source, config);
    // NOTE: do NOT auto-send configurationDone here — the caller sets breakpoints
    // FIRST, then calls configurationDone() (otherwise breakpoints set after
    // launch don't take effect). pwa-node waits for configurationDone to run.
  }

  /** Tell the adapter configuration is done (breakpoints set) → it runs. */
  async configurationDone(): Promise<void> {
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

  /** Step over / in / out. R43: require an explicit threadId or currentThreadId —
   *  sending `threadId: undefined` would be rejected by most adapters. */
  async next(threadId?: number): Promise<void> {
    const tid = threadId ?? this.currentThreadId;
    if (tid === undefined) throw new Error("DapClient.next: no current thread (await 'stopped' event first or pass threadId)");
    await this.request("next", { threadId: tid });
  }
  async stepIn(threadId?: number): Promise<void> {
    const tid = threadId ?? this.currentThreadId;
    if (tid === undefined) throw new Error("DapClient.stepIn: no current thread (await 'stopped' event first or pass threadId)");
    await this.request("stepIn", { threadId: tid });
  }
  async stepOut(threadId?: number): Promise<void> {
    const tid = threadId ?? this.currentThreadId;
    if (tid === undefined) throw new Error("DapClient.stepOut: no current thread (await 'stopped' event first or pass threadId)");
    await this.request("stepOut", { threadId: tid });
  }

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
    // R43: frameId 0 is a valid DAP frame id; use explicit null/undefined check
    // (the previous truthy check treated 0 as "no frame" and picked the wrong context).
    const hasFrame = frameId !== undefined && frameId !== null;
    return this.request("evaluate", { expression, frameId, context: hasFrame ? "watch" : "repl" });
  }

  /** Disconnect + exit. */
  async disconnect(): Promise<void> {
    if (!this.proc) return;
    try { await this.request("disconnect", { terminateDebuggee: true }); } catch { /* ignore */ }
    this.proc.kill();
    this.proc = null;
  }

  // ── DAP plumbing (Content-Length framed). DAP is NOT JSON-RPC 2.0: requests
  //    are {seq,type:"request",command,arguments}; responses are
  //    {seq,type:"response",request_seq,success,body,message}; events are
  //    {seq,type:"event",event,body}. Fixed to true DAP shape (was JSON-RPC).
  private request<T>(command: string, args?: unknown, opts: { timeoutMs?: number } = {}): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timeoutMs = opts.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`DAP "${command}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v as T); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      this.send({ seq: id, type: "request", command, arguments: args ?? {} });
    });
  }
  notify(event: string, body?: unknown): void {
    this.send({ seq: this.nextId++, type: "event", event, body: body ?? {} });
  }
  private send(msg: unknown): void {
    const body = JSON.stringify(msg);
    const frame = `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`;
    this.writer(frame);
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
      // M4 fix: cap Content-Length (DoS — a malicious adapter could declare
      // Content-Length: 9GB + slow-drip → OOM). 16 MiB per §25.6 SSE_BUFFER_BYTES.
      const MAX_FRAME = 16 * 1024 * 1024;
      if (len > MAX_FRAME || this.buf.length > MAX_FRAME) {
        this.buf = "";
        this.initialized = false;
        this.emit("exited", -1);
        break;
      }
      const bodyStart = headerEnd + 4;
      if (this.buf.length < bodyStart + len) break;
      const body = this.buf.slice(bodyStart, bodyStart + len);
      this.buf = this.buf.slice(bodyStart + len);
      this.handleMessage(body);
    }
  }
  private handleMessage(body: string): void {
    let msg: Record<string, unknown>;
    try { msg = JSON.parse(body) as Record<string, unknown>; } catch { return; }
    // DAP responses: {type:"response", request_seq, success, body, message}
    if (msg.type === "response") {
      const id = msg.request_seq as number;
      const p = this.pending.get(id);
      if (p) {
        this.pending.delete(id);
        if (msg.success === false) p.reject(new Error(`DAP ${msg.command}: ${msg.message ?? "failed"}`));
        else p.resolve(msg.body);
      }
      return;
    }
    // DAP events: {type:"event", event, body}
    if (msg.type === "event") {
      const name = msg.event as string;
      const b = msg.body as Record<string, unknown>;
      switch (name) {
        case "stopped": {
          const p = b as unknown as DapStoppedEvent;
          if (typeof p.threadId === "number") this.currentThreadId = p.threadId;
          this.emit("stopped", p);
          break;
        }
        case "continued": this.emit("continued", b); break;
        case "output": this.emit("output", b); break;
        case "thread": this.emit("thread", b); break;
        case "breakpoint": this.emit("breakpoint", b); break;
        case "terminated": this.emit("terminated", b); break;
        case "exited": this.emit("exited", b); break;
        case "initialized": this.emit("initialized", b); break;
      }
    }
  }
}

/** Connect a TCP socket to a running DAP adapter (Promise<Socket>). */
function connectSocket(host: string, port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const sock = netConnect({ host, port });
    sock.once("connect", () => resolve(sock));
    sock.once("error", reject);
  });
}
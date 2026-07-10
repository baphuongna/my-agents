/**
 * LSP client (§11.1) — lightweight Language Server Protocol client (stdio).
 *
 * Manages a single LSP server subprocess. Speaks LSP over the Content-Length
 * framed JSON-RPC on stdio. Tier 2 ships the core client (initialize/shutdown/
 * didOpen/didChange + hover/definition/references/diagnostics) — enough for an
 * LSP-on-write diagnostics tool. Full capability negotiation + workspace
 * symbols land Tier 3.
 *
 * Source: §11.1 LSP service, oh-my-pi pi-langsrv.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";

/** LSP diagnostic. */
export interface LspDiagnostic {
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  message: string;
  severity: 1 | 2 | 3 | 4; // error|warning|info|hint
  source?: string;
}

/** LSP hover result. */
export interface LspHover {
  contents: string;
  range?: { start: { line: number; character: number }; end: { line: number; character: number } };
}

/** LSP location (file + range). */
export interface LspLocation { uri: string; range: { start: { line: number; character: number }; end: { line: number; character: number } } }

/** LSP position. */
export interface LspPosition { line: number; character: number }

/** JSON-RPC envelope over Content-Length framed stdio. */
interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
}
interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}
interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

export interface LspClientOptions {
  command: string;
  args?: string[];
  rootUri: string;
  /** Optional language id override (default = "typescript"). */
  languageId?: string;
}

/**
 * LspClient — one server subprocess. Methods return promises resolved by the
 * server's JSON-RPC responses. Emits 'diagnostics' on textDocument/publishDiagnostics.
 */
export class LspClient extends EventEmitter {
  private proc: ChildProcess | null = null;
  private buf = ""; // stdout buffer for Content-Length framing
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private diagnostics = new Map<string, LspDiagnostic[]>(); // uri → diagnostics
  private initialized = false;

  constructor(private opts: LspClientOptions) {
    super();
  }

  /** Spawn the server + send initialize. */
  async start(): Promise<void> {
    this.proc = spawn(this.opts.command, this.opts.args ?? [], { stdio: ["pipe", "pipe", "pipe"] });
    this.proc.stdout?.setEncoding("utf8");
    this.proc.stdout?.on("data", (chunk: string) => this.onStdout(chunk));
    this.proc.stderr?.setEncoding("utf8");
    this.proc.stderr?.on("data", () => { /* swallow stderr */ });
    this.proc.on("exit", (code) => {
      this.initialized = false;
      this.emit("exit", code);
    });
    await this.request("initialize", {
      processId: process.pid,
      rootUri: this.opts.rootUri,
      capabilities: { textDocument: { synchronization: { didSave: true }, hover: { contentFormat: ["plaintext"] } } },
    });
    this.notify("initialized", {});
    this.initialized = true;
  }

  /** Notify the server of a file open (publishes diagnostics via didOpen→didChange). */
  openDocument(uri: string, languageId: string, content: string, version: number): void {
    this.notify("textDocument/didOpen", { textDocument: { uri, languageId, version, text: content } });
  }
  /** Notify content change. */
  changeDocument(uri: string, version: number, content: string): void {
    this.notify("textDocument/didChange", {
      textDocument: { uri, version },
      contentChanges: [{ text: content }],
    });
  }

  hover(uri: string, pos: LspPosition): Promise<LspHover | null> {
    return this.request<{ contents: string; range?: LspHover["range"] } | null>(
      "textDocument/hover",
      { textDocument: { uri }, position: pos },
    );
  }

  definition(uri: string, pos: LspPosition): Promise<LspLocation[]> {
    return this.request<LspLocation[]>("textDocument/definition", {
      textDocument: { uri }, position: pos,
    });
  }

  references(uri: string, pos: LspPosition): Promise<LspLocation[]> {
    return this.request<LspLocation[]>("textDocument/references", {
      textDocument: { uri }, position: pos, context: { includeDeclaration: false },
    });
  }

  getDiagnostics(uri: string): LspDiagnostic[] {
    return this.diagnostics.get(uri) ?? [];
  }

  /** Shutdown + exit. */
  async stop(): Promise<void> {
    if (!this.proc) return;
    try { await this.request("shutdown", {}); this.notify("exit", {}); } catch { /* ignore */ }
    this.proc.kill();
    this.proc = null;
  }

  // ── JSON-RPC plumbing ────────────────────────────────────────────────────
  private request<T>(method: string, params?: unknown): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }
  private notify(method: string, params?: unknown): void {
    this.send({ jsonrpc: "2.0", method, params });
  }
  private send(msg: JsonRpcRequest | JsonRpcNotification): void {
    const body = JSON.stringify(msg);
    const frame = `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`;
    this.proc?.stdin?.write(frame);
  }
  private onStdout(chunk: string): void {
    this.buf += chunk;
    // Parse Content-Length framed messages.
    while (true) {
      const headerEnd = this.buf.indexOf("\r\n\r\n");
      if (headerEnd === -1) break;
      const header = this.buf.slice(0, headerEnd);
      const m = /Content-Length:\s*(\d+)/i.exec(header);
      if (!m) { this.buf = this.buf.slice(headerEnd + 4); continue; }
      const len = parseInt(m[1]!, 10);
      const bodyStart = headerEnd + 4;
      if (this.buf.length < bodyStart + len) break; // need more
      const body = this.buf.slice(bodyStart, bodyStart + len);
      this.buf = this.buf.slice(bodyStart + len);
      this.handleMessage(body);
    }
  }
  private handleMessage(body: string): void {
    let msg: JsonRpcResponse | JsonRpcNotification;
    try { msg = JSON.parse(body) as typeof msg; } catch { return; }
    if ("id" in msg && msg.id !== undefined && (msg as { result?: unknown }).result !== undefined || (msg as { error?: unknown }).error !== undefined) {
      const r = msg as JsonRpcResponse;
      const p = this.pending.get(r.id);
      if (p) {
        this.pending.delete(r.id);
        if (r.error) p.reject(new Error(`LSP ${r.error.code}: ${r.error.message}`));
        else p.resolve(r.result);
      }
    } else if ("method" in msg) {
      const n = msg as JsonRpcNotification;
      if (n.method === "textDocument/publishDiagnostics") {
        const p = n.params as { uri: string; diagnostics: LspDiagnostic[] };
        this.diagnostics.set(p.uri, p.diagnostics);
        this.emit("diagnostics", { uri: p.uri, diagnostics: p.diagnostics });
      }
    }
  }
}
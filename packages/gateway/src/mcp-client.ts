/**
 * @my-agent/gateway — MCP client manager.
 *
 * Bridges external MCP servers (Model Context Protocol) into pi's tool registry.
 * Spawns MCP server processes (stdio transport), discovers their tools, and
 * exposes them as pi custom tools.
 *
 * Lifecycle: uses the 11-phase FSM from mcp-lifecycle.ts.
 * Transport: stdio (JSON-RPC 2.0 over child process stdin/stdout).
 */
import { spawn, type ChildProcess } from "node:child_process";
import type { McpServer, McpPhase } from "./mcp-lifecycle.js";
import { transition, aggregateHealth, availableTools } from "./mcp-lifecycle.js";

/** An MCP tool definition returned by tools/list. */
export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

/** MCP server configuration (from ~/.mya/agent/mcp.json or programmatic). */
export interface McpServerConfig {
  id: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

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
  error?: { code: number; message: string; data?: unknown };
}

/**
 * Manages MCP server connections. Each server is a child process communicating
 * via stdio JSON-RPC. Tools are discovered via tools/list and proxied via tools/call.
 */
export class McpManager {
  private servers = new Map<string, McpServer>();
  private procs = new Map<string, ChildProcess>();
  /** B6 fix: retain full server config (incl. env) so spawn-time env merge recovers it. */
  private configs = new Map<string, McpServerConfig>();
  /** B3 fix: retain full McpToolInfo[] (incl. inputSchema) per server. */
  private toolSchemas = new Map<string, McpToolInfo[]>();
  private rpcId = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private buffers = new Map<string, string>();

  /** Register a server config (does not start it).
   * Idempotent: if the server is already started (Healthy/Degraded/Initializing),
   * preserve its state — only update the config + create entry if new. */
  register(cfg: McpServerConfig): void {
    this.configs.set(cfg.id, cfg); // B6: retain full config (incl. env) for spawn-time merge.
    const existing = this.servers.get(cfg.id);
    if (existing) return; // already registered (possibly started) — don't overwrite
    const server: McpServer = {
      id: cfg.id,
      command: cfg.command,
      args: cfg.args ?? [],
      phase: "Discovered",
      health: "Healthy",
      capabilities: [],
      consecutiveFailures: 0,
      tools: [],
    };
    this.servers.set(cfg.id, server);
  }

  /** Start a server: spawn process → initialize → discover tools. */
  async start(id: string): Promise<McpServer> {
    let server = this.servers.get(id);
    if (!server) throw new Error(`MCP server "${id}" not registered`);
    if (server.phase === "Healthy" || server.phase === "Degraded") return server;
    // Allow restart from Stopped: Stopped → Discovered (legal), then the normal path.
    if (server.phase === "Stopped") {
      server = transition(server, "Discovered");
      this.servers.set(id, server);
    }

    // B2 fix: phase order MUST follow ALLOWED_TRANSITIONS:
    //   Discovered → Validated → Initializing → Healthy.
    // The prior order (Discovered → Initializing → Validated → Healthy) hit THREE
    // illegal transitions and threw on the very first call — MCP was unusable.
    const validated = transition(server, "Validated");
    this.servers.set(id, validated);

    try {
      // Validated → Initializing (spawn process + send initialize).
      const initializing = transition(validated, "Initializing");
      this.servers.set(id, initializing);
      const proc = spawn(initializing.command, initializing.args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, ...this.getConfig(id)?.env },
      });
      this.procs.set(id, proc);

      // JSON-RPC framing: Content-Length header + body
      let buf = "";
      proc.stdout?.setEncoding("utf8");
      proc.stdout?.on("data", (chunk: string) => {
        buf += chunk;
        const messages = this.extractMessages(buf);
        buf = messages.remainder;
        for (const msg of messages.parsed) {
          this.handleResponse(msg);
        }
      });
      this.buffers.set(id, buf);

      proc.on("error", (err) => {
        if (this.procs.get(id) !== proc) return; // stale proc (restart replaced it)
        this.toFailed(id, err.message); // idempotent — respects terminal states
      });

      proc.on("exit", () => {
        if (this.procs.get(id) !== proc) return; // stale proc (restart replaced it)
        this.toFailed(id, "process exited");
      });

      // Send initialize request
      const initResult = await this.rpc(id, "initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "mya", version: "1.0.0" },
      }) as { capabilities?: Record<string, unknown> };

      const capabilities = Object.keys(initResult.capabilities ?? {});
      // (still Initializing — initialize RPC done, awaiting tools/list)

      // Discover tools. B3 fix: retain full McpToolInfo[] (incl. inputSchema) so
      // callers register tools with real parameter schemas instead of empty {}.
      const toolsResult = await this.rpc(id, "tools/list", {}) as { tools?: McpToolInfo[] };
      const toolInfos = toolsResult.tools ?? [];
      this.toolSchemas.set(id, toolInfos);
      const tools = toolInfos.map((t) => t.name);

      // Initializing → Healthy
      const healthy = transition(this.servers.get(id)!, "Healthy");
      this.servers.set(id, { ...healthy, tools, capabilities });

      return this.servers.get(id)!;
    } catch (e) {
      this.toFailed(id, (e as Error).message); // idempotent — 'error'/'exit' may have set Failed already
      throw e;
    }
  }

  /** Call a tool on a specific MCP server. */
  async callTool(serverId: string, toolName: string, args: Record<string, unknown>): Promise<unknown> {
    const server = this.servers.get(serverId);
    if (!server || (server.phase !== "Healthy" && server.phase !== "Degraded")) {
      throw new Error(`MCP server "${serverId}" not healthy (phase: ${server?.phase ?? "unknown"})`);
    }
    return this.rpc(serverId, "tools/call", { name: toolName, arguments: args });
  }

  /** Stop a server: kill process → Stopped phase. */
  stop(id: string): void {
    const proc = this.procs.get(id);
    if (proc) {
      proc.kill();
      this.procs.delete(id);
    }
    this.toolSchemas.delete(id); // clear stale schemas (re-discovered on restart)
    const server = this.servers.get(id);
    if (server) {
      this.servers.set(id, transition(server, "Stopped"));
    }
  }

  /** Stop all servers. */
  stopAll(): void {
    for (const id of this.servers.keys()) this.stop(id);
  }

  /** Get a server's current state. */
  getServer(id: string): McpServer | undefined {
    return this.servers.get(id);
  }

  /** List all registered servers. */
  listServers(): McpServer[] {
    return [...this.servers.values()];
  }

  /** Aggregate health across all servers. */
  get health() {
    return aggregateHealth([...this.servers.values()]);
  }

  /** All available tools across healthy/degraded servers. */
  get tools() {
    return availableTools([...this.servers.values()]);
  }

  /** Discover tools from all registered servers. */
  getTools(): McpToolInfo[] {
    const out: McpToolInfo[] = [];
    for (const s of this.servers.values()) {
      if (s.phase === "Healthy" || s.phase === "Degraded") {
        for (const t of s.tools) {
          out.push({ name: `mcp__${s.id}__${t}`, description: `MCP tool from ${s.id}` });
        }
      }
    }
    return out;
  }

  /** Full tool infos (incl. inputSchema) for a server. B3 fix: callers use this
   * to register MCP tools with real parameter schemas instead of empty `{}`. */
  getToolInfos(id: string): McpToolInfo[] {
    return this.toolSchemas.get(id) ?? [];
  }

  /** Idempotent transition to Failed — skips terminal states (Failed/Quarantine/
   * Stopped). Prevents the FSM from throwing "illegal transition: Failed → Failed"
   * when the proc 'error'/'exit' handler and the start() catch both fire for the
   * same failure (which previously masked the real spawn/RPC error). */
  private toFailed(id: string, error: string): void {
    const s = this.servers.get(id);
    if (!s) return;
    if (s.phase === "Failed" || s.phase === "Quarantine" || s.phase === "Stopped") return;
    this.servers.set(id, transition(s, "Failed", { error }));
  }

  private getConfig(id: string): McpServerConfig | undefined {
    // B6 fix: return the full registered config (incl. env) so spawn-time env
    // merge recovers custom environment overrides registered via mcp.json.
    return this.configs.get(id);
  }

  /** Send a JSON-RPC request and await the response. */
  private rpc(serverId: string, method: string, params: unknown): Promise<unknown> {
    const proc = this.procs.get(serverId);
    const stdin = proc?.stdin;
    if (!proc || !stdin || stdin.destroyed) {
      return Promise.reject(new Error(`MCP server "${serverId}" not connected`));
    }
    const id = ++this.rpcId;
    const req: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };
    // MCP spec: newline-delimited JSON (NOT LSP-style Content-Length framing)
    const frame = JSON.stringify(req) + "\n";

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      stdin.write(frame, (err) => {
        if (err) reject(new Error(`MCP write failed: ${err.message}`));
      });
      // Timeout for MCP calls (npx startup is slow; real API calls can take 30s+)
      const timeout = method === "initialize" ? 30_000 : method === "tools/call" ? 60_000 : 15_000;
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`MCP request "${method}" timed out (${timeout / 1000}s)`));
        }
      }, timeout);
    });
  }

  /** Handle a parsed JSON-RPC response. */
  private handleResponse(msg: JsonRpcResponse): void {
    const pending = this.pending.get(msg.id);
    if (!pending) return;
    this.pending.delete(msg.id);
    if (msg.error) {
      pending.reject(new Error(`MCP error ${msg.error.code}: ${msg.error.message}`));
    } else {
      pending.resolve(msg.result);
    }
  }

  /** Extract complete JSON-RPC messages from a buffer (Content-Length framing). */
  private extractMessages(buf: string): { parsed: JsonRpcResponse[]; remainder: string } {
    const parsed: JsonRpcResponse[] = [];
    let remaining = buf;
    // MCP spec: newline-delimited JSON (NOT LSP-style Content-Length framing)
    // Some servers may also send Content-Length — handle both for compatibility.
    while (remaining.length > 0) {
      // Try Content-Length framing first (LSP-style, used by some servers)
      const headerEnd = remaining.indexOf("\r\n\r\n");
      if (headerEnd >= 0 && headerEnd < 200) {
        const header = remaining.slice(0, headerEnd);
        const match = header.match(/Content-Length:\s*(\d+)/i);
        if (match) {
          const len = parseInt(match[1]!, 10);
          const bodyStart = headerEnd + 4;
          const bodyEnd = bodyStart + len;
          if (remaining.length < bodyEnd) break;
          try {
            parsed.push(JSON.parse(remaining.slice(bodyStart, bodyEnd)) as JsonRpcResponse);
          } catch { /* malformed */ }
          remaining = remaining.slice(bodyEnd);
          continue;
        }
      }
      // Fall back to newline-delimited JSON (MCP standard)
      const nlIdx = remaining.indexOf("\n");
      if (nlIdx < 0) break;
      const line = remaining.slice(0, nlIdx).trim();
      remaining = remaining.slice(nlIdx + 1);
      if (!line) continue;
      try {
        parsed.push(JSON.parse(line) as JsonRpcResponse);
      } catch {
        // Not valid JSON — could be a log line or partial message, skip
      }
    }
    return { parsed, remainder: remaining };
  }
}

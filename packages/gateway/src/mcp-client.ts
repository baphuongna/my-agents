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
  private rpcId = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private buffers = new Map<string, string>();

  /** Register a server config (does not start it). */
  register(cfg: McpServerConfig): void {
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
    const server = this.servers.get(id);
    if (!server) throw new Error(`MCP server "${id}" not registered`);
    if (server.phase === "Healthy" || server.phase === "Degraded") return server;

    const updated = transition(server, "Initializing");
    this.servers.set(id, updated);

    try {
      const proc = spawn(updated.command, updated.args, {
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
        const s = this.servers.get(id);
        if (s) {
          this.servers.set(id, transition(s, "Failed", { error: err.message }));
        }
      });

      proc.on("exit", () => {
        const s = this.servers.get(id);
        if (s && s.phase !== "Stopped") {
          this.servers.set(id, transition(s, "Failed", { error: "process exited" }));
        }
      });

      // Send initialize request
      const initResult = await this.rpc(id, "initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "mya", version: "1.0.0" },
      }) as { capabilities?: Record<string, unknown> };

      const capabilities = Object.keys(initResult.capabilities ?? {});
      const validated = transition(updated, "Validated");
      this.servers.set(id, { ...validated, capabilities });

      // Discover tools
      const toolsResult = await this.rpc(id, "tools/list", {}) as { tools?: McpToolInfo[] };
      const tools = (toolsResult.tools ?? []).map((t) => t.name);
      const healthy = transition(this.servers.get(id)!, "Healthy");
      this.servers.set(id, { ...healthy, tools });

      return this.servers.get(id)!;
    } catch (e) {
      const failed = transition(this.servers.get(id)!, "Failed", { error: (e as Error).message });
      this.servers.set(id, failed);
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

  private getConfig(id: string): McpServerConfig | undefined {
    // Config is stored as part of register(); we reconstruct from server state.
    const s = this.servers.get(id);
    if (!s) return undefined;
    return { id: s.id, command: s.command, args: s.args };
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
    const body = JSON.stringify(req);
    const frame = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      stdin.write(frame, (err) => {
        if (err) reject(new Error(`MCP write failed: ${err.message}`));
      });
      // Timeout after 10s
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`MCP request "${method}" timed out (10s)`));
        }
      }, 10_000);
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
    while (true) {
      const headerEnd = remaining.indexOf("\r\n\r\n");
      if (headerEnd < 0) break;
      const header = remaining.slice(0, headerEnd);
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) break;
      const len = parseInt(match[1]!, 10);
      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + len;
      if (remaining.length < bodyEnd) break;
      const body = remaining.slice(bodyStart, bodyEnd);
      try {
        parsed.push(JSON.parse(body) as JsonRpcResponse);
      } catch {
        // malformed — skip
      }
      remaining = remaining.slice(bodyEnd);
    }
    return { parsed, remainder: remaining };
  }
}

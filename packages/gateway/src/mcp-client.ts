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
import { nowWallclock } from "@my-agent/core";
import type { McpServer } from "./mcp-lifecycle.js";
import { transition, aggregateHealth, availableTools } from "./mcp-lifecycle.js";

// ─── Reliability: failure classification, exception unwrapping ───────────
// Pure helpers (no state) — exported for direct unit testing.

export type McpFailureClass = "permanent" | "transient";

/** Classify an MCP connect/call failure.
 * `permanent` failures (bad command, auth, invalid URL, refused host/port) are
 * unrecoverable without operator action — they get the max cooldown so we don't
 * hammer a broken server. `transient` failures (timeouts, transient network)
 * get normal exponential backoff. */
export function classifyMcpFailure(err: unknown): McpFailureClass {
  const msg = err instanceof Error ? err.message : String(err);
  // Permanent: command not found, auth errors, invalid URL
  if (msg.includes("ENOENT") || msg.includes("not found")) return "permanent";
  if (msg.includes("401") || msg.includes("403") || msg.includes("Unauthorized")) return "permanent";
  if (msg.includes("invalid url") || msg.includes("Invalid URL")) return "permanent";
  if (msg.includes("ECONNREFUSED") && msg.includes("connect")) return "permanent"; // bad port/host
  return "transient";
}

/** Unwrap anyio-style exception groups / Node AggregateErrors.
 * Python MCP servers raise BaseExceptionGroup from anyio TaskGroups; the Node
 * equivalent is AggregateError (error.cause chains / Promise.allSettled). Prefer
 * the first non-cancellation (non-AbortError) sub-error so callers see the real
 * cause instead of a generic group wrapper. */
export function unwrapExceptionGroup(err: unknown): unknown {
  if (err instanceof AggregateError && err.errors.length > 0) {
    for (const sub of err.errors) {
      if (!(sub instanceof Error) || sub.name !== "AbortError") return sub;
    }
    return err.errors[0];
  }
  return err;
}

/** Per-server reconnect-budget tracking (§PLAN-HERMES-PORT Phase 1). */
interface ReconnectState {
  sessionProven: boolean; // false until a successful tool call or keepalive
  reconnectRetries: number; // consecutive unproven reconnects
  wasParked: boolean; // currently parked (budget exhausted)
}

const _MAX_RECONNECT_RETRIES = 5; // unproven connects before parking
const _PARKED_RETRY_INTERVAL = 300_000; // 5 min self-probe for parked servers
const _BACKOFF_JITTER = 0.2; // ±20% jitter on reconnect/probe delays

const _CONNECT_RETRY_BASE_MS = 30_000;
const _CONNECT_RETRY_MAX_MS = 600_000;

const _DEFAULT_KEEPALIVE_INTERVAL = 180_000; // 3 min
const _MIN_KEEPALIVE_INTERVAL = 5_000;

/** Apply ±_BACKOFF_JITTER jitter to a base delay (ms). */
function jitteredDelay(baseMs: number): number {
  return Math.round(baseMs * (1 + (Math.random() - 0.5) * 2 * _BACKOFF_JITTER));
}

/** Unref a timer so it never keeps the event loop alive on its own. */
function unrefTimer(t: ReturnType<typeof setInterval> | ReturnType<typeof setTimeout>): void {
  t.unref?.();
}

/** An MCP tool definition returned by tools/list. */
export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

/** MCP server configuration (from ~/.mya/agent/mcp.json or programmatic).
 * Supports two transports:
 * - stdio: spawn child process (command + args), communicate via stdin/stdout JSON-RPC
 * - http: POST JSON-RPC to url, optionally with headers (e.g. Authorization) */
export interface McpServerConfig {
  id: string;
  /** stdio transport: command to spawn */
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  /** http transport: endpoint URL */
  url?: string;
  /** http transport: request headers (e.g. Authorization) */
  headers?: Record<string, string>;
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

  // ─── Reliability state (per-server, instance-scoped) ───────────────────
  private reconnectState = new Map<string, ReconnectState>();
  private connectFailures = new Map<string, number>(); // server → consecutive fail count
  private connectRetryAfter = new Map<string, number>(); // server → wallclock-ms deadline
  private keepaliveTimers = new Map<string, ReturnType<typeof setInterval>>();
  private parkedProbes = new Map<string, ReturnType<typeof setTimeout>>();
  private reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private pingUnsupported = new Set<string>();

  /** Register a server config (does not start it).
   * Idempotent: if the server is already started (Healthy/Degraded/Initializing),
   * preserve its state — only update the config + create entry if new. */
  register(cfg: McpServerConfig): void {
    this.configs.set(cfg.id, cfg); // B6: retain full config (incl. env) for spawn-time merge.
    const existing = this.servers.get(cfg.id);
    if (existing) return; // already registered (possibly started) — don't overwrite
    const server: McpServer = {
      id: cfg.id,
      command: cfg.command ?? cfg.url ?? "",
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
    // Reliability: respect per-server connect cooldown (exponential backoff).
    if (this.connectCooldownActive(id)) {
      throw new Error(`MCP server "${id}" in cooldown (retry later)`);
    }
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
      // Validated → Initializing.
      const initializing = transition(validated, "Initializing");
      this.servers.set(id, initializing);
      const cfg = this.configs.get(id);

      // HTTP transport: no process to spawn — skip directly to initialize via HTTP
      if (cfg?.url) {
        const initResult = await this.rpc(id, "initialize", {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "mya", version: "1.0.0" },
        }) as { capabilities?: Record<string, unknown> };
        const capabilities = Object.keys(initResult.capabilities ?? {});
        const toolsResult = await this.rpc(id, "tools/list", {}) as { tools?: McpToolInfo[] };
        const toolInfos = toolsResult.tools ?? [];
        this.toolSchemas.set(id, toolInfos);
        const healthy = transition(initializing, "Healthy");
        this.servers.set(id, { ...healthy, capabilities, tools: toolInfos.map((t) => t.name) });
        this.onConnectSuccess(id);
        return this.servers.get(id)!;
      }

      // stdio transport: spawn process
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

      this.onConnectSuccess(id);
      return this.servers.get(id)!;
    } catch (e) {
      // Reliability: unwrap group errors, classify, arm cooldown.
      const unwrapped = unwrapExceptionGroup(e);
      const cls = classifyMcpFailure(unwrapped);
      this.recordConnectFailure(id, { permanent: cls === "permanent" });
      this.toFailed(id, unwrapped instanceof Error ? unwrapped.message : String(unwrapped));
      throw e; // throw ORIGINAL to preserve stack/cause for the caller
    }
  }

  /** Call a tool on a specific MCP server. */
  async callTool(serverId: string, toolName: string, args: Record<string, unknown>): Promise<unknown> {
    const server = this.servers.get(serverId);
    if (!server || (server.phase !== "Healthy" && server.phase !== "Degraded")) {
      throw new Error(`MCP server "${serverId}" not healthy (phase: ${server?.phase ?? "unknown"})`);
    }
    const result = await this.rpc(serverId, "tools/call", { name: toolName, arguments: args });
    // Reliability: a successful tool call proves the session is live.
    this.markSessionProven(serverId);
    return result;
  }

  /** Stop a server: kill process → Stopped phase. */
  stop(id: string): void {
    this.clearReliabilityTimers(id);
    const proc = this.procs.get(id);
    if (proc) {
      proc.kill();
      this.procs.delete(id);
    }
    this.toolSchemas.delete(id); // clear stale schemas (re-discovered on restart)
    // Reliability: clear per-server budget/cooldown so a restart begins fresh.
    this.reconnectState.delete(id);
    this.connectFailures.delete(id);
    this.connectRetryAfter.delete(id);
    this.pingUnsupported.delete(id);
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
    const cfg = this.configs.get(serverId);
    // HTTP transport: POST JSON-RPC to url
    if (cfg?.url) return this.rpcHttp(serverId, method, params);
    // stdio transport: send via child process stdin
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

  /** HTTP transport: POST JSON-RPC to the server's URL. */
  private async rpcHttp(serverId: string, method: string, params: unknown): Promise<unknown> {
    const cfg = this.configs.get(serverId)!;
    const id = ++this.rpcId;
    const req: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };
    const timeout = method === "initialize" ? 30_000 : method === "tools/call" ? 60_000 : 15_000;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      // Streamable HTTP: Accept must include both JSON and SSE (MCP 2025-03-26 spec)
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        ...cfg.headers,
      };
      const resp = await fetch(cfg.url, {
        method: "POST",
        headers,
        body: JSON.stringify(req),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${(await resp.text().catch(() => "?")).slice(0, 200)}`);
      // Response can be JSON or SSE (text/event-stream). Parse accordingly.
      const contentType = resp.headers.get("content-type") ?? "";
      if (contentType.includes("text/event-stream")) {
        // SSE: parse data: lines until we find our JSON-RPC response
        const text = await resp.text();
        for (const line of text.split("\n")) {
          const trimmed = line.trim();
          if (trimmed.startsWith("data:")) {
            const json = trimmed.slice(5).trim();
            if (!json) continue;
            try {
              const data = JSON.parse(json) as JsonRpcResponse;
              if (data.id === id) {
                if (data.error) throw new Error(`MCP error ${data.error.code}: ${data.error.message}`);
                return data.result;
              }
            } catch (e) { if (e instanceof SyntaxError) continue; throw e; }
          }
        }
        throw new Error(`MCP SSE: no response for id ${id}`);
      }
      // Plain JSON response
      const data = await resp.json() as JsonRpcResponse;
      if (data.error) throw new Error(`MCP error ${data.error.code}: ${data.error.message}`);
      return data.result;
    } catch (e) {
      if ((e as Error).name === "AbortError") throw new Error(`MCP request "${method}" timed out (${timeout / 1000}s)`);
      throw new Error(`MCP HTTP error: ${(e as Error).message}`);
    }
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

  // ─── Reliability: connect cooldown, reconnect budget, keepalive ─────────

  /** Record a connect failure and arm an exponential-backoff cooldown.
   * `permanent` failures (bad command/auth/url) get the max cooldown so we
   * don't hammer an unrecoverable server. */
  recordConnectFailure(serverId: string, opts: { permanent?: boolean } = {}): void {
    const n = (this.connectFailures.get(serverId) ?? 0) + 1;
    this.connectFailures.set(serverId, n);
    // time: nowWallclock is the sanctioned ms clock (core.time invariant #10).
    // nowMonotonic's real provider returns performance.now()*1000 (µs) which is
    // inconsistent with ms-based deadlines, so wallclock ms is used for cooldowns.
    const base = opts.permanent
      ? _CONNECT_RETRY_MAX_MS
      : Math.min(_CONNECT_RETRY_BASE_MS * (2 ** (n - 1)), _CONNECT_RETRY_MAX_MS);
    this.connectRetryAfter.set(serverId, nowWallclock() + base);
  }

  /** Clear cooldown state after a successful connect. */
  clearConnectFailure(serverId: string): void {
    this.connectFailures.delete(serverId);
    this.connectRetryAfter.delete(serverId);
  }

  /** True while the server is still inside its post-failure cooldown window. */
  connectCooldownActive(serverId: string): boolean {
    const deadline = this.connectRetryAfter.get(serverId);
    if (deadline === undefined) return false;
    if (nowWallclock() >= deadline) {
      this.connectRetryAfter.delete(serverId); // window elapsed — allow another try
      return false;
    }
    return true;
  }

  /** Called on every successful start(): clears the cooldown, consumes one
   * unit of the unproven-reconnect budget, and starts keepalive. */
  private onConnectSuccess(serverId: string): void {
    this.clearConnectFailure(serverId);
    const parked = this.recordUnprovenConnect(serverId);
    if (!parked) this.setupKeepalive(serverId);
  }

  private getReconnectState(serverId: string): ReconnectState {
    let rs = this.reconnectState.get(serverId);
    if (!rs) {
      rs = { sessionProven: false, reconnectRetries: 0, wasParked: false };
      this.reconnectState.set(serverId, rs);
    }
    return rs;
  }

  /** A successful connect that has NOT yet been proven (tool call / keepalive)
   * consumes one unit of the reconnect budget. Once the budget is exhausted the
   * server is parked. Returns true if this call parked the server. */
  recordUnprovenConnect(serverId: string): boolean {
    const rs = this.getReconnectState(serverId);
    if (rs.sessionProven) return false; // proven sessions don't consume budget
    rs.reconnectRetries += 1;
    if (rs.reconnectRetries > _MAX_RECONNECT_RETRIES) {
      this.parkServer(serverId);
      rs.wasParked = true;
      return true;
    }
    return false;
  }

  /** Mark a session proven (successful tool call or keepalive). Resets the
   * reconnect budget and revives a parked server ("revived"). */
  markSessionProven(serverId: string): void {
    const rs = this.getReconnectState(serverId);
    const wasParked = rs.wasParked;
    rs.sessionProven = true;
    rs.reconnectRetries = 0;
    rs.wasParked = false;
    if (wasParked) this.unparkServer(serverId);
  }

  /** Park a server: hide its tools (phase=Parked), stop keepalive, schedule a
   * periodic self-probe. Deliberate internal op — allowUnsafe from any live phase. */
  private parkServer(serverId: string): void {
    this.clearKeepalive(serverId);
    const s = this.servers.get(serverId);
    if (!s || s.phase === "Stopped" || s.phase === "Quarantine" || s.phase === "Parked") return;
    this.servers.set(serverId, transition(s, "Parked", { allowUnsafe: true }));
    this.scheduleParkedProbe(serverId);
  }

  /** Revive a parked server whose session just proved itself. */
  private unparkServer(serverId: string): void {
    const s = this.servers.get(serverId);
    if (!s || s.phase !== "Parked") return;
    this.servers.set(serverId, transition(s, "Healthy", { allowUnsafe: true }));
    this.setupKeepalive(serverId);
  }

  /** Probe a parked server after _PARKED_RETRY_INTERVAL (jittered). */
  private scheduleParkedProbe(serverId: string): void {
    this.clearParkedProbe(serverId);
    const timer = setTimeout(() => {
      this.parkedProbes.delete(serverId);
      void this.parkedProbe(serverId);
    }, jitteredDelay(_PARKED_RETRY_INTERVAL));
    unrefTimer(timer);
    this.parkedProbes.set(serverId, timer);
  }

  private clearParkedProbe(serverId: string): void {
    const t = this.parkedProbes.get(serverId);
    if (t) { clearTimeout(t); this.parkedProbes.delete(serverId); }
  }

  private async parkedProbe(serverId: string): Promise<void> {
    const s = this.servers.get(serverId);
    if (!s || s.phase !== "Parked") return; // revived/stopped elsewhere
    try {
      await this.keepaliveProbe(serverId); // success → markSessionProven → unpark
    } catch {
      // still unproven/dead — stay parked and keep probing
      this.scheduleParkedProbe(serverId);
    }
  }

  /** Keepalive probe: prefer `ping`, fall back to `tools/list` for servers that
   * don't implement ping. A real failure re-throws so the interval handler can
   * trigger reconnect. Success proves the session. */
  async keepaliveProbe(serverId: string): Promise<void> {
    if (this.pingUnsupported.has(serverId)) {
      await this.rpc(serverId, "tools/list", {});
      this.markSessionProven(serverId);
      return;
    }
    try {
      await this.rpc(serverId, "ping", {});
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("Method not found") || msg.includes("not found")) {
        this.pingUnsupported.add(serverId);
        await this.rpc(serverId, "tools/list", {}); // fallback
        this.markSessionProven(serverId);
        return;
      }
      throw err; // real failure → caller triggers reconnect/park
    }
    this.markSessionProven(serverId);
  }

  /** Start a periodic keepalive ping for a server. */
  setupKeepalive(serverId: string, intervalMs: number = _DEFAULT_KEEPALIVE_INTERVAL): void {
    this.clearKeepalive(serverId);
    const interval = Math.max(intervalMs, _MIN_KEEPALIVE_INTERVAL);
    const timer = setInterval(() => {
      void this.keepaliveProbe(serverId).catch(() => {
        // keepalive failed (transport dead / real error) → close, mark failed,
        // arm cooldown, and re-enter the start loop once the window elapses.
        this.clearKeepalive(serverId);
        const proc = this.procs.get(serverId);
        if (proc) { proc.kill(); this.procs.delete(serverId); }
        this.toFailed(serverId, "keepalive probe failed");
        this.recordConnectFailure(serverId);
        this.scheduleReconnect(serverId);
      });
    }, interval);
    unrefTimer(timer);
    this.keepaliveTimers.set(serverId, timer);
  }

  private clearKeepalive(serverId: string): void {
    const t = this.keepaliveTimers.get(serverId);
    if (t) { clearInterval(t); this.keepaliveTimers.delete(serverId); }
  }

  /** Re-enter the start() loop after the cooldown window (single attempt). */
  private scheduleReconnect(serverId: string): void {
    this.clearReconnect(serverId);
    const deadline = this.connectRetryAfter.get(serverId);
    const now = nowWallclock();
    const delay = deadline ? Math.max(deadline - now, 0) : jitteredDelay(_CONNECT_RETRY_BASE_MS);
    const timer = setTimeout(() => {
      this.reconnectTimers.delete(serverId);
      void this.start(serverId).catch(() => {
        /* still failing — cooldown re-armed by start()'s catch; a future
         * trigger (manual connect / supervisor) will retry. Bounded: only one
         * reconnect is scheduled per keepalive failure. */
      });
    }, delay);
    unrefTimer(timer);
    this.reconnectTimers.set(serverId, timer);
  }

  private clearReconnect(serverId: string): void {
    const t = this.reconnectTimers.get(serverId);
    if (t) { clearTimeout(t); this.reconnectTimers.delete(serverId); }
  }

  /** Clear all reliability timers for a server (used by stop()/shutdown). */
  private clearReliabilityTimers(serverId: string): void {
    this.clearKeepalive(serverId);
    this.clearParkedProbe(serverId);
    this.clearReconnect(serverId);
  }
}

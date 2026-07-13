/**
 * @my-agent/acp — Agent Client Protocol bridge (§12.2).
 *
 * Session lineage (a parent agent spawns/relays to an external agent); a bounded
 * AcpEventLedger (replayable); permission relay (triple-gate: the external
 * agent's tool calls route through OUR §7 permission gate, not theirs); external-
 * agent spawn policy + failure modes.
 *
 * The stdio transport speaks a minimal JSON-RPC 2.0 framing (one message per
 * line over the external agent's stdin/stdout):
 *   → {"jsonrpc":"2.0","method":"task/start","params":{"goal":"..."}}
 *   ← {"jsonrpc":"2.0","method":"task/progress","params":{"text":"..."}}
 *   ← {"jsonrpc":"2.0","method":"task/done","params":{"result":"..."}}
 *
 * Source: §12.2 ACP bridge; MyAgents ACP, harness catalog.
 */
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { nowWallclock } from "@my-agent/core";

export type AcpEventKind = "spawn" | "message" | "tool-request" | "tool-result" | "permission" | "terminated";

export interface AcpEvent {
  seq: number;
  sessionId: string;
  kind: AcpEventKind;
  ts: number;
  payload: Record<string, unknown>;
}

/** A lineage node: an external agent spawned within a session tree. */
export interface LineageNode {
  id: string;
  parentId: string | null; // null = root session
  externalAgent: string; // the spawned agent's identifier
  spawnedAt: number;
  terminatedAt?: number;
  status: "spawning" | "running" | "terminated" | "failed";
}

/** A bounded, replayable ledger of ACP events. */
export class AcpEventLedger {
  private events: AcpEvent[] = [];
  private seq = 0;
  constructor(private readonly bound = 10_000) {}

  append(sessionId: string, kind: AcpEventKind, payload: Record<string, unknown>): AcpEvent {
    const ev: AcpEvent = { seq: ++this.seq, sessionId, kind, ts: nowWallclock(), payload };
    this.events.push(ev);
    if (this.events.length > this.bound) this.events = this.events.slice(-this.bound);
    return ev;
  }

  /** Replay from a cursor (seq); returns events with seq > since. */
  replay(since = 0): AcpEvent[] {
    return this.events.filter((e) => e.seq > since);
  }

  eventsOf(sessionId: string): AcpEvent[] {
    return this.events.filter((e) => e.sessionId === sessionId);
  }
}

/** Triple-gate permission relay: an external agent's tool call is authorized by
 * (1) the external agent's own declared surface, (2) OUR §7 permission gate,
 * (3) an explicit human approval for DangerFullAccess. The bridge NEVER trusts
 * the external agent's local permission decision. */
export type PermissionRelayDecision = { allow: true } | { allow: false; gate: 1 | 2 | 3; reason: string };

export function relayPermission(opts: {
  externalAgentAllows: boolean;
  ourGateAllows: boolean;
  requiredMode: string;
  humanApproved: boolean;
}): PermissionRelayDecision {
  if (!opts.externalAgentAllows) {
    return { allow: false, gate: 1, reason: "external agent surface denies the tool" };
  }
  if (!opts.ourGateAllows) {
    return { allow: false, gate: 2, reason: "our §7 permission gate denies the call" };
  }
  if (opts.requiredMode === "DangerFullAccess" && !opts.humanApproved) {
    return { allow: false, gate: 3, reason: "DangerFullAccess requires explicit human approval" };
  }
  return { allow: true };
}

// ---------------------------------------------------------------------------
// Stdio transport: JSON-RPC over a child process's stdin/stdout.
// ---------------------------------------------------------------------------

/** Streamed delegate events produced while a task runs on an external agent. */
export type AcpDelegateEvent =
  | { type: "progress"; text: string }
  | { type: "done"; result: string }
  | { type: "error"; error: string };

/** A task sent to an external agent via {@link AcpBridge.delegate}. */
export interface AcpDelegateTask {
  /** The lineage node id returned by {@link AcpBridge.spawnExternal}. */
  sessionId: string;
  /** The goal the external agent should pursue. */
  goal: string;
}

/** Per-session state for an external agent connected over stdio. */
interface ExternalSession {
  proc: ChildProcess;
  nodeId: string;
  command: string;
  /** Incomplete stdout line buffer (messages are newline-delimited). */
  stdoutBuf: string;
  /** Accumulated stderr (used for crash diagnostics). */
  stderrBuf: string;
  /** Pending delegate events waiting to be consumed. */
  queue: AcpDelegateEvent[];
  /** Wake functions for delegate consumers blocked on the queue. */
  queueWaiters: Array<() => void>;
  /** True once a task/done message has been received. */
  doneReceived: boolean;
  /** True once the child process has exited (or been killed). */
  closed: boolean;
  /** True while a delegate() generator is actively consuming the queue. */
  taskActive: boolean;
}

/** A parsed JSON-RPC notification from the external agent. */
interface AcpWireMessage {
  jsonrpc?: string;
  method?: string;
  params?: Record<string, unknown>;
}

/** The ACP bridge: tracks lineage + relays events/permissions. */
export class AcpBridge {
  readonly ledger = new AcpEventLedger();
  private readonly nodes = new Map<string, LineageNode>();
  private readonly children = new Map<string | null, string[]>();
  /** Issue #2: pending requests awaiting external agent response. */
  private readonly pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  /** Default request timeout in ms. */
  readonly requestTimeoutMs: number;
  /** External stdio sessions keyed by lineage node id. */
  private readonly sessions = new Map<string, ExternalSession>();

  constructor(opts: { requestTimeoutMs?: number } = {}) {
    this.requestTimeoutMs = opts.requestTimeoutMs ?? 60_000;
  }

  /**
   * Issue #2: blocking request to external agent. Returns a Promise that
   * resolves when the external agent calls `respond(requestId, result)`.
   *
   * This is the missing piece for AcpSubagentRunner — gives the bridge a
   * transport-style send/recv API (the lineage tracker had no blocking recv).
   */
  request<T = unknown>(nodeId: string, method: string, params: unknown): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const requestId = randomUUID();
      const timer = setTimeout(() => {
        if (this.pending.has(requestId)) {
          this.pending.delete(requestId);
          reject(new Error(`AcpBridge: request ${requestId} timeout after ${this.requestTimeoutMs}ms`));
        }
      }, this.requestTimeoutMs);
      this.pending.set(requestId, { resolve: resolve as (v: unknown) => void, reject, timer });
      this.ledger.append(nodeId, "message", { requestId, method, params });
    });
  }

  /** Issue #2: external agent responds to a pending request. */
  respond(requestId: string, result: unknown): boolean {
    const p = this.pending.get(requestId);
    if (!p) return false;
    clearTimeout(p.timer);
    this.pending.delete(requestId);
    p.resolve(result);
    return true;
  }

  /** Issue #2: external agent fails a pending request. */
  fail(requestId: string, error: string): boolean {
    const p = this.pending.get(requestId);
    if (!p) return false;
    clearTimeout(p.timer);
    this.pending.delete(requestId);
    p.reject(new Error(error));
    return true;
  }

  /** Number of pending requests (for observability/tests). */
  get pendingCount(): number {
    return this.pending.size;
  }

  spawn(parentId: string | null, externalAgent: string): LineageNode {
    const node: LineageNode = {
      id: randomUUID(),
      parentId,
      externalAgent,
      spawnedAt: nowWallclock(),
      status: "running",
    };
    this.nodes.set(node.id, node);
    const sibs = this.children.get(parentId) ?? [];
    sibs.push(node.id);
    this.children.set(parentId, sibs);
    this.ledger.append(node.id, "spawn", { externalAgent, parentId });
    return node;
  }

  /**
   * Terminate a lineage node. When the node is an external stdio session, the
   * underlying child process is killed (SIGTERM) and any in-flight delegate is
   * surfaced an error event. The `status` argument is optional for callers that
   * only need the external-kill behaviour (e.g. `terminate(sessionId)`).
   */
  terminate(nodeId: string, status: "terminated" | "failed" = "terminated"): void {
    const session = this.sessions.get(nodeId);
    if (session) {
      this.killSession(session, "session terminated by caller");
    }
    const node = this.nodes.get(nodeId);
    if (!node) return;
    node.status = status;
    node.terminatedAt = nowWallclock();
    this.ledger.append(nodeId, "terminated", { status });
  }

  /** External agent requests a tool call — relayed through the triple gate. */
  requestTool(nodeId: string, tool: string, args: unknown, perms: Parameters<typeof relayPermission>[0]): PermissionRelayDecision {
    const decision = relayPermission(perms);
    this.ledger.append(nodeId, "tool-request", { tool, args, allow: decision.allow });
    return decision;
  }

  lineage(rootId: string): LineageNode[] {
    const out: LineageNode[] = [];
    const walk = (id: string | null) => {
      for (const childId of this.children.get(id) ?? []) {
        const n = this.nodes.get(childId);
        if (n) out.push(n);
        walk(childId);
      }
    };
    walk(rootId);
    return out;
  }

  get(id: string): LineageNode | undefined {
    return this.nodes.get(id);
  }

  // -------------------------------------------------------------------------
  // External-agent stdio transport.
  // -------------------------------------------------------------------------

  /**
   * Spawn an external agent as a child process and perform the ACP handshake.
   * The handshake resolves once the child has actually started (Node emits the
   * "spawn" event) and the stdin/stdout/stderr pipes are connected. A spawn
   * failure (missing binary, etc.) rejects and records a `failed` lineage node.
   *
   * @returns the new lineage node; its `id` is the sessionId used by
   *   {@link AcpBridge.delegate} / {@link AcpBridge.terminate}.
   */
  async spawnExternal(
    parentId: string | null,
    command: string,
    args: string[] = [],
    opts: { cwd?: string; env?: Record<string, string> } = {},
  ): Promise<LineageNode> {
    const spawnOpts: SpawnOptions = {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: opts.cwd,
      env: opts.env ? { ...process.env, ...opts.env } : undefined,
    };

    let proc: ChildProcess;
    try {
      proc = spawn(command, args, spawnOpts);
    } catch (err) {
      throw new Error(`AcpBridge: spawn failed for "${command}": ${(err as Error).message}`);
    }

    const node = this.spawn(parentId, `external:${command}`);
    node.status = "spawning";

    const session: ExternalSession = {
      proc,
      nodeId: node.id,
      command,
      stdoutBuf: "",
      stderrBuf: "",
      queue: [],
      queueWaiters: [],
      doneReceived: false,
      closed: false,
      taskActive: false,
    };

    // Handshake: resolve on "spawn", reject on the first "error" before spawn.
    let handshakeSettled = false;
    const handshake = new Promise<void>((resolve, reject) => {
      const onSpawn = (): void => {
        if (handshakeSettled) return;
        handshakeSettled = true;
        resolve();
      };
      const onHandshakeError = (err: Error): void => {
        if (handshakeSettled) return;
        handshakeSettled = true;
        reject(new Error(`AcpBridge: ACP handshake failed for "${command}": ${err.message}`));
      };
      proc.once("spawn", onSpawn);
      proc.once("error", onHandshakeError);
    });

    this.sessions.set(node.id, session);
    this.attachSessionHandlers(session);

    try {
      await handshake;
    } catch (err) {
      this.killSession(session, "handshake failed");
      node.status = "failed";
      node.terminatedAt = nowWallclock();
      this.ledger.append(node.id, "terminated", { status: "failed", error: (err as Error).message });
      throw err;
    }

    node.status = "running";
    return node;
  }

  /**
   * Send a task to an external agent and stream its response. Emits
   * `progress` events as they arrive and a final `done` (success) or `error`
   * (crash / unexpected exit / caller-terminated) event. One task may be in
   * flight per session at a time.
   */
  async *delegate(task: AcpDelegateTask): AsyncIterable<AcpDelegateEvent> {
    const session = this.sessions.get(task.sessionId);
    if (!session) {
      throw new Error(`AcpBridge: unknown session ${task.sessionId}`);
    }
    if (session.taskActive) {
      throw new Error(`AcpBridge: a task is already in flight for session ${task.sessionId}`);
    }
    if (session.closed || session.proc.stdin == null) {
      throw new Error(`AcpBridge: session ${task.sessionId} is closed`);
    }

    session.taskActive = true;
    session.queue.length = 0;
    session.doneReceived = false;

    const payload =
      JSON.stringify({ jsonrpc: "2.0", method: "task/start", params: { goal: task.goal } }) + "\n";
    try {
      session.proc.stdin.write(payload);
    } catch (err) {
      session.taskActive = false;
      throw new Error(`AcpBridge: failed to send task/start: ${(err as Error).message}`);
    }
    this.ledger.append(session.nodeId, "message", { direction: "out", method: "task/start", goal: task.goal });

    try {
      while (true) {
        // Drain anything queued.
        while (session.queue.length > 0) {
          const ev = session.queue.shift();
          if (ev === undefined) break;
          yield ev;
          if (ev.type === "done" || ev.type === "error") {
            return;
          }
        }
        if (session.closed) {
          // Child gone with nothing else queued.
          yield {
            type: "error",
            error: session.stderrBuf.trim() || "external agent closed without task/done",
          };
          return;
        }
        // Wait for the next event.
        await new Promise<void>((resolve) => {
          session.queueWaiters.push(resolve);
        });
      }
    } finally {
      session.taskActive = false;
      session.queue.length = 0;
    }
  }

  /** True if an external stdio session exists for this node and is tracked. */
  hasExternalSession(nodeId: string): boolean {
    return this.sessions.has(nodeId);
  }

  /** OS pid of the external agent for `nodeId`, or undefined if no session. */
  sessionPid(nodeId: string): number | undefined {
    return this.sessions.get(nodeId)?.proc.pid;
  }

  // -------------------------------------------------------------------------
  // Internal helpers.
  // -------------------------------------------------------------------------

  private attachSessionHandlers(session: ExternalSession): void {
    const { proc } = session;

    proc.stdout?.setEncoding("utf8");
    proc.stdout?.on("data", (chunk: string) => {
      session.stdoutBuf += chunk;
      let nl: number;
      while ((nl = session.stdoutBuf.indexOf("\n")) >= 0) {
        const line = session.stdoutBuf.slice(0, nl).trim();
        session.stdoutBuf = session.stdoutBuf.slice(nl + 1);
        if (line.length === 0) continue;
        this.dispatchLine(session, line);
      }
    });

    proc.stderr?.setEncoding("utf8");
    proc.stderr?.on("data", (chunk: string) => {
      session.stderrBuf += chunk;
    });

    proc.on("error", (err: Error) => {
      // Post-handshake runtime error (handshake errors are handled in spawnExternal).
      if (!session.closed) {
        session.closed = true;
        if (session.taskActive && !session.doneReceived) {
          session.queue.push({ type: "error", error: `external agent error: ${err.message}` });
        }
        this.wakeWaiters(session);
      }
    });

    proc.once("close", (code: number | null, signal: NodeJS.Signals | null) => {
      if (session.closed) return;
      session.closed = true;
      if (session.taskActive && !session.doneReceived) {
        const reason = code !== null ? `exit code ${code}` : `signal ${signal ?? "unknown"}`;
        const detail = session.stderrBuf.trim();
        session.queue.push({
          type: "error",
          error: `external agent closed (${reason})${detail ? `: ${detail}` : ""}`,
        });
      }
      this.wakeWaiters(session);
    });
  }

  private dispatchLine(session: ExternalSession, line: string): void {
    let msg: AcpWireMessage;
    try {
      msg = JSON.parse(line) as AcpWireMessage;
    } catch {
      this.ledger.append(session.nodeId, "message", { direction: "in", raw: line, parseError: true });
      return;
    }

    const params = msg.params ?? {};
    if (msg.method === "task/progress" && typeof params["text"] === "string") {
      session.queue.push({ type: "progress", text: params["text"] });
      this.ledger.append(session.nodeId, "message", { direction: "in", method: "task/progress" });
      this.wakeWaiters(session);
    } else if (msg.method === "task/done" && typeof params["result"] === "string") {
      session.doneReceived = true;
      session.queue.push({ type: "done", result: params["result"] });
      this.ledger.append(session.nodeId, "message", { direction: "in", method: "task/done" });
      this.wakeWaiters(session);
    } else {
      this.ledger.append(session.nodeId, "message", {
        direction: "in",
        method: msg.method ?? "unknown",
      });
    }
  }

  private wakeWaiters(session: ExternalSession): void {
    const waiters = session.queueWaiters;
    session.queueWaiters = [];
    for (const w of waiters) {
      try {
        w();
      } catch {
        /* a waiter throwing should not break the others */
      }
    }
  }

  /** Kill the child, remove the session, and unblock any consumer. */
  private killSession(session: ExternalSession, reason: string): void {
    if (session.taskActive && !session.doneReceived) {
      session.queue.push({ type: "error", error: reason });
    }
    session.closed = true;
    session.doneReceived = true;
    try {
      if (!session.proc.killed) session.proc.kill("SIGTERM");
    } catch {
      /* process may have already exited */
    }
    this.sessions.delete(session.nodeId);
    this.wakeWaiters(session);
  }
}

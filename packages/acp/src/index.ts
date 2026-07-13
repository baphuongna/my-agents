/**
 * @my-agent/acp — Agent Client Protocol bridge (§12.2).
 *
 * Session lineage (a parent agent spawns/relays to an external agent); a bounded
 * AcpEventLedger (replayable); permission relay (triple-gate: the external
 * agent's tool calls route through OUR §7 permission gate, not theirs); external-
 * agent spawn policy + failure modes.
 *
 * Source: §12.2 ACP bridge; MyAgents ACP, harness catalog.
 */
import { randomUUID } from "node:crypto";
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

/** The ACP bridge: tracks lineage + relays events/permissions. */
export class AcpBridge {
  readonly ledger = new AcpEventLedger();
  private readonly nodes = new Map<string, LineageNode>();
  private readonly children = new Map<string | null, string[]>();
  /** Issue #2: pending requests awaiting external agent response. */
  private readonly pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  /** Default request timeout in ms. */
  readonly requestTimeoutMs: number;

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
          reject(new Error(`AcpBridge: request ${requestId} timed out after ${this.requestTimeoutMs}ms`));
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

  terminate(nodeId: string, status: "terminated" | "failed"): void {
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
}

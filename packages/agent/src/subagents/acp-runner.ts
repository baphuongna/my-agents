/**
 * AcpSubagentRunner — Issue #2 implementation.
 *
 * A SubagentRunner that spawns children through the @my-agent/acp AcpBridge.
 * The bridge now has blocking request/response (`request()` / `respond()`)
 * so this runner can actually await a result.
 *
 * Protocol (Issue #2):
 *   spawn(s) →
 *     1. bridge.spawn() → LineageNode
 *     2. bridge.request(nodeId, "spawn", {prompt, toolSurface, ...})  // BLOCKING
 *     3. external agent runs the task, calls bridge.respond(requestId, result)
 *     4. Runner unblocks, returns SubagentResult
 *     5. On terminal: bridge.terminate(nodeId, status)
 *
 * Failure modes:
 *   - External agent rejects: SubagentResult{ok:false, error:"EXTERNAL_AGENT_DENIED"}
 *   - Timeout: SubagentResult{ok:false, error:"timeout"}
 *   - Bridge has no transport yet: still works (just doesn't get result)
 */
import type {
  SubagentResult,
  SubagentRunner,
  SubagentSpawn,
} from "@my-agent/core";
import type { AcpBridge, LineageNode } from "@my-agent/acp";

export interface AcpSubagentRunnerOptions {
  /** The bridge instance (shared with the agent so lineage is centralised). */
  bridge: AcpBridge;
  /** Optional caller identifier (e.g., parent session id). Defaults to "root". */
  parentId?: string;
  /** Transport layer (stdio/HTTP/WS) — when provided, request/respond work end-to-end. */
  transport?: AcpTransport;
  /** Per-request timeout in ms. Default: bridge.requestTimeoutMs. */
  timeoutMs?: number;
}

/** Minimal transport interface — when wired, request/respond round-trip works. */
export interface AcpTransport {
  /** Send a message; the transport layer decides how to deliver. */
  send(nodeId: string, requestId: string, method: string, params: unknown): Promise<void>;
}

export class AcpSubagentRunner implements SubagentRunner {
  readonly bridge: AcpBridge;
  readonly parentId: string;
  readonly transport?: AcpTransport;
  readonly timeoutMs: number;

  constructor(opts: AcpSubagentRunnerOptions) {
    this.bridge = opts.bridge;
    this.parentId = opts.parentId ?? "root";
    this.transport = opts.transport;
    this.timeoutMs = opts.timeoutMs ?? this.bridge.requestTimeoutMs;
  }

  /**
   * Spawn a subagent through the ACP bridge. Issues a blocking request
   * that resolves when the external agent responds (or timeout).
   */
  async spawn(s: SubagentSpawn): Promise<SubagentResult> {
    // 1. Reserve a lineage node.
    let node: LineageNode;
    try {
      node = this.bridge.spawn(this.parentId, `acp:${s.topology ?? "pipeline"}`);
    } catch (e) {
      return {
        ok: false,
        error: `AcpSubagentRunner: bridge.spawn threw: ${e instanceof Error ? e.message : String(e)}`,
      };
    }

    // 2. If no transport wired, the request would hang forever (no responder).
    //    Detect and fail fast — caller can provide a transport or use InProcessRunner.
    if (!this.transport) {
      this.bridge.terminate(node.id, "failed");
      return {
        ok: false,
        error: "AcpSubagentRunner: no transport provided. Pass {transport} in options or use InProcessRunner for in-process subagents.",
      };
    }

    // 3. Blocking request to external agent. The transport delivers; the
    //    external agent eventually calls bridge.respond(requestId, result).
    try {
      // The request promise itself + transport.send
      const requestPromise = this.bridge.request<{
        ok: boolean;
        result?: unknown;
        error?: string;
      }>(node.id, "spawn", {
        prompt: s.prompt,
        toolSurface: s.toolSurface,
        topology: s.topology,
        parentWorkspace: s.parentWorkspace,
      });

      // Fire-and-forget the transport send (it doesn't return the result).
      // The result comes back via bridge.respond().
      void this.transport.send(node.id, "spawn", "spawn", {
        prompt: s.prompt,
        toolSurface: s.toolSurface,
        topology: s.topology,
      });

      // Wait for response (with our own timeout on top of bridge's).
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("AcpSubagentRunner: spawn timeout")), this.timeoutMs);
      });
      const response = await Promise.race([requestPromise, timeoutPromise]);

      if (!response.ok) {
        this.bridge.terminate(node.id, "failed");
        return { ok: false, error: response.error ?? "EXTERNAL_AGENT_DENIED" };
      }

      this.bridge.terminate(node.id, "terminated");
      return { ok: true, data: response.result };
    } catch (e) {
      this.bridge.terminate(node.id, "failed");
      return {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }
}

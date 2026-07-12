/**
 * AcpSubagentRunner — Phase 4 / Impl-A.
 *
 * A SubagentRunner that spawns children through the @my-agent/acp AcpBridge so
 * external agents can participate as subagents with the triple-gate permission
 * relay (§12.2).
 *
 * PROTOCOL NOTE (Phase 4 / Impl-A): the shipped AcpBridge (packages/acp/src/index.ts)
 * exposes only stateful tracking — `spawn(parentId, externalAgent) → LineageNode`,
 * `requestTool(nodeId, tool, args, perms) → PermissionRelayDecision`, `terminate`,
 * `lineage`, `get`. There is NO blocking `recv()` / `send()` channel that returns
 * a terminal event; the bridge is a lineage tracker, not a transport adapter.
 *
 * Mapping AcpBridge onto SubagentResult requires either:
 *   (1) a transport adapter the bridge calls out to (stdio/HTTP), OR
 *   (2) a buffered replay ledger poll loop on `ledger.replay(node.spawnedAtSeq)`.
 *
 * Both options belong in a Tier-2 integration PR (transport + timeout policy).
 * Within this scope, the integration cannot be cleanly closed: spawn() returns
 * SubagentResult{ok:false, error:"AcpSubagentRunner: bridge protocol mismatch — escalate"}
 * AND logs a WARN. Caller can detect the error string and decide how to react.
 *
 * The class is exported so once the bridge gains the transport channel, the
 * integration is a one-method rewrite (`spawn()` body).
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
  /** Reserved for the future transport integration (Tier 2). Currently unused. */
  transport?: unknown;
}

/** Result-shape used internally for the protocol-mismatch error path. */
export type AcpSubagentRunnerError =
  | "PROTOCOL_MISMATCH"
  | "EXTERNAL_AGENT_DENIED";

/**
 * AcpSubagentRunner — Tier-2 stub with documented fail-fast behaviour.
 *
 * Until the AcpBridge exposes a blocking transport channel, every spawn() call
 * returns a protocol-mismatch error. This is intentional: silently swallowing
 * the gap would mask a real cross-package integration issue.
 */
export class AcpSubagentRunner implements SubagentRunner {
  readonly bridge: AcpBridge;
  readonly parentId: string;

  constructor(opts: AcpSubagentRunnerOptions) {
    this.bridge = opts.bridge;
    this.parentId = opts.parentId ?? "root";
  }

  /**
   * Spawn a subagent through the ACP bridge. Phase 4 / Impl-A ships in a
   * transport-less state — see PROTOCOL NOTE above. The interface IS wired
   * so the upcoming Tier-2 PR is drop-in.
   */
  async spawn(s: SubagentSpawn): Promise<SubagentResult> {
    // 1. Reserve a lineage node (so callers can observe the attempt).
    let node: LineageNode;
    try {
      node = this.bridge.spawn(this.parentId, `acp:${s.topology ?? "pipeline"}`);
    } catch (e) {
      return {
        ok: false,
        error: `AcpSubagentRunner: bridge.spawn threw: ${e instanceof Error ? e.message : String(e)}`,
      };
    }

    // 2. Emit a console warning so protocol gaps are visible in CI logs.
    //    (Single line, structured so log scrapers can grep for it.)
    // eslint-disable-next-line no-console
    console.warn(
      `[acp-subagent-runner] WARN protocol-mismatch: AcpBridge has no transport channel; ` +
        `lineage node=${node.id} created but no result will be awaited. ` +
        `SubagentResult will return PROTOCOL_MISMATCH. Escalate to Tier-2 integration PR.`,
    );

    // 3. Mark the node failed so the lineage ledger reflects the truth.
    this.bridge.terminate(node.id, "failed");

    // 4. Fail-closed: return the documented mismatch error.
    return {
      ok: false,
      error: "AcpSubagentRunner: bridge protocol mismatch — escalate",
    };
  }
}

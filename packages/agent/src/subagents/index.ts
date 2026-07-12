/**
 * @my-agent/subagents — SubagentRunner + topologies + CoW isolation (§10).
 *
 * Tier 1: in-process runner with tool-surface restriction + budget tree
 * (deriveChild/releasePrecharge — CC2). CoW overlay isolation (changedPaths
 * diff) lands Tier 2 via createIsolatedWorkspace (file_copy fallback; real
 * overlay/reflink via natives Tier 3+).
 *
 * Phase 4 (Impl-A): AcpSubagentRunner wraps the @my-agent/acp AcpBridge so
 * that the agent can spawn external agents (subagents) via ACP messages. The
 * current AcpBridge API is a stateful session/lineage tracker — it does NOT
 * expose a blocking recv/send round-trip that yields a terminal result. Until
 * the bridge gains that channel, spawn() FAILS-FAST with a documented protocol
 * mismatch (see AcpSubagentRunner below). The interface is exported so the
 * Tier-2 integration is a drop-in replacement once the bridge adds a transport.
 */

export { InProcessRunner, fanOutFanIn, TOPOLOGIES, validateSchema } from "./runner.js";
export type { InProcessRunnerOptions, RestrictedToolExecutorFactory } from "./runner.js";
export { createIsolatedWorkspace } from "./isolation.js";
export type { IsolatedWorkspace, IsoBackend, MergeResult, ConflictError } from "./isolation.js";
export { verifyGreen, scopeSatisfies } from "./green.js";
export type { GreenLevel, GreenContract, GreenEvidence, GreenVerifyResult, TestScope } from "./green.js";
export { AcpSubagentRunner } from "./acp-runner.js";
export type { AcpSubagentRunnerOptions } from "./acp-runner.js";


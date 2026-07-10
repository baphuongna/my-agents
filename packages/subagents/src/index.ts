/**
 * @my-agent/subagents — SubagentRunner + topologies (§10).
 *
 * Tier 1: in-process runner with tool-surface restriction + budget tree
 * (deriveChild/releasePrecharge — CC2). CoW overlay isolation (changedPaths
 * diff) lands Tier 2 via natives.
 */
export { InProcessRunner, fanOutFanIn, TOPOLOGIES } from "./runner.js";
export type { InProcessRunnerOptions, RestrictedToolExecutorFactory } from "./runner.js";

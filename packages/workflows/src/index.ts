/**
 * @my-agent/workflows — sandboxed JS workflow runner (§25).
 *
 * Workflow = JS file exporting `module.exports.default = async (ctx) => ...`.
 * Runs in a Node `vm` sandbox with a frozen, restricted context (no fs/net/
 * child_process). Used for cron jobs, SOP scripts, skill-driven workflows.
 */
export { runWorkflow, runWorkflowIsolated } from "./runner.js";
export type { WorkflowContext } from "./runner.js";
export { evalRhai } from "./rhai-runner.js";
export type { RhaiResult, RhaiEvent, RhaiOptions } from "./rhai-runner.js";
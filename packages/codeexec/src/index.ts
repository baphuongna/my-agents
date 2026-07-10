/**
 * @my-agent/codeexec — bidirectional code-exec bridge (§11.4).
 *
 * A `code` tool: runs JS (node) or Python with a `tool(name, args)` helper that
 * round-trips into the agent's tool registry over a stdin/stdout JSON-RPC line
 * protocol. Bounded by timeout + max-call cap.
 */
export { makeCodeExecTool } from "./bridge.js";

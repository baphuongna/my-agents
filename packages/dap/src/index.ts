/**
 * @my-agent/dap — Debug Adapter Protocol client (§11.2).
 *
 * DapClient: stdio JSON-RPC over Content-Length framing. launch/attach,
 * setBreakpoints, continue/next/stepIn/stepOut, threads/stackTrace/scopes/
 * variables/evaluate. EventEmitter for stopped/continued/output/breakpoint/
 * terminated/exited. Full DAP event coverage lands Tier 4.
 */
export { DapClient } from "./client.js";
export type { DapClientOptions, DapBreakpoint, DapStackFrame, DapScope, DapVariable, DapStoppedEvent, DapSource } from "./client.js";
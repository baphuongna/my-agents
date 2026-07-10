/**
 * @my-agent/channels — hook registry + MCP lifecycle (§12).
 *
 * HookRegistry (priority-ordered, isolated execution) + McpServer FSM (11
 * phases, aggregate health, available-tools projection).
 */
export { HookRegistry } from "./hooks.js";
export type { HookName, HookPayload, HookHandler, HookRecord } from "./hooks.js";
export { transition, aggregateHealth, availableTools } from "./mcp-lifecycle.js";
export type { McpServer, McpPhase } from "./mcp-lifecycle.js";
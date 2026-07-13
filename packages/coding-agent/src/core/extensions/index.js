/**
 * Extension system for lifecycle events and custom tools.
 */
export { createExtensionRuntime, discoverAndLoadExtensions, loadExtensionFromFactory, loadExtensions, } from "./loader.ts";
export { ExtensionRunner } from "./runner.ts";
// Type guards
export { defineTool, isBashToolResult, isEditToolResult, isFindToolResult, isGrepToolResult, isLsToolResult, isReadToolResult, isToolCallEventType, isWriteToolResult, } from "./types.ts";
export { wrapRegisteredTool, wrapRegisteredTools } from "./wrapper.ts";
//# sourceMappingURL=index.js.map
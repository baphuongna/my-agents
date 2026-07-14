/**
 * @my-agent/tools — tool registry + permission gate + dispatch + repair + builtins (§7).
 *
 * The agent can ACT: read/write/edit/bash/glob/grep. Tools are mode-gated;
 * the permission pipeline (deny → mode-rank → human approval) runs before exec.
 */
export { ToolRegistry, ok, err, isRecord, modeSatisfies } from "./registry.js";
export type { ToolImpl } from "./registry.js";
export { requiresApproval, awaitHumanPrompt, parseRule, extractSubject, ruleMatches } from "./permission.js";
export type { PermissionResult } from "./permission.js";
export { runTool, runToolBatch, aggregate } from "./dispatch.js";
export { repair } from "./repair.js";
export type { RepairResult } from "./repair.js";
export { builtinTools, readTool, writeTool, editTool, replaceTool, bashTool, globTool, grepTool, lsTool, findTool } from "./builtin.js";
export { screenCaptureTool, screenFindTool, captureScreen, extractText, findOnScreen } from "./screen.js";
export type { ScreenCapture, ScreenTextRegion } from "./screen.js";
export { browserNavigateTool, browserClickTool, browserTypeTool, browserScreenshotTool, browserExtractTool, browserEvalTool, browserCloseTool, BrowserAutomation } from "./browser.js";
export { lineHashes, formatHashed, replaceByHash, isValidAnchor, fileFingerprint } from "./hashline.js";
export { resolveInsideWorkspace, resolveExistingInsideWorkspace, isInsideWorkspace } from "./path-safety.js";
export type { ResolveMode, ResolveResult } from "./path-safety.js";
export * from "./codegraph.js";
export * from "./symbol-extractor.js";
export * from "./graph-store.js";
export * from "./reference-graph.js";
export * from "./codeexec.js";
export * from "./lsp-client.js";
export * from "./approval.js";
export * from "./tool-search.js";
export * from "./search-index.js";
export { ComposioClient, registerComposioTools, createComposioClient } from "./composio.js";
export type { ComposioConfig, ComposioTool, ConnectedAccount } from "./composio.js";

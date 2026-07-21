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
export { browserNavigateTool, browserSnapshotTool, browserClickTool, browserTypeTool, browserScrollTool, browserBackTool, browserPressTool, browserScreenshotTool, browserSearchTool, browserTools, registerBrowserTools, BROWSER_DESCRIPTIONS } from "./web/browser/index.js";
export { webSearchTool, webExtractTool, searchTools, registerSearchTools, SEARCH_DESCRIPTIONS } from "./web/search/index.js";
export { webFetchTool } from "./web/fetch.js";
// Phase 5 orchestrator + orchestrator-aware host adapters.
export {
  runBrowserWithFallback,
  runSearchWithFallback,
  runExtractWithFallback,
  withResilience,
  loadWebConfig,
  loadWebConfigFromEnv,
  validateWebConfig,
  DEFAULT_WEB_CONFIG,
  WEB_CONFIG_ENV,
  registerWebTools,
  registerFetchTools,
} from "./web/host.js";
export type {
  BrowserToolName,
  SearchToolName,
  OrchestratorArgs,
  OrchestratorCtx,
  TriedStep,
  ResilienceId,
  ResilienceOpt,
  ResilienceAction,
  ResilienceResult,
  ResilienceOk,
  ResilienceErr,
  WebConfig,
  PreferredEngineName,
  SearchBackendName,
  ExtractBackendName,
  MyaHostApi,
} from "./web/host.js";
export { lineHashes, formatHashed, replaceByHash, isValidAnchor, fileFingerprint } from "./hashline.js";
export { computeLineHashes, canon, mapStableHashes, resolveAnchor, applyEdits, saveUndo, getUndo, clearUndo, HASH_LEN, HASH_SEP, HASH_RE } from "./hashline-edit.js";
export type { AnchorResult, HashEdit, NoopEdit, ApplyResult, UndoEntry } from "./hashline-edit.js";
export { resolveInsideWorkspace, resolveExistingInsideWorkspace, isInsideWorkspace } from "./path-safety.js";
export type { ResolveMode, ResolveResult } from "./path-safety.js";
export * from "./codegraph.js";
export * from "./symbol-extractor.js";
export * from "./graph-store.js";
export * from "./reference-graph.js";
export * from "./codeexec.js";
export { osvCheckTool } from "./osv-check.js";
export { urlSafetyTool } from "./url-safety.js";
export { imageGenTool } from "./image-gen.js";
export { videoGenTool } from "./video-gen.js";
export { kanbanTool } from "./kanban.js";
export * from "./lsp-client.js";
export * from "./lsp-cascade.js";
export * from "./approval.js";
export * from "./tool-search.js";
export * from "./search-index.js";
export { ComposioClient, registerComposioTools, createComposioClient } from "./composio.js";
export type { ComposioConfig, ComposioTool, ConnectedAccount } from "./composio.js";
export * from "./output-compress.js";

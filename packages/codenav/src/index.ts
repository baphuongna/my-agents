/**
 * @my-agent/codenav — language intelligence tools (§11).
 *
 * codegraph (§11.3): file-relevance index (NOT call-graph). Builds an import
 * graph + returns files related to a given path. LSP/DAP (§11.1/§11.2) land
 * as separate tools when a language-server integration is wired.
 */
export { buildCodegraph, related, makeCodegraphTool } from "./codegraph.js";
export type { Codegraph } from "./codegraph.js";

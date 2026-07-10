/**
 * @my-agent/lsp — lightweight LSP client (§11.1).
 *
 * LspClient: stdio JSON-RPC over Content-Length framing. Supports initialize,
 * textDocument/didOpen+didChange (diagnostics on write), hover, definition,
 * references. Full workspace symbols + incremental sync land Tier 3.
 */
export { LspClient } from "./client.js";
export type { LspClientOptions, LspDiagnostic, LspHover, LspLocation, LspPosition } from "./client.js";
/**
 * LSP Cascade Diagnostics (Phase 3-4) — impact-cascade diagnostics pipeline.
 *
 * Ported (simplified MVP) from pi-lens's cascade pattern:
 *
 *   1. `computeImpact` — BFS over the import graph (`Codegraph.reverse`) to
 *      find all files that transitively import the changed file (depth 2).
 *   2. `touchFile` — send didOpen/didChange to the LSP client, yield to the
 *      event loop, then collect diagnostics.
 *   3. `runCascade` — compute impact, then fan-out `touchFile` in parallel
 *      (`Promise.allSettled`) across all affected files.
 *
 * Source: pi-lens clients/lsp/index.ts (touchFile), clients/dispatch/integration.ts
 * (cascade orchestration), §11.3 codegraph.
 */
import { extname } from "node:path";
import type { Codegraph } from "./codegraph.js";
import type { LspDiagnostic } from "./lsp-client.js";

/** The import graph used for impact computation. Alias of `Codegraph`. */
export type ReferenceGraph = Codegraph;

/** Simplified diagnostic (0-indexed line/column per LSP convention). */
export interface Diagnostic {
  severity: 1 | 2 | 3 | 4;
  message: string;
  line: number;
  column: number;
  source?: string;
}

/**
 * Minimal LSP client interface for `touchFile`. The real `LspClient` class
 * already satisfies this; tests can pass a lightweight mock.
 */
export interface CascadeLspClient {
  openDocument(uri: string, languageId: string, content: string, version: number): void;
  changeDocument(uri: string, version: number, content: string): void;
  getDiagnostics(uri: string): LspDiagnostic[];
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Strip the extension for a canonical graph key (matches codegraph.canonical). */
function canonical(p: string): string {
  const ext = extname(p);
  return ext ? p.slice(0, p.length - ext.length) : p;
}

/** Convert a file path to a `file://` URI (passes through if already a URI). */
function pathToUri(filePath: string): string {
  if (filePath.startsWith("file://")) return filePath;
  return `file://${filePath}`;
}

/** Infer language ID from file extension. */
function inferLanguageId(filePath: string): string {
  const ext = extname(filePath);
  switch (ext) {
    case ".ts": return "typescript";
    case ".tsx": return "typescriptreact";
    case ".js": return "javascript";
    case ".jsx": return "javascriptreact";
    case ".py": return "python";
    case ".rs": return "rust";
    case ".go": return "go";
    default: return "typescript";
  }
}

/** Map an `LspDiagnostic[]` → `Diagnostic[]` (flatten range to line/column). */
function mapDiagnostics(diags: LspDiagnostic[]): Diagnostic[] {
  return diags.map((d) => ({
    severity: d.severity,
    message: d.message,
    line: d.range.start.line,
    column: d.range.start.character,
    source: d.source,
  }));
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Compute the set of files impacted by a change to `changedFile`.
 *
 * BFS over `graph.reverse` (importers) with a maximum depth of 2.
 * The `changedFile` itself is excluded from the result.
 *
 * @returns array of canonical file paths (extension-stripped) that transitively
 *          import `changedFile`.
 */
export function computeImpact(changedFile: string, graph: ReferenceGraph): string[] {
  const seedKey = canonical(changedFile);
  const visited = new Set<string>([seedKey]);
  const result: string[] = [];
  const MAX_DEPTH = 2;

  // BFS frontiers: depth-0 = {seedKey}, each level is the set of files
  // discovered at that depth.
  let frontier: Set<string> = new Set([seedKey]);

  for (let depth = 1; depth <= MAX_DEPTH; depth++) {
    const nextFrontier = new Set<string>();
    for (const file of frontier) {
      const importers = graph.reverse.get(file);
      if (!importers) continue;
      for (const importer of importers) {
        if (visited.has(importer)) continue;
        visited.add(importer);
        result.push(importer);
        nextFrontier.add(importer);
      }
    }
    frontier = nextFrontier;
    if (frontier.size === 0) break;
  }

  return result;
}

/**
 * Send `didOpen` + `didChange` to the LSP client for `filePath`, then collect
 * diagnostics.
 *
 * Yields to the event loop before reading diagnostics so that async diagnostic
 * events (real `LspClient` via EventEmitter) have a chance to settle. For mock
 * clients that return diagnostics synchronously from `getDiagnostics`, the
 * yield is harmless.
 *
 * @returns mapped diagnostics for the file.
 */
export async function touchFile(
  filePath: string,
  content: string,
  lspClient: CascadeLspClient,
): Promise<Diagnostic[]> {
  const uri = pathToUri(filePath);
  const languageId = inferLanguageId(filePath);
  lspClient.openDocument(uri, languageId, content, 1);
  lspClient.changeDocument(uri, 2, content);
  // Yield to the event loop so diagnostics notifications can be processed.
  await new Promise<void>((resolve) => setImmediate(resolve));
  return mapDiagnostics(lspClient.getDiagnostics(uri));
}

/**
 * Run the full cascade: compute impact set for `changedFile`, then touch every
 * affected file (plus the changed file itself) in parallel.
 *
 * Uses `Promise.allSettled` so one failed touch does not abort the rest.
 * The `content` parameter is used for the changed file; affected files are
 * touched with empty content (they are already open or will be opened fresh).
 *
 * @returns array of `{ file, diagnostics }` for each touched file.
 */
export async function runCascade(
  changedFile: string,
  content: string,
  graph: ReferenceGraph,
  lspClient: CascadeLspClient,
): Promise<Array<{ file: string; diagnostics: Diagnostic[] }>> {
  const affected = computeImpact(changedFile, graph);
  // Include the changed file itself (canonicalized to match graph keys).
  const targets = [canonical(changedFile), ...affected];

  const results = await Promise.allSettled(
    targets.map((file) =>
      touchFile(file, file === changedFile ? content : "", lspClient),
    ),
  );

  const output: Array<{ file: string; diagnostics: Diagnostic[] }> = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const file = targets[i];
    if (file === undefined) continue;
    if (r && r.status === "fulfilled") {
      output.push({ file, diagnostics: r.value });
    }
  }

  return output;
}

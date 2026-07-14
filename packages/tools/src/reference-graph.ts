/**
 * Reference / call graph (Phase B / Gap 5).
 *
 * Given a GraphStore (already populated with Symbols from symbol-extractor),
 * scan each file's source for USE sites of those symbols and emit References.
 *
 * The graph is a two-step pass:
 *
 *   1. `buildReferencePass(graph, file, src)` — scans one file's source and
 *      adds Reference rows to the graph for every detected call/read/write/import
 *      site targeting an already-known symbol.
 *
 *   2. Query helpers (`findDefinitions`, `findReferences`, `getCallGraph`,
 *      `getRelatedFiles`) — pure read over the graph.
 *
 * Resolution policy (MVP): for a bare-name USE site (`foo()`), if multiple
 * symbols share the name we pick the FIRST definition the graph saw
 * (insertion order — the byName index is a Set, which preserves it). Full
 * lexical / module-scope resolution is out of MVP scope (Phase B plan §6).
 */
import { extname, dirname } from "node:path";
import type { GraphStore } from "./graph-store.js";
import type { Symbol, SymbolRange } from "./symbol-extractor.js";

export type ReferenceKind = "call" | "read" | "write" | "import" | "definition";

export interface Reference {
  symbolId: string;
  fromFile: string;
  fromRange: SymbolRange;
  kind: ReferenceKind;
}

/** Identifier-matching regex (TS/JS/Rust/Go/Python all share this subset
 * of identifier shape — language-specific call-site syntax is handled
 * separately). */
const IDENT_RE = /[A-Za-z_$][\w$]*/y;

/** Read site (conservative — declared-without-keyword read after definition).
 * We bound the heuristic to bare identifier occurrences on lines that don't
 * start with a declaration keyword — false positives are tolerable, false
 * negatives must not be silent, hence the bounded set. */
const READ_RE = /(?<![A-Za-z0-9_$.])([A-Za-z_$][\w$]*)\b/g;

/** Write site (let/const/var/mutation by assignment). */
const WRITE_RE = /(?<![A-Za-z0-9_$.])(?:let|const|var)\s+([A-Za-z_$][\w$]*)/g;

/** Import site — TS/JS `from 'spec'`, Rust `use ...`, Python `from x import`. */
const IMPORT_TSJS_RE = /^\s*import\s+[^'"]*['"]([^'"]+)['"]/gm;
const IMPORT_RS_RE = /^\s*(?:pub\s+)?use\s+([A-Za-z_][\w:]*)/gm;
const IMPORT_PY_RE = /^\s*(?:from\s+\S+\s+import\s+|import\s+)([A-Za-z_][\w.]*)/gm;

// ─── Source-pattern-driven reference passes ────────────────────────────────

/** Scan `src` for call sites and add References to `graph`. Returns count
 * of new references added (for tests). */
function scanCallSites(graph: GraphStore, file: string, src: string): number {
  const lines = src.split("\n");
  let added = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const ln = i + 1;
    // Match `name(` with a word boundary on the left. The lookahead `(?=\()`
    // avoids greedy capture of `foo(bar)` where `bar` happens to be a name
    // — we still recurse into identifiers inside the arg list via
    // scanArgCalls() below for simplicity in MVP.
    const re = /(?<![A-Za-z0-9_$.])([A-Za-z_$][\w$]*)\s*(?=\()/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      const name = m[1];
      if (!name) continue;
      // Skip common keywords / built-ins to limit false positives.
      if (isLikelyNotCall(name)) continue;
      const ids = graph.idsByName(name);
      if (ids.length === 0) continue;
      const target = ids[0];
      const col = m.index;
      if (target === undefined) continue;
      graph.addReference({
        symbolId: target,
        fromFile: file,
        fromRange: { start: { line: ln, col }, end: { line: ln, col: col + name.length } },
        kind: "call",
      });
      added++;
    }
  }
  return added;
}

/** Quick guard against matching `if(`, `for(`, etc. */
function isLikelyNotCall(name: string): boolean {
  switch (name) {
    case "if":
    case "for":
    case "while":
    case "switch":
    case "catch":
    case "return":
    case "typeof":
    case "new":
    case "await":
    case "yield":
    case "void":
    case "delete":
    case "throw":
    case "do":
      return true;
    default:
      return false;
  }
}

/** Scan `src` for write sites (let/const/var NAME = ...). For MVP these are
 * deduplicated against declarations by symbol-id; if no matching Symbol
 * exists in the graph we skip — the extractor is the source of truth. */
function scanWriteSites(graph: GraphStore, file: string, src: string): number {
  let added = 0;
  let m: RegExpExecArray | null;
  WRITE_RE.lastIndex = 0;
  while ((m = WRITE_RE.exec(src)) !== null) {
    const name = m[1];
    if (!name) continue;
    const ids = graph.idsByName(name);
    if (ids.length === 0) continue;
    const target = ids[0];
    if (target === undefined) continue;
    const pos = lineColFromIndex(src, m.index);
    graph.addReference({
      symbolId: target,
      fromFile: file,
      fromRange: { start: pos, end: { line: pos.line, col: pos.col + name.length } },
      kind: "write",
    });
    added++;
  }
  return added;
}

function lineColFromIndex(src: string, index: number): { line: number; col: number } {
  let line = 1;
  let col = 0;
  for (let i = 0; i < index && i < src.length; i++) {
    if (src[i] === "\n") {
      line++;
      col = 0;
    } else {
      col++;
    }
  }
  return { line, col };
}

/** Scan for `import` specifier strings; resolve via the same heuristic used
 * by `codegraph.resolveSpecifier` (we duplicate the simple relative form
 * here to keep this module independent). Emit one Reference per specifier
 * when the resolved target file's symbols are known. */
function scanImportSites(graph: GraphStore, file: string, src: string, root?: string): number {
  let added = 0;
  let m: RegExpExecArray | null;
  const ext = extname(file);
  if (ext === ".ts" || ext === ".tsx" || ext === ".js" || ext === ".jsx" || ext === ".mjs" || ext === ".cjs") {
    IMPORT_TSJS_RE.lastIndex = 0;
    while ((m = IMPORT_TSJS_RE.exec(src)) !== null) {
      const spec = m[1];
      if (!spec) continue;
      const resolved = resolveSpec(spec, file);
      if (!resolved) continue;
      // ResolveSpec strips extensions, but symbol-extractor stores files with
      // extensions. Try both forms.
      const ids = lookupFileSymbols(graph, resolved);
      if (ids.length === 0) continue;
      for (const id of ids) {
        const pos = lineColFromIndex(src, m.index);
        graph.addReference({
          symbolId: id,
          fromFile: file,
          fromRange: { start: pos, end: { line: pos.line, col: pos.col + spec.length } },
          kind: "import",
        });
        added++;
      }
    }
    return added;
  }
  if (ext === ".rs") {
    IMPORT_RS_RE.lastIndex = 0;
    while ((m = IMPORT_RS_RE.exec(src)) !== null) {
      const spec = m[1];
      if (!spec) continue;
      const top = spec.split("::")[0] ?? spec;
      const ids = graph.idsByName(top);
      if (ids.length === 0) continue;
      const pos = lineColFromIndex(src, m.index);
      for (const id of ids) {
        graph.addReference({
          symbolId: id,
          fromFile: file,
          fromRange: { start: pos, end: { line: pos.line, col: pos.col + spec.length } },
          kind: "import",
        });
        added++;
      }
    }
    return added;
  }
  if (ext === ".py") {
    IMPORT_PY_RE.lastIndex = 0;
    while ((m = IMPORT_PY_RE.exec(src)) !== null) {
      const spec = m[1];
      if (!spec) continue;
      const top = spec.split(".")[0] ?? spec;
      const ids = graph.idsByName(top);
      if (ids.length === 0) continue;
      const pos = lineColFromIndex(src, m.index);
      for (const id of ids) {
        graph.addReference({
          symbolId: id,
          fromFile: file,
          fromRange: { start: pos, end: { line: pos.line, col: pos.col + spec.length } },
          kind: "import",
        });
        added++;
      }
    }
    return added;
  }
  return added;
}

function resolveSpec(spec: string, importerFile: string): string | null {
  if (!spec.startsWith(".")) return null;
  const dir = dirname(importerFile);
  // Mimic codegraph's `canonical` (extension-stripped). Avoid pulling in
  // the path module — a tiny local join keeps this module dependency-free.
  const joined = (dir === "." ? "" : dir + "/") + spec;
  // Normalize ../ by removing dot pairs.
  const parts = joined.split("/");
  const out: string[] = [];
  for (const p of parts) {
    if (p === "" || p === ".") continue;
    if (p === "..") out.pop();
    else out.push(p);
  }
  // Strip common extensions for an extension-less match.
  const last = out[out.length - 1] ?? "";
  if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(last)) out[out.length - 1] = last.replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, "");
  return out.join("/");
}

/** Resolve a `file` argument back to its on-disk path if `root` is given. */
function fileFullPath(file: string, root?: string): string {
  if (!root) return file;
  return root.endsWith("/") || root.endsWith("\\") ? root + file : `${root}/${file}`;
}

// ─── Public: scan-once over an entire root ─────────────────────────────────

/** Build the reference side of the graph for a single file (already in the
 * graph's symbol map). */
export function buildReferencePass(graph: GraphStore, file: string, src: string, opts: { root?: string } = {}): number {
  let added = 0;
  added += scanCallSites(graph, file, src);
  added += scanWriteSites(graph, file, src);
  added += scanImportSites(graph, file, src, opts.root);
  return added;
}

/** Convenience: read every file (already known to the graph) and run the
 * reference pass. Returns total references added. */
export async function buildReferencesForStore(
  graph: GraphStore,
  root: string,
): Promise<number> {
  const { readFile } = await import("node:fs/promises");
  const files = [...new Set([...graph.byFile.keys()])];
  let total = 0;
  for (const file of files) {
    const full = fileFullPath(file, root);
    let src: string;
    try {
      const fs = await import("node:fs/promises");
      const s = await fs.stat(full).catch(() => null);
      if (!s || !s.isFile() || s.size > 1_048_576) continue;
      src = await readFile(full, "utf8");
    } catch {
      continue;
    }
    total += buildReferencePass(graph, file, src, { root });
  }
  return total;
}

// ─── Query helpers ─────────────────────────────────────────────────────────

/** Find all Symbol definitions matching `name` (case-insensitive). */
export function findDefinitions(graph: GraphStore, name: string): Symbol[] {
  const ids = graph.idsByName(name);
  const out: Symbol[] = [];
  for (const id of ids) {
    const s = graph.get(id);
    if (s) out.push(s);
  }
  return out;
}

/** Find all incoming references to a symbol. */
export function findReferences(graph: GraphStore, symbolId: string): Reference[] {
  return graph.refs.get(symbolId) ?? [];
}

/** Call graph for a function/method: who calls it (callers) and what it calls
 * (callees). Implemented via two passes: `callers` = refs INCOMING with
 * kind='call'; `callees` = walk the definition file's source for outgoing
 * call sites and resolve them back to symbols. For cross-file `callees` we
 * rely on the call-site scan already done by `buildReferencePass`. */
export function getCallGraph(
  graph: GraphStore,
  functionId: string,
): { callers: Symbol[]; callees: Symbol[] } {
  const sym = graph.get(functionId);
  if (!sym) return { callers: [], callees: [] };

  // Callers: incoming refs of kind='call' resolve to caller file → caller symbol.
  const incoming = findReferences(graph, functionId).filter((r) => r.kind === "call");
  const callerSet = new Map<string, Symbol>();
  for (const r of incoming) {
    const callerIds = graph.idsByFile(r.fromFile);
    // Pick the definition in `r.fromFile` whose range encloses `r.fromRange.start.line`.
    let best: Symbol | undefined;
    let bestSpan = Infinity;
    for (const id of callerIds) {
      const s = graph.get(id);
      if (!s) continue;
      if (s.kind !== "function" && s.kind !== "method") continue;
      const startLine = s.range.start.line;
      const endLine = s.range.end.line || startLine;
      if (r.fromRange.start.line >= startLine && r.fromRange.start.line <= endLine) {
        const span = endLine - startLine;
        if (span < bestSpan) {
          best = s;
          bestSpan = span;
        }
      }
    }
    if (best && best.id !== sym.id && !callerSet.has(best.id)) callerSet.set(best.id, best);
  }

  // Callees: outgoing calls from `sym.file` resolved through graph.idsByName.
  const outgoing = findOutgoingCalls(graph, sym);
  const calleeSet = new Map<string, Symbol>();
  for (const c of outgoing) {
    if (!calleeSet.has(c.id)) calleeSet.set(c.id, c);
  }

  return { callers: [...callerSet.values()], callees: [...calleeSet.values()] };
}

function findOutgoingCalls(graph: GraphStore, sym: Symbol): Symbol[] {
  const out: Symbol[] = [];
  // Take refs from this symbol's file that originate AFTER sym's start line and
  // BEFORE sym's end line. Conservative — handles when symbol spans exactly one
  // line via the fall-through (between start and start+1).
  const fromFileRefs: Reference[] = [];
  for (const list of graph.refs.values()) {
    for (const r of list) if (r.fromFile === sym.file) fromFileRefs.push(r);
  }
  for (const r of fromFileRefs) {
    if (r.kind !== "call") continue;
    if (r.fromRange.start.line < sym.range.start.line) continue;
    if (sym.range.end.line > sym.range.start.line && r.fromRange.start.line > sym.range.end.line) continue;
    const target = graph.get(r.symbolId);
    if (target && target.id !== sym.id) out.push(target);
  }
  return out;
}

/** Files related to `filePath` via shared symbols (definitions in `filePath`
 * referenced from somewhere, or references INTO `filePath`'s symbols from
 * somewhere). Returns the union, deduplicated, excluding `filePath` itself.
 * Tries both with-extension and extension-stripped forms. */
export function getRelatedFiles(graph: GraphStore, filePath: string): string[] {
  const ids = lookupFileSymbols(graph, filePath);
  const set = new Set<string>();
  // Outgoing: any reference whose target was defined here → referenced-from files.
  for (const id of ids) {
    const refs = graph.refs.get(id) ?? [];
    for (const r of refs) {
      if (r.fromFile && r.fromFile !== filePath) set.add(r.fromFile);
    }
  }
  // Incoming: any reference whose fromFile equals us → target-defined-in files.
  for (const list of graph.refs.values()) {
    for (const r of list) {
      if (r.fromFile !== filePath) continue;
      const target = graph.get(r.symbolId);
      if (target && target.file !== filePath) set.add(target.file);
    }
  }
  return [...set].sort();
}

/** Look up symbols by file path, trying both with and without common
 * extensions (`.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.py`, `.rs`,
 * `.go`). The codegraph file-relevance index is extension-stripped, while
 * the symbol-extractor keeps extensions — this bridge function lets either
 * caller pass either form. */
function lookupFileSymbols(graph: GraphStore, filePath: string): string[] {
  const direct = graph.idsByFile(filePath);
  if (direct.length > 0) return direct;
  const hasExt = /\.(ts|tsx|js|jsx|mjs|cjs|py|rs|go)$/.test(filePath);
  if (!hasExt) {
    // No extension: try appending for each candidate.
    for (const ext of [".ts", ".tsx", ".js", ".mjs", ".py", ".rs", ".go"]) {
      const ids = graph.idsByFile(filePath + ext);
      if (ids.length > 0) return ids;
    }
    return [];
  }
  return graph.idsByFile(filePath.replace(/\.(ts|tsx|js|jsx|mjs|cjs|py|rs|go)$/, ""));
}

// Convenience: silence unused-import warning for IDENT_RE (kept as API for
// future tokenization work).
void IDENT_RE;

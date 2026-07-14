/**
 * Symbol extraction (Phase B / Gap 5).
 *
 * Layers:
 *   1. TS/JS/TSX/JSX/MJS/CJS → `nativeParseTsSymbols` (Rust tree-sitter when
 *      the `.node` is loaded; otherwise JS-regex fallback) for
 *      function/class/method/arrow kinds.
 *   2. TS/JS declaration regex pass for variable / type / import (not emitted
 *      by the native bridge per crate/src/parse.rs).
 *   3. Rust / Python / Go via per-language regex extractors (MVP; tree-sitter
 *      grammars deferred per the Phase B plan).
 *
 * All call-sites co-exist in one `extractSymbols` that accepts a file path and
 * optional source text (skipping the disk read when given).
 */
import { createRequire } from "node:module";
import { readFile, stat } from "node:fs/promises";
import { extname, relative } from "node:path";
import { nativeParseTsSymbols, type AstSymbol } from "@my-agent/natives";

/** Symbol kinds per the Phase B spec (§11.3). Note: the underlying native
 * emits `arrow` only; we coerce it to `variable` when the declaration has a
 * `const`/`let`/`var` keyword on the same line (see `tsjsDeclarations`). */
export type SymbolKind =
  | "function"
  | "class"
  | "method"
  | "variable"
  | "type"
  | "import";

export interface RangePos {
  line: number; // 1-indexed
  col: number;  // 0-indexed
}

export interface SymbolRange {
  start: RangePos;
  end: RangePos;
}

export interface Symbol {
  /** Stable id — `${file}:${startLine}:${startCol}:${name}`. Re-extracting
   * the same source produces the same ids. */
  id: string;
  name: string;
  kind: SymbolKind;
  /** Repo-relative file path. Empty string when `extractSymbols` was called
   * without a `root` and a relative path. */
  file: string;
  range: SymbolRange;
  /** Id of the enclosing class/function (methods / nested classes). */
  parentId?: string;
}

// ─── TS/JS via native bridge + declaration regex ───────────────────────────

const TSJS_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

/** Map a native `AstSymbol` (which is line-only and 4-kind) into the richer
 * Symbol type. The `arrow` kind is re-classified based on whether the line
 * starts with `const|let|var` → keeps `arrow` semantics but our enum
 * collapses arrow→`function` (variable-binding forms are captured separately
 * by the declaration regex pass). */
function fromNative(
  ast: AstSymbol,
  file: string,
  src: string,
): Symbol | null {
  if (!ast.name) return null;
  const startLine = ast.startLine;
  const lineText = src.split("\n")[startLine - 1] ?? "";
  const col = leadingCol(lineText);
  const kind: SymbolKind =
    ast.kind === "function"
      ? "function"
      : ast.kind === "class"
        ? "class"
        : ast.kind === "method"
          ? "method"
          : "function"; // arrow → function (binding variants captured below)
  const id = `${file}:${startLine}:${col}:${ast.name}`;
  return {
    id,
    name: ast.name,
    kind,
    file,
    range: {
      start: { line: startLine, col },
      end: { line: ast.endLine, col: 0 },
    },
  };
}

/** Regex table for kind=variable/type/import declarations in TS/JS. The four
 * native kinds (function/class/method/arrow) are handled by `fromNative`; we
 * cover the rest of the spec enum here. */
function tsjsDeclarations(src: string, file: string): Symbol[] {
  const out: Symbol[] = [];
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const ln = i + 1;
    const col = leadingCol(line);
    // type T = ...
    let m = /^\s*(?:export\s+|declare\s+)*type\s+([A-Za-z_$][\w$]*)\b/.exec(line);
    if (m && m[1]) {
      out.push({ id: `${file}:${ln}:${col}:${m[1]}`, name: m[1], kind: "type", file, range: { start: { line: ln, col }, end: { line: ln, col: col + line.length } } });
      continue;
    }
    // interface I — collapse to "type"
    m = /^\s*(?:export\s+|declare\s+)*interface\s+([A-Za-z_$][\w$]*)\b/.exec(line);
    if (m && m[1]) {
      out.push({ id: `${file}:${ln}:${col}:${m[1]}`, name: m[1], kind: "type", file, range: { start: { line: ln, col }, end: { line: ln, col: col + line.length } } });
      continue;
    }
    // const/let/var NAME = expression (skip arrow-fn case: handled by native).
    m = /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=[^=>]/.exec(line);
    if (m && m[1]) {
      out.push({ id: `${file}:${ln}:${col}:${m[1]}`, name: m[1], kind: "variable", file, range: { start: { line: ln, col }, end: { line: ln, col: col + line.length } } });
      continue;
    }
    // import { a, b } from "x"  OR  import a from "x"
    m = /^\s*import\s+(?:\{([^}]+)\}\s+from\s+|([A-Za-z_$][\w$]*)\s+from\s+)/.exec(line);
    if (m) {
      if (m[1]) {
        // named imports — emit one Symbol per name (comma-split, trim).
        const names = m[1].split(",").map((s) => s.trim().split(/\s+as\s+/)[0] ?? "").filter(Boolean);
        for (const n of names) {
          out.push({ id: `${file}:${ln}:${col}:${n}`, name: n, kind: "import", file, range: { start: { line: ln, col }, end: { line: ln, col: col + line.length } } });
        }
      } else if (m[2]) {
        out.push({ id: `${file}:${ln}:${col}:${m[2]}`, name: m[2], kind: "import", file, range: { start: { line: ln, col }, end: { line: ln, col: col + line.length } } });
      }
      continue;
    }
  }
  return out;
}

/** Build a leading-column cache per line. We pre-compute rather than calling
 * `leadingCol` per match for the common case; falls back to a fresh call if
 * the cache misses. */
function leadingCol(lineText: string): number {
  let c = 0;
  while (c < lineText.length && (lineText[c] === " " || lineText[c] === "\t")) c++;
  return c;
}

// ─── Rust / Python / Go regex extractors ────────────────────────────────────

function rustSymbols(src: string, file: string): Symbol[] {
  const out: Symbol[] = [];
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const ln = i + 1;
    const col = leadingCol(line);
    // fn NAME  → function
    let m = /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+|const\s+|unsafe\s+)*fn\s+([A-Za-z_][\w]*)/.exec(line);
    if (m && m[1]) {
      out.push({ id: `${file}:${ln}:${col}:${m[1]}`, name: m[1], kind: "function", file, range: { start: { line: ln, col }, end: { line: ln, col: col + line.length } } });
      continue;
    }
    // struct / enum / trait / type NAME  → type
    m = /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:struct|enum|trait|type)\s+([A-Za-z_][\w]*)/.exec(line);
    if (m && m[1]) {
      out.push({ id: `${file}:${ln}:${col}:${m[1]}`, name: m[1], kind: "type", file, range: { start: { line: ln, col }, end: { line: ln, col: col + line.length } } });
      continue;
    }
    // use NAME; → import
    m = /^\s*(?:pub\s+)?use\s+([A-Za-z_][\w:]*)/.exec(line);
    if (m && m[1]) {
      const name = (m[1].split("::").pop() ?? m[1]);
      out.push({ id: `${file}:${ln}:${col}:${name}`, name, kind: "import", file, range: { start: { line: ln, col }, end: { line: ln, col: col + line.length } } });
      continue;
    }
    // const / static NAME  → variable
    m = /^\s*(?:pub\s+)?(?:const|static)\s+([A-Za-z_][\w]*)/.exec(line);
    if (m && m[1]) {
      out.push({ id: `${file}:${ln}:${col}:${m[1]}`, name: m[1], kind: "variable", file, range: { start: { line: ln, col }, end: { line: ln, col: col + line.length } } });
      continue;
    }
  }
  return out;
}

function pythonSymbols(src: string, file: string): Symbol[] {
  const out: Symbol[] = [];
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const ln = i + 1;
    const col = leadingCol(line);
    // async def NAME / def NAME  → function
    let m = /^\s*(?:async\s+)?def\s+([A-Za-z_][\w]*)/.exec(line);
    if (m && m[1]) {
      out.push({ id: `${file}:${ln}:${col}:${m[1]}`, name: m[1], kind: "function", file, range: { start: { line: ln, col }, end: { line: ln, col: col + line.length } } });
      continue;
    }
    // class NAME  → class
    m = /^\s*class\s+([A-Za-z_][\w]*)/.exec(line);
    if (m && m[1]) {
      out.push({ id: `${file}:${ln}:${col}:${m[1]}`, name: m[1], kind: "class", file, range: { start: { line: ln, col }, end: { line: ln, col: col + line.length } } });
      continue;
    }
    // from X import a, b  OR  import X
    m = /^\s*from\s+\S+\s+import\s+([^\n#]+)/.exec(line);
    if (m && m[1]) {
      const names = m[1].split(",").map((s) => s.trim().split(/\s+as\s+/)[0] ?? "").filter(Boolean);
      for (const n of names) {
        out.push({ id: `${file}:${ln}:${col}:${n}`, name: n, kind: "import", file, range: { start: { line: ln, col }, end: { line: ln, col: col + line.length } } });
      }
      continue;
    }
    m = /^\s*import\s+([A-Za-z_][\w.]*(?:\s*,\s*[A-Za-z_][\w.]*)*)/.exec(line);
    if (m && m[1]) {
      const names = m[1].split(",").map((s) => s.trim()).filter(Boolean);
      for (const n of names) {
        const top = n.split(".")[0] ?? n;
        out.push({ id: `${file}:${ln}:${col}:${top}`, name: top, kind: "import", file, range: { start: { line: ln, col }, end: { line: ln, col: col + line.length } } });
      }
      continue;
    }
  }
  return out;
}

function goSymbols(src: string, file: string): Symbol[] {
  const out: Symbol[] = [];
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const ln = i + 1;
    const col = leadingCol(line);
    // func (r *R) NAME(...)  → method   OR  func NAME(...) → function
    // HIGH-1 fix: capture receiver explicitly — m[1]=receiver (optional), m[2]=name
    let m = /^\s*func\s+(\([^)]*\)\s+)?([A-Za-z_][\w]*)/.exec(line);
    if (m && m[2]) {
      const kind: SymbolKind = m[1] ? "method" : "function";
      out.push({ id: `${file}:${ln}:${col}:${m[2]}`, name: m[2], kind, file, range: { start: { line: ln, col }, end: { line: ln, col: col + line.length } } });
      continue;
    }
    // type NAME struct / interface  → type
    m = /^\s*type\s+([A-Za-z_][\w]*)\s+(?:struct|interface)\b/.exec(line);
    if (m && m[1]) {
      out.push({ id: `${file}:${ln}:${col}:${m[1]}`, name: m[1], kind: "type", file, range: { start: { line: ln, col }, end: { line: ln, col: col + line.length } } });
      continue;
    }
    // var / const NAME  → variable
    m = /^\s*(?:var|const)\s+(?:\([^)]*\)|[A-Za-z_][\w]*)\s*=?/.exec(line);
    if (m) {
      const name = /\(([A-Za-z_][\w]*)\)/.exec(line)?.[1] ?? /([A-Za-z_][\w]*)/.exec(line.replace(/^\s*(?:var|const)\s+/, ""))?.[1] ?? "";
      if (name) {
        out.push({ id: `${file}:${ln}:${col}:${name}`, name, kind: "variable", file, range: { start: { line: ln, col }, end: { line: ln, col: col + line.length } } });
      }
      continue;
    }
    // import "x"  → import (named x for graph join purposes)
    m = /^\s*import\s+"([^"]+)"/.exec(line);
    if (m && m[1]) {
      const name = m[1].replace(/^.*\//, "").replace(/[^A-Za-z0-9_]/g, "_") || "import";
      out.push({ id: `${file}:${ln}:${col}:${name}`, name, kind: "import", file, range: { start: { line: ln, col }, end: { line: ln, col: col + line.length } } });
      continue;
    }
  }
  return out;
}

// ─── Public API ─────────────────────────────────────────────────────────────

export interface ExtractOpts {
  /** Repo root for converting absolute paths into repo-relative form. If
   * omitted, the file's basename is used. */
  root?: string;
  /** Pre-read source. Skips the file read when provided (test fixtures). */
  src?: string;
}

/**
 * Extract Symbol definitions from a file.
 *
 * Dispatches on extension: `.ts/.tsx/.js/.jsx/.mjs/.cjs` → native + regex
 * declarations; `.rs/.py/.go` → language-specific regex. Other extensions
 * return an empty list (callers may filter on supported list before calling).
 *
 * `id` is `file:startLine:startCol:name`; ordering is stable across calls.
 */
export function extractSymbols(filePath: string, opts: ExtractOpts = {}): Symbol[] {
  const ext = extname(filePath);
  // Resolve file key (repo-relative if root given).
  const file = opts.root
    ? relative(opts.root, filePath).split("\\").join("/")
    : (filePath.split("/").pop() ?? filePath);

  // Load source — either caller-provided or on-disk.
  let src = opts.src;
  if (src === undefined) {
    try {
      // Synchronous-friendly: must be async at the call site. Use try/catch +
      // disk read with a 1 MB cap mirroring `buildCodegraph` (DoS guard).
      // We keep this sync-style by doing a fire-and-forget; for an MVP
      // extractor we expose the async form below. For simplicity this function
      // returns [] when src cannot be read; use `extractSymbolsForRoot` for
      // file-walk + symbol population.
      // HIGH-2 fix: ESM-safe require via createRequire (Node 20 compatible)
      const nodeRequire = createRequire(import.meta.url);
      const fs = nodeRequire("node:fs") as typeof import("node:fs");
      const s = fs.statSync(filePath);
      if (s.size > 1_048_576) return [];
      src = fs.readFileSync(filePath, "utf8");
    } catch {
      return [];
    }
  }

  if (TSJS_EXT.has(ext)) {
    const native = nativeParseTsSymbols(src);
    const fromNative1 = native
      .map((a) => fromNative(a, file, src))
      .filter((s): s is Symbol => s !== null);
    // Re-classify arrow → variable when line has const|let|var (the declaration
    // regex below would otherwise double-emit; first-wins via dedupe).
    const lines = src.split("\n");
    const adjusted = fromNative1.map((s) => {
      const lineText = lines[s.range.start.line - 1] ?? "";
      if (/^\s*(?:export\s+)?(?:const|let|var)\s+[A-Za-z_$]/.test(lineText)) {
        return { ...s, kind: "variable" as SymbolKind };
      }
      return s;
    });
    const decls = tsjsDeclarations(src, file);
    return dedupeAndSort([...adjusted, ...decls]);
  }
  if (ext === ".rs") return dedupeAndSort(rustSymbols(src, file));
  if (ext === ".py") return dedupeAndSort(pythonSymbols(src, file));
  if (ext === ".go") return dedupeAndSort(goSymbols(src, file));
  return [];
}

function dedupeAndSort(symbols: Symbol[]): Symbol[] {
  const seen = new Set<string>();
  const out: Symbol[] = [];
  for (const s of symbols) {
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    out.push(s);
  }
  out.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return out;
}

/**
 * Build a complete GraphStore from a root + optional file allowlist.
 *
 * Mirrors `buildCodegraph` walk rules: max 50_000 files, depth ≤ 10, skip
 * `.git | node_modules | target | dist | .next | .crew`, 1 MB per-file cap.
 * Returns `{ store, files }` so the caller can also derive references.
 */
export async function extractSymbolsForRoot(
  root: string,
  files?: string[],
): Promise<import("./graph-store.js").GraphStore> {
  const store = new (await import("./graph-store.js")).GraphStore();
  const targets = files && files.length > 0
    ? files.map((f) => f)
    : await walkSourceFiles(root);
  for (const rel of targets) {
    const ext = extname(rel);
    if (!isSupportedExt(ext)) continue;
    const full = joinPaths(root, rel);
    try {
      const s = await stat(full);
      if (!s.isFile() || s.size > 1_048_576) continue;
    } catch {
      continue;
    }
    let src: string;
    try {
      src = await readFile(full, "utf8");
    } catch {
      continue;
    }
    const symbols = extractSymbols(full, { root, src });
    for (const sym of symbols) store.addSymbol(sym);
  }
  return store;
}

function joinPaths(root: string, rel: string): string {
  // Avoid pulling `path` into the public surface — local join.
  return root.endsWith("/") || root.endsWith("\\") ? root + rel : `${root}/${rel}`;
}

const SUPPORTED_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".rs", ".py", ".go"]);
function isSupportedExt(ext: string): boolean {
  return SUPPORTED_EXTS.has(ext);
}

/** Walk `root` for supported source extensions. Mirrors `buildCodegraph`'s skip
 * + cap rules so the symbol pass walks the same file set. */
async function walkSourceFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  const MAX = 50_000;
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 10 || out.length >= MAX) return;
    const { readdir } = await import("node:fs/promises");
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (
        ent.name === ".git" ||
        ent.name === "node_modules" ||
        ent.name === "target" ||
        ent.name === "dist" ||
        ent.name === ".next" ||
        ent.name === ".crew"
      )
        continue;
      const full = joinPaths(dir, ent.name);
      if (ent.isDirectory()) await walk(full, depth + 1);
      else if (ent.isFile()) {
        const ext = extname(ent.name);
        if (isSupportedExt(ext)) out.push(relative(root, full).split("\\").join("/"));
        if (out.length >= MAX) break;
      }
    }
  }
  await walk(root, 0);
  return out;
}

/** List of file extensions supported by `extractSymbols` — exported for
 * callers that want to filter their own file lists. */
export const SUPPORTED_SYMBOL_EXTS: readonly string[] = [...SUPPORTED_EXTS];

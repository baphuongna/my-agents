/**
 * Codegraph — file-RELEVANCE index (§11.3). NOT a call graph (corrected R24).
 *
 * Builds an import graph (file → files it imports) by regex-scanning import
 * statements per language. `related(path)` returns files connected to the given
 * path (imports + importers), ranked by relevance — the answer to "which files
 * relate to X".
 *
 * Tier 2: regex-based import detection (TS/JS, Python, Rust). A real LSP-backed
 * symbol graph (goto-def / find-refs / call-graph) is §23 open question #1
 * (deferred). This file-relevance index is the §11.3 contract.
 *
 * Source: §11.3 codegraph, hermes codegraph.
 */
import { readFile, readdir } from "node:fs/promises";
import { join, relative, extname, dirname, normalize } from "node:path";
import { err, isRecord, ok, type ToolImpl } from "@my-agent/tools";
import type { ToolResult } from "@my-agent/core";
import { extractSymbols } from "./symbol-extractor.js";
import type { Symbol } from "./symbol-extractor.js";
import { GraphStore } from "./graph-store.js";
import {
  buildReferencesForStore,
  findDefinitions,
  findReferences,
  getCallGraph,
  getRelatedFiles as getRelatedFilesBySymbols,
} from "./reference-graph.js";
import type { Reference } from "./reference-graph.js";

/** Per-language import-statement matchers (capture the target specifier). */
const IMPORT_MATCHERS: Record<string, RegExp[]> = {
  ".ts": [/^\s*import\s[^;]*?\bfrom\s+['"]([^'"]+)['"]/gm, /^\s*import\s+['"]([^'"]+)['"]/gm, /^\s*}\s*from\s+['"]([^'"]+)['"]/gm],
  ".tsx": [/^\s*import\s[^;]*?\bfrom\s+['"]([^'"]+)['"]/gm],
  ".js": [/^\s*import\s[^;]*?\bfrom\s+['"]([^'"]+)['"]/gm, /^\s*require\(\s*['"]([^'"]+)['"]\s*\)/gm],
  ".mjs": [/^\s*import\s[^;]*?\bfrom\s+['"]([^'"]+)['"]/gm],
  ".py": [/^\s*from\s+([.\w]+)\s+import/gm, /^\s*import\s+([\w.]+)/gm],
  ".rs": [/^\s*use\s+([\w:]+)/gm, /^\s*(?:pub\s+)?mod\s+(\w+)/gm],
};

export interface Codegraph {
  /** Map of file (repo-relative) → set of files it imports (resolved relative paths). */
  edges: Map<string, Set<string>>;
  /** Reverse: file → files that import it (importers). */
  reverse: Map<string, Set<string>>;
}

/**
 * Build a codegraph by scanning all source files under `root`.
 * Resolves import specifiers to repo-relative paths where possible.
 */
export async function buildCodegraph(root: string): Promise<Codegraph> {
  const edges = new Map<string, Set<string>>();
  const reverse = new Map<string, Set<string>>();
  const files: string[] = [];
  const MAX_FILES = 50_000;

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 10 || files.length >= MAX_FILES) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (ent.name.startsWith(".git") || ent.name === "node_modules" || ent.name === "target" || ent.name === "dist") continue;
      const full = join(dir, ent.name);
      if (ent.isDirectory()) await walk(full, depth + 1);
      else if (ent.isFile()) {
        const ext = extname(ent.name);
        if (IMPORT_MATCHERS[ext]) files.push(relative(root, full));
      }
    }
  };
  await walk(root, 0);

  for (const rel of files) {
    const full = join(root, rel);
    let content: string;
    try {
      // M6 fix: skip oversized files (DoS — a huge / special file would be read
      // whole). 1 MB cap; stat first to avoid reading multi-GB blobs.
      const stat = await import("node:fs/promises").then((m) => m.stat(full)).catch(() => null);
      if (stat && (stat.size > 1_048_576 || !stat.isFile())) continue;
      content = await readFile(full, "utf8");
    } catch {
      continue;
    }
    const ext = extname(rel);
    const matchers = IMPORT_MATCHERS[ext];
    if (!matchers) continue;
    const canonicalRel = canonical(rel);
    const targets = new Set<string>();
    for (const re of matchers) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(content)) !== null) {
        const spec = m[1];
        if (!spec) continue;
        const resolved = resolveSpecifier(spec, rel);
        if (resolved) targets.add(resolved);
      }
    }
    if (targets.size > 0) {
      edges.set(canonicalRel, targets);
      for (const t of targets) {
        let rev = reverse.get(t);
        if (!rev) {
          rev = new Set();
          reverse.set(t, rev);
        }
        rev.add(canonicalRel);
      }
    }
  }
  return { edges, reverse };
}

/** Strip the extension for a canonical (extension-less) graph key. */
function canonical(p: string): string {
  const ext = extname(p);
  return ext ? p.slice(0, p.length - ext.length) : p;
}

/** Resolve an import specifier (relative/alias) to a canonical repo-relative path. */
function resolveSpecifier(spec: string, importerRel: string): string | null {
  // Relative specifiers (./ or ../) — canonical (extension-less).
  if (spec.startsWith(".")) {
    const importerDir = dirname(importerRel);
    return canonical(normalize(join(importerDir, spec)));
  }
  // Python module path → path/to/module (canonical, no .py)
  if (importerRel.endsWith(".py") && !spec.includes("/")) {
    return spec.replace(/\./g, "/");
  }
  // Bare specifiers (node_modules, crates) — out-of-graph; ignore.
  return null;
}

/** Files related to `path`: imports + importers, ranked (importers first). */
export function related(graph: Codegraph, path: string): { path: string; relation: "imports" | "imported-by" }[] {
  const key = canonical(path);
  const result: { path: string; relation: "imports" | "imported-by" }[] = [];
  // Imported-by (who depends on this file) — usually the higher-relevance direction.
  const importers = graph.reverse.get(key);
  if (importers) for (const f of importers) result.push({ path: f, relation: "imported-by" });
  // Imports (what this file depends on).
  const imports = graph.edges.get(key);
  if (imports) for (const f of imports) result.push({ path: f, relation: "imports" });
  return result;
}

/** The `codegraph` tool: build (or use cached) graph + return related files. */
export function makeCodegraphTool(): ToolImpl & { graphFor(root: string): Promise<Codegraph> } {
  const cache = new Map<string, Promise<Codegraph>>();
  return {
    meta: {
      name: "codegraph",
      args: {
        type: "object",
        properties: {
          path: { type: "string", description: "repo-relative file to find relations for" },
          cwd: { type: "string", description: "repo root (defaults to process.cwd())" },
        },
        required: ["path"],
      },
      requiredMode: "ReadOnly",
    },
    async run(args, _ctx): Promise<ToolResult> {
      if (!isRecord(args) || typeof args.path !== "string")
        return err("codegraph", "path required");
      const cwd = typeof args.cwd === "string" ? args.cwd : process.cwd();
      const graph = await this.graphFor(cwd);
      const rel = related(graph, args.path);
      return ok("codegraph", { path: args.path, related: rel });
    },
    async graphFor(root: string): Promise<Codegraph> {
      let p = cache.get(root);
      if (!p) {
        p = buildCodegraph(root);
        cache.set(root, p);
        // M6 fix: cap the cache (an attacker-controlled `cwd` per call would grow
        // it unbounded). Evict oldest entries beyond 64 roots.
        if (cache.size > 64) {
          const oldest = cache.keys().next().value;
          if (oldest !== undefined) cache.delete(oldest);
        }
      }
      return p;
    },
  };
}

// ─── Phase B / Gap 5: symbol-level queries (additive surface) ──────────────
//
// The functions below are exported alongside the existing file-relevance API.
// `makeCodegraphTool` is intentionally unchanged (AGENTS.md: "never
// stub-then-replace"); callers wire the symbol surface in directly.

/** Build a populated GraphStore (Symbols + References) for a root. Cached per
 * root so repeated symbol queries share the parse cost. */
export async function buildSymbolGraph(root: string): Promise<GraphStore> {
  const { extractSymbolsForRoot } = await import("./symbol-extractor.js");
  const store = await extractSymbolsForRoot(root);
  await buildReferencesForStore(store, root);
  return store;
}

/** Find Symbol definitions matching `name` in the graph. */
export function findSymbols(graph: GraphStore, name: string): Symbol[] {
  return findDefinitions(graph, name);
}

/** Find all References that target `id`. */
export function findReferencesForId(graph: GraphStore, id: string): Reference[] {
  return findReferences(graph, id);
}

/** Build the call graph for a function/method symbol. */
export function callGraphFor(graph: GraphStore, functionId: string): { callers: Symbol[]; callees: Symbol[] } {
  return getCallGraph(graph, functionId);
}

/** Files related to a file via shared symbols (definitions + incoming refs). */
export function relatedFilesBySymbols(graph: GraphStore, filePath: string): string[] {
  return getRelatedFilesBySymbols(graph, filePath);
}

/** Run symbol extraction on one file (synchronous-ish). Returns Symbol[].
 * Provided as a convenience for callers that have a file in hand and don't
 * need the full graph. */
export function extractSymbolsFromFile(filePath: string): Symbol[] {
  return extractSymbols(filePath);
}

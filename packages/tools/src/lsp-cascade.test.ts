/**
 * Phase 3-4 — LSP Cascade Diagnostics tests (6 tests).
 *
 *   -  1:   computeImpact depth-1 (direct importers)
 *   -  2:   computeImpact depth-2 (transitive importers)
 *   -  3:   computeImpact handles cycles (no infinite loop)
 *   -  4:   touchFile maps LspDiagnostic → Diagnostic correctly
 *   -  5:   runCascade touches changed file + all affected files in parallel
 *   -  6:   computeImpact returns [] for a file with no importers
 */

import { describe, it, expect } from "vitest";
import type { LspDiagnostic } from "./lsp-client.js";
import { computeImpact, touchFile, runCascade } from "./lsp-cascade.js";
import type { CascadeLspClient, Diagnostic, ReferenceGraph } from "./lsp-cascade.js";

/** Build a ReferenceGraph (Codegraph) from raw edge pairs. */
function makeGraph(edges: Array<[string, string]>): ReferenceGraph {
  const graph: ReferenceGraph = {
    edges: new Map(),
    reverse: new Map(),
  };
  for (const [from, to] of edges) {
    let fwd = graph.edges.get(from);
    if (!fwd) { fwd = new Set(); graph.edges.set(from, fwd); }
    fwd.add(to);
    let rev = graph.reverse.get(to);
    if (!rev) { rev = new Set(); graph.reverse.set(to, rev); }
    rev.add(from);
  }
  return graph;
}

/** Mock LSP client for deterministic tests. */
function makeMockClient(diagnosticsMap?: Map<string, LspDiagnostic[]>): CascadeLspClient {
  const diags = diagnosticsMap ?? new Map<string, LspDiagnostic[]>();
  const opened: Array<{ uri: string; languageId: string; content: string; version: number }> = [];
  const changed: Array<{ uri: string; version: number; content: string }> = [];
  return {
    openDocument(uri: string, languageId: string, content: string, version: number) {
      opened.push({ uri, languageId, content, version });
    },
    changeDocument(uri: string, version: number, content: string) {
      changed.push({ uri, version, content });
    },
    getDiagnostics(uri: string): LspDiagnostic[] {
      return diags.get(uri) ?? [];
    },
  };
}

describe("Phase 3-4 — LSP Cascade Diagnostics", () => {
  // ─── 1 ─── computeImpact depth-1: direct importers present, depth-3 excluded
  it("computeImpact returns direct importers and respects depth-2 boundary", () => {
    // a imports b, b imports c, c imports d → d's importers at depth 1 = {c}, depth 2 = {b}, depth 3 = {a}
    const graph = makeGraph([
      ["src/a", "src/b"],
      ["src/b", "src/c"],
      ["src/c", "src/d"],
    ]);
    const impact = computeImpact("src/d.ts", graph);
    expect(impact).toContain("src/c"); // depth 1
    expect(impact).toContain("src/b"); // depth 2
    expect(impact).not.toContain("src/a"); // depth 3 — excluded
    expect(impact).not.toContain("src/d"); // self — excluded
  });

  // ─── 2 ─── computeImpact depth-2: transitive importers
  it("computeImpact returns transitive importers at depth 2", () => {
    // a imports b, b imports c → cascade from c reaches b (d1) and a (d2)
    const graph = makeGraph([
      ["src/a", "src/b"],
      ["src/b", "src/c"],
    ]);
    const impact = computeImpact("src/c.ts", graph);
    expect(impact).toContain("src/b");
    expect(impact).toContain("src/a");
  });

  // ─── 3 ─── computeImpact handles cycles (A↔B mutual imports)
  it("computeImpact terminates on cyclic import graphs", () => {
    // a imports b AND b imports a — mutual import cycle
    const graph = makeGraph([
      ["src/a", "src/b"],
      ["src/b", "src/a"],
    ]);
    const impact = computeImpact("src/a.ts", graph);
    // Should contain b (importer of a) without infinite loop.
    expect(impact).toContain("src/b");
    // No duplicates despite the cycle.
    expect(impact).toHaveLength(1);
  });

  // ─── 4 ─── touchFile maps LspDiagnostic → Diagnostic
  it("touchFile maps LspDiagnostic range to flat line/column", async () => {
    const diags = new Map<string, LspDiagnostic[]>();
    const uri = "file:///src/foo.ts";
    diags.set(uri, [
      {
        range: { start: { line: 5, character: 10 }, end: { line: 5, character: 15 } },
        message: "Type 'string' is not assignable to type 'number'.",
        severity: 1,
        source: "tsserver",
      },
      {
        range: { start: { line: 12, character: 0 }, end: { line: 12, character: 3 } },
        message: "Unused variable 'bar'.",
        severity: 2,
      },
    ]);
    const client = makeMockClient(diags);
    const result = await touchFile("/src/foo.ts", "const x = 1;\n", client);
    expect(result).toHaveLength(2);
    const first = result[0]!;
    expect(first.line).toBe(5);
    expect(first.column).toBe(10);
    expect(first.message).toBe("Type 'string' is not assignable to type 'number'.");
    expect(first.severity).toBe(1);
    expect(first.source).toBe("tsserver");
    const second = result[1]!;
    expect(second.line).toBe(12);
    expect(second.column).toBe(0);
    expect(second.source).toBeUndefined();
  });

  // ─── 5 ─── runCascade touches changed file + all affected files
  it("runCascade touches the changed file and all affected files", async () => {
    // c changed; b imports c, a imports b → impact = {b, a}
    const graph = makeGraph([
      ["src/a", "src/b"],
      ["src/b", "src/c"],
    ]);
    // Track which URIs were opened.
    const openedUris: string[] = [];
    const changedUris: string[] = [];
    const client: CascadeLspClient = {
      openDocument(uri: string, _lang: string, _content: string, _v: number) {
        openedUris.push(uri);
      },
      changeDocument(uri: string, _v: number, _content: string) {
        changedUris.push(uri);
      },
      getDiagnostics(): LspDiagnostic[] {
        return [];
      },
    };
    const results = await runCascade("src/c.ts", "export const y = 1;\n", graph, client);
    // Should have 3 results: c (changed), b, a.
    const files = results.map((r) => r.file).sort();
    expect(files).toEqual(["src/a", "src/b", "src/c"].sort());
    // All results should have diagnostics arrays.
    expect(results.every((r) => Array.isArray(r.diagnostics))).toBe(true);
    // Each file was opened and changed.
    expect(openedUris).toHaveLength(3);
    expect(changedUris).toHaveLength(3);
    // Each result has a diagnostics array (empty).
    for (const r of results) {
      expect(r.diagnostics).toBeInstanceOf(Array);
    }
  });

  // ─── 6 ─── computeImpact returns [] for a file with no importers
  it("computeImpact returns empty array when no file imports the changed file", () => {
    const graph = makeGraph([
      ["src/a", "src/b"],
    ]);
    // src/a is a leaf importer — nobody imports it.
    const impact = computeImpact("src/a.ts", graph);
    expect(impact).toEqual([]);
  });
});

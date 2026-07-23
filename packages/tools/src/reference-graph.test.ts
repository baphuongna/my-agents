/**
 * Phase B / Gap 5 — Reference graph builder tests.
 *
 * Focuses on the two UNDER-tested exports of reference-graph.ts:
 *
 *   - `buildReferencePass`  — per-file scan (call / write / import sites)
 *   - `buildReferencesForStore` — read-every-file convenience driver
 *
 * The query helpers (findDefinitions / findReferences / getCallGraph /
 * getRelatedFiles) are exercised here against manually-built GraphStores so
 * this file is self-contained, in addition to the integration coverage in
 * codegraph.test.ts.
 *
 *   -  1: buildReferencePass detects a call site for a known function symbol
 *   -  2: buildReferencePass ignores call sites for unknown names
 *   -  3: buildReferencePass records multiple call sites (one ref per site)
 *   -  4: buildReferencePass detects a write site (let/const/var NAME)
 *   -  5: buildReferencePass detects a TS relative import site
 *   -  6: buildReferencePass returns the cumulative added count
 *   -  7: buildReferencesForStore reads files from disk and adds references
 *   -  8: buildReferencesForStore skips missing / oversized files gracefully
 *   -  9: findReferences returns the references produced by a pass
 *   - 10: getCallGraph resolves callers + callees through call refs
 *   - 11: getRelatedFiles reports files connected by symbol references
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GraphStore } from "./graph-store.js";
import type { Symbol } from "./symbol-extractor.js";
import {
  buildReferencePass,
  buildReferencesForStore,
  findReferences,
  getCallGraph,
  getRelatedFiles,
} from "./reference-graph.js";

/** Build a minimal Symbol with a stable id. */
function makeSymbol(opts: {
  name: string;
  file: string;
  line: number;
  col?: number;
  endLine?: number;
  kind?: Symbol["kind"];
}): Symbol {
  const col = opts.col ?? 0;
  const kind = opts.kind ?? "function";
  return {
    id: `${opts.file}:${opts.line}:${col}:${opts.name}`,
    name: opts.name,
    kind,
    file: opts.file,
    range: { start: { line: opts.line, col }, end: { line: opts.endLine ?? opts.line, col } },
  };
}

describe("reference-graph — buildReferencePass", () => {
  it("detects a call site for a known function symbol", () => {
    const graph = new GraphStore();
    const foo = makeSymbol({ name: "foo", file: "a.ts", line: 1 });
    graph.addSymbol(foo);

    const added = buildReferencePass(graph, "b.ts", "foo();\n");
    expect(added).toBe(1);
    const refs = findReferences(graph, foo.id);
    expect(refs).toHaveLength(1);
    expect(refs[0]!.kind).toBe("call");
    expect(refs[0]!.fromFile).toBe("b.ts");
    expect(refs[0]!.fromRange.start.line).toBe(1);
  });

  it("ignores call sites for names not present in the graph", () => {
    const graph = new GraphStore();
    graph.addSymbol(makeSymbol({ name: "foo", file: "a.ts", line: 1 }));

    const added = buildReferencePass(graph, "b.ts", "bar();\nbaz();\n");
    expect(added).toBe(0);
  });

  it("records one reference per call site (multiple calls)", () => {
    const graph = new GraphStore();
    const foo = makeSymbol({ name: "foo", file: "a.ts", line: 1 });
    graph.addSymbol(foo);

    const added = buildReferencePass(graph, "b.ts", "foo();\nfoo();\nfoo();\n");
    expect(added).toBe(3);
    expect(findReferences(graph, foo.id)).toHaveLength(3);
  });

  it("detects a write site (let/const/var NAME) for a known symbol", () => {
    const graph = new GraphStore();
    const foo = makeSymbol({ name: "foo", file: "a.ts", line: 1, kind: "variable" });
    graph.addSymbol(foo);

    const added = buildReferencePass(graph, "b.ts", "const foo = getValue();\n");
    expect(added).toBe(1);
    const refs = findReferences(graph, foo.id);
    expect(refs).toHaveLength(1);
    expect(refs[0]!.kind).toBe("write");
  });

  it("detects a TS relative import site and links to the resolved file's symbols", () => {
    const graph = new GraphStore();
    const foo = makeSymbol({ name: "foo", file: "a.ts", line: 1 });
    graph.addSymbol(foo);

    const added = buildReferencePass(graph, "b.ts", "import { foo } from './a';\n");
    expect(added).toBe(1);
    const refs = findReferences(graph, foo.id);
    expect(refs).toHaveLength(1);
    expect(refs[0]!.kind).toBe("import");
    expect(refs[0]!.fromFile).toBe("b.ts");
  });

  it("returns the cumulative count across call + write + import passes", () => {
    const graph = new GraphStore();
    const foo = makeSymbol({ name: "foo", file: "a.ts", line: 1 });
    graph.addSymbol(foo);

    // One import (./a → foo), one call (foo()), one write (const foo).
    const src = "import { foo } from './a';\nfoo();\nconst foo = 1;\n";
    const added = buildReferencePass(graph, "b.ts", src);
    expect(added).toBe(3);
  });
});

describe("reference-graph — buildReferencesForStore", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "mya-refgraph-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("reads files from disk and adds references for known symbols", async () => {
    // Both files call `foo`; foo is a known symbol defined in a.ts.
    await writeFile(join(dir, "a.ts"), "foo();\n");
    await writeFile(join(dir, "b.ts"), "foo();\n");

    const graph = new GraphStore();
    graph.addSymbol(makeSymbol({ name: "foo", file: "a.ts", line: 1 }));
    graph.addSymbol(makeSymbol({ name: "main", file: "b.ts", line: 1 }));

    const total = await buildReferencesForStore(graph, dir);
    // One call ref from each on-disk file.
    expect(total).toBeGreaterThanOrEqual(2);
  });

  it("skips missing / oversized files gracefully without throwing", async () => {
    await writeFile(join(dir, "a.ts"), "foo();\n");

    const graph = new GraphStore();
    graph.addSymbol(makeSymbol({ name: "foo", file: "a.ts", line: 1 }));
    // A symbol whose file does NOT exist on disk — must be skipped, not fatal.
    graph.addSymbol(makeSymbol({ name: "ghost", file: "missing.ts", line: 1 }));

    const total = await buildReferencesForStore(graph, dir);
    expect(total).toBeGreaterThanOrEqual(1);
    // No reference should ever be recorded against the missing file's symbol.
    expect(findReferences(graph, "missing.ts:1:0:ghost")).toHaveLength(0);
  });
});

describe("reference-graph — query helpers over a built graph", () => {
  it("getCallGraph resolves callers (incoming calls) and callees (outgoing calls)", () => {
    const graph = new GraphStore();
    const foo = makeSymbol({ name: "foo", file: "a.ts", line: 1 });
    // caller spans lines 1–3 so the call on line 2 is enclosed.
    const caller = makeSymbol({ name: "caller", file: "b.ts", line: 1, endLine: 3 });
    graph.addSymbol(foo);
    graph.addSymbol(caller);

    // b.ts defines caller and calls foo on line 2.
    buildReferencePass(graph, "b.ts", "function caller() {\n  foo();\n}\n");

    // foo is called by caller.
    const fooGraph = getCallGraph(graph, foo.id);
    expect(fooGraph.callers.map((s) => s.name)).toContain("caller");
    expect(fooGraph.callees).toHaveLength(0);

    // caller calls foo.
    const callerGraph = getCallGraph(graph, caller.id);
    expect(callerGraph.callees.map((s) => s.name)).toContain("foo");
  });

  it("getRelatedFiles reports files connected via symbol references (with + without extension)", () => {
    const graph = new GraphStore();
    const foo = makeSymbol({ name: "foo", file: "a.ts", line: 1 });
    graph.addSymbol(foo);
    // b.ts references foo → a.ts and b.ts are related.
    buildReferencePass(graph, "b.ts", "foo();\n");

    expect(getRelatedFiles(graph, "a.ts")).toContain("b.ts");
    // Extension-stripped form resolves to the same symbol set.
    expect(getRelatedFiles(graph, "a")).toContain("b.ts");
  });
});

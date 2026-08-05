/**
 * symbol-extractor.ts tests — language regex extractors (Rust/Python/Go) +
 * public API (extractSymbols dispatch, id format, dedup, supported exts).
 *
 * The TS/JS path delegates to the native tree-sitter bridge; these tests focus
 * on the deterministic regex extractors (.rs/.py/.go) which need no native.
 */
import { describe, it, expect } from "vitest";
import { extractSymbols, SUPPORTED_SYMBOL_EXTS } from "./symbol-extractor.js";

describe("symbol-extractor: SUPPORTED_SYMBOL_EXTS", () => {
  it("lists the supported source extensions", () => {
    expect(SUPPORTED_SYMBOL_EXTS).toContain(".ts");
    expect(SUPPORTED_SYMBOL_EXTS).toContain(".rs");
    expect(SUPPORTED_SYMBOL_EXTS).toContain(".py");
    expect(SUPPORTED_SYMBOL_EXTS).toContain(".go");
    expect(SUPPORTED_SYMBOL_EXTS).toContain(".jsx");
  });
});

describe("symbol-extractor: extractSymbols dispatch", () => {
  it("returns [] for an unsupported extension", () => {
    expect(extractSymbols("notes.txt", { src: "fn foo() {}" })).toEqual([]);
    expect(extractSymbols("data.json", { src: "{}" })).toEqual([]);
  });

  it("builds stable ids of the form file:line:col:name", () => {
    const syms = extractSymbols("a.rs", { src: "pub fn alpha() {}\n" });
    const a = syms.find((s) => s.name === "alpha");
    expect(a).toBeDefined();
    if (a) {
      expect(a.id).toBe("a.rs:1:0:alpha");
      expect(a.range.start).toEqual({ line: 1, col: 0 });
    }
  });

  it("dedupes identical ids and sorts stably; distinct lines keep distinct ids", () => {
    // Two functions on different lines have DISTINCT ids (line is part of id),
    // so both are kept — this is the intended uniqueness property.
    const src = "pub fn dup() {}\npub fn dup() {}\n";
    const syms = extractSymbols("a.rs", { src });
    const dups = syms.filter((s) => s.name === "dup");
    expect(dups).toHaveLength(2);
    expect(new Set(syms.map((s) => s.id)).size).toBe(syms.length);
    // ids are sorted ascending
    const ids = syms.map((s) => s.id);
    const sorted = [...ids].sort();
    expect(ids).toEqual(sorted);
  });
});

describe("symbol-extractor: Rust (.rs)", () => {
  it("extracts functions (pub/async/const/unsafe modifiers)", () => {
    const src = [
      "pub fn public_fn() {}",
      "async fn async_fn() {}",
      "const fn const_fn() {}",
      "unsafe fn unsafe_fn() {}",
      "fn plain() {}",
    ].join("\n");
    const names = extractSymbols("m.rs", { src }).map((s) => s.name);
    for (const n of ["public_fn", "async_fn", "const_fn", "unsafe_fn", "plain"]) {
      expect(names).toContain(n);
    }
  });

  it("extracts struct/enum/trait/type as `type` kind", () => {
    const src = "pub struct Foo;\npub enum Bar {}\npub trait Baz {}\ntype Alias = i32;\n";
    const syms = extractSymbols("m.rs", { src });
    const types = syms.filter((s) => s.kind === "type").map((s) => s.name);
    expect(types).toEqual(expect.arrayContaining(["Foo", "Bar", "Baz", "Alias"]));
  });

  it("extracts `use` imports (last path segment) and const/static variables", () => {
    const src = "use std::collections::HashMap;\npub const MAX: u32 = 10;\nstatic GLOBAL: i32 = 0;\n";
    const syms = extractSymbols("m.rs", { src });
    const imp = syms.find((s) => s.kind === "import");
    expect(imp?.name).toBe("HashMap");
    const vars = syms.filter((s) => s.kind === "variable").map((s) => s.name);
    expect(vars).toEqual(expect.arrayContaining(["MAX", "GLOBAL"]));
  });
});

describe("symbol-extractor: Python (.py)", () => {
  it("extracts def / async def as functions", () => {
    const src = "def plain():\n    pass\n\nasync def coro():\n    pass\n";
    const fns = extractSymbols("m.py", { src }).filter((s) => s.kind === "function").map((s) => s.name);
    expect(fns).toEqual(expect.arrayContaining(["plain", "coro"]));
  });

  it("extracts class as `class` kind", () => {
    const syms = extractSymbols("m.py", { src: "class Widget:\n    pass\n" });
    expect(syms.find((s) => s.name === "Widget" && s.kind === "class")).toBeDefined();
  });

  it("extracts from-import and plain import names", () => {
    const src = "from os.path import join, basename\nimport sys, os.path\n";
    const syms = extractSymbols("m.py", { src });
    const imports = syms.filter((s) => s.kind === "import").map((s) => s.name);
    expect(imports).toEqual(expect.arrayContaining(["join", "basename", "sys", "os"]));
  });
});

describe("symbol-extractor: Go (.go)", () => {
  it("extracts func (function) and method (receiver) forms", () => {
    const src = "package main\nfunc FreeFunc() {}\nfunc (s *Server) Handle() {}\n";
    const syms = extractSymbols("m.go", { src });
    const fn = syms.find((s) => s.name === "FreeFunc");
    expect(fn?.kind).toBe("function");
    const method = syms.find((s) => s.name === "Handle");
    expect(method?.kind).toBe("method");
  });

  it("extracts type ... struct/interface as `type`", () => {
    const syms = extractSymbols("m.go", {
      src: "type Request struct{}\ntype Reader interface{}\n",
    });
    const types = syms.filter((s) => s.kind === "type").map((s) => s.name);
    expect(types).toEqual(expect.arrayContaining(["Request", "Reader"]));
  });

  it("extracts var/const as variables", () => {
    const syms = extractSymbols("m.go", { src: "var Count = 0\nconst Pi = 3.14\n" });
    const vars = syms.filter((s) => s.kind === "variable").map((s) => s.name);
    expect(vars).toEqual(expect.arrayContaining(["Count", "Pi"]));
  });
});

describe("symbol-extractor: id stability across calls", () => {
  it("same source ⇒ same ids (deterministic)", () => {
    const src = "pub fn stable() {}\n";
    expect(extractSymbols("a.rs", { src })).toEqual(extractSymbols("a.rs", { src }));
  });
});

describe("[unit] extractSymbolsForRoot", () => {
  it("returns a GraphStore for a directory", async () => {
    const { extractSymbolsForRoot } = await import("./symbol-extractor.js");
    const store = await extractSymbolsForRoot("packages/tools/src");
    expect(store).toBeDefined();
    expect(store.size).toBeGreaterThan(0);
  }, 15_000); // tree-sitter scan is CPU-heavy under parallel load

  it("returns empty store for non-existent dir", async () => {
    const { extractSymbolsForRoot } = await import("./symbol-extractor.js");
    const store = await extractSymbolsForRoot("/nonexistent/path/xyz");
    expect(store.size).toBe(0);
  });

  it("accepts explicit file list", async () => {
    const { extractSymbolsForRoot } = await import("./symbol-extractor.js");
    const store = await extractSymbolsForRoot("packages/tools/src", ["builtin.ts"]);
    expect(store.size).toBeGreaterThan(0);
  });

  it("skips unsupported extensions", async () => {
    const { extractSymbolsForRoot } = await import("./symbol-extractor.js");
    const store = await extractSymbolsForRoot("packages/tools/src", ["README.md"]);
    expect(store.size).toBe(0);
  });
});

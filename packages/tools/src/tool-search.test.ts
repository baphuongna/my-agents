/**
 * Tool-search tests — BigramFilter prefilter, SearchIndex file index, and
 * ToolSearch BM25 index (§11 R35 file-search + §4 R31 deferred tools).
 *
 * Source of truth:
 *   - packages/tools/src/search-index.ts: BigramFilter, SearchIndex
 *   - packages/tools/src/tool-search.ts:  ToolSearch
 *
 * NOTE: BigramFilter + SearchIndex live in search-index.ts (not output-compress.ts);
 * they are grouped here as the search surface.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BigramFilter, SearchIndex } from "./search-index.js";
import { ToolSearch } from "./tool-search.js";
import { setTimeProvider } from "@my-agent/core";

// ─── BigramFilter (content prefilter) ──────────────────────────────────────

describe("BigramFilter — bigram prefilter", () => {
  it("candidates returns paths whose bigrams ⊇ the query bigrams", () => {
    const bf = new BigramFilter();
    bf.add("src/readme.md");
    bf.add("src/changelog.md");
    bf.add("src/app.ts");
    // "read" bigrams (re,ea,ad) are all in "readme.md"
    const c = bf.candidates("read");
    expect(c.has("src/readme.md")).toBe(true);
    expect(c.has("src/app.ts")).toBe(false);
  });

  it("candidates returns nothing for a query with no matching bigrams", () => {
    const bf = new BigramFilter();
    bf.add("app.ts");
    expect(bf.candidates("zzzz")).toEqual(new Set());
  });

  it("remove deletes a path from the index", () => {
    const bf = new BigramFilter();
    bf.add("app.ts");
    expect(bf.candidates("app").has("app.ts")).toBe(true);
    bf.remove("app.ts");
    expect(bf.candidates("app").has("app.ts")).toBe(false);
  });

  it("a too-short query (no bigrams) returns ALL indexed paths", () => {
    const bf = new BigramFilter();
    bf.add("a.ts");
    bf.add("b.ts");
    // single char query → need set is empty → return everything
    const c = bf.candidates("a");
    expect(c.size).toBe(2);
  });

  it("indexing is case-insensitive on the filename", () => {
    const bf = new BigramFilter();
    bf.add("README.MD");
    expect(bf.candidates("read").has("README.MD")).toBe(true);
  });
});

// ─── SearchIndex (per-root file index + frecency + bigram) ─────────────────

describe("SearchIndex — scan + query + globOnly", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "si-"));
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "readme.md"), "docs");
    writeFileSync(join(dir, "src", "app.ts"), "code");
    writeFileSync(join(dir, "config.json"), "{}");
    setTimeProvider({ nowWallclock: () => 1_000_000, nowMonotonic: () => 0 });
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    setTimeProvider({ nowWallclock: () => Date.now(), nowMonotonic: () => Date.now() });
  });

  it("scan indexes every file under the root and reports the count", async () => {
    const idx = new SearchIndex(dir);
    const res = await idx.scan();
    expect(res.indexed).toBe(3);
    expect(idx.size).toBe(3);
  });

  it("getHealth reports Healthy after construction", () => {
    expect(new SearchIndex(dir).getHealth()).toBe("Healthy");
  });

  it("query returns ranked results for a matching filename", async () => {
    const idx = new SearchIndex(dir);
    await idx.scan();
    const res = idx.query("read");
    expect(res.length).toBeGreaterThan(0);
    expect(res[0]!.path).toContain("readme.md");
  });

  it("query returns [] for a blank query", async () => {
    const idx = new SearchIndex(dir);
    await idx.scan();
    expect(idx.query("   ")).toEqual([]);
  });

  it("a frecency-bumped file ranks above an unbumped one with equal fuzzy score", async () => {
    const idx = new SearchIndex(dir);
    await idx.scan();
    idx.access("src/app.ts");
    idx.access("src/app.ts");
    idx.access("src/app.ts");
    // query "app" — app.ts has fuzzy match + high frecency; readme.md has none
    const res = idx.query("app");
    const app = res.find((r) => r.path.includes("app.ts"));
    expect(app).toBeDefined();
    expect(app!.breakdown.frecency).toBe(3);
    expect(res[0]!.path).toContain("app.ts");
  });

  it("globOnly matches a glob pattern and ranks by frecency", async () => {
    const idx = new SearchIndex(dir);
    await idx.scan();
    const res = idx.globOnly("**/*.ts");
    expect(res.length).toBe(1);
    expect(res[0]!.path).toContain("app.ts");
  });

  it("query result breakdown sums into the score", async () => {
    const idx = new SearchIndex(dir);
    await idx.scan();
    const res = idx.query("read");
    const top = res[0]!;
    expect(top.score).toBe(top.breakdown.fuzzy + top.breakdown.frecency + top.breakdown.filenameBonus);
  });
});

// ─── ToolSearch (BM25 deferred-tool index) ─────────────────────────────────

describe("ToolSearch — BM25 over tool docs", () => {
  it("register grows the index size", () => {
    const ts = new ToolSearch();
    expect(ts.size).toBe(0);
    ts.register({ name: "web_search", description: "search the web" });
    expect(ts.size).toBe(1);
  });

  it("search returns [] for an empty / non-matching query", () => {
    const ts = new ToolSearch();
    ts.register({ name: "read", description: "read a file" });
    expect(ts.search("")).toEqual([]);
    expect(ts.search("zzzzzzzzz")).toEqual([]);
  });

  it("search ranks a relevant tool first", () => {
    const ts = new ToolSearch();
    ts.register({ name: "read_file", description: "read a file from disk" });
    ts.register({ name: "web_search", description: "search the internet" });
    const res = ts.search("file");
    expect(res.length).toBeGreaterThan(0);
    expect(res[0]!.name).toBe("read_file");
  });

  it("search returns at most `limit` results", () => {
    const ts = new ToolSearch();
    for (let i = 0; i < 5; i++) ts.register({ name: `tool_${i}`, description: "file file file" });
    const res = ts.search("file", 1.5, 2);
    expect(res.length).toBe(2);
  });

  it("args contribute to the index (searchable)", () => {
    const ts = new ToolSearch();
    ts.register({ name: "db", description: "run a query", args: ["database", "postgres"] });
    expect(ts.search("postgres")[0]?.name).toBe("db");
  });
});

describe("ToolSearch — deferral / active surface / budget", () => {
  it("activeSurface includes non-deferrable tools by default", () => {
    const ts = new ToolSearch();
    ts.register({ name: "read", description: "read a file" });
    ts.register({ name: "rare_tool", description: "niche", deferrable: true });
    expect(ts.activeSurface()).toContain("read");
    expect(ts.activeSurface()).not.toContain("rare_tool");
  });

  it("activate adds a deferrable tool to the active surface", () => {
    const ts = new ToolSearch();
    ts.register({ name: "rare", description: "niche", deferrable: true });
    expect(ts.activeSurface()).not.toContain("rare");
    ts.activate("rare");
    expect(ts.activeSurface()).toContain("rare");
  });

  it("activeSurfaceTokens is positive when the surface is non-empty", () => {
    const ts = new ToolSearch();
    ts.register({ name: "read", description: "read a file from disk now" });
    expect(ts.activeSurfaceTokens()).toBeGreaterThan(0);
  });

  it("fitBudget drops deferrable tools until the surface fits", () => {
    const ts = new ToolSearch();
    ts.register({ name: "core", description: "core tool always present" });
    // a deferrable tool activated, then budget forces it out
    ts.register({ name: "big", description: "a ".repeat(200) + "heavy tool", deferrable: true });
    ts.activate("big");
    const full = ts.fitBudget(Number.MAX_SAFE_INTEGER);
    expect(full).toContain("core");
    expect(full).toContain("big");
    // tiny budget → big is dropped, core survives
    const trimmed = ts.fitBudget(1);
    expect(trimmed).toContain("core");
    expect(trimmed).not.toContain("big");
  });
});

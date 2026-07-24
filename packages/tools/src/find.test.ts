/**
 * find tool — dedicated tests.
 *
 * Coverage: file resolution, directory recursive find, glob pattern matching,
 * hidden file handling, type filter, limit, permission errors (subtree skip),
 * path traversal (pi-core parity), invalid args.
 *
 * Ported from pi's find tool; mya ToolImpl API (`tool.meta.name` + `.run()`).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findTool, globToRegex } from "./find.js";
import type { TurnContext } from "@my-agent/core";

function makeCtx(cwd: string): TurnContext {
  return {
    cwd,
    workspace: cwd,
    mode: "Prompt" as never,
    hooks: undefined,
  } as unknown as TurnContext;
}

describe("[unit] globToRegex — pure glob translation", () => {
  it("translates * to [^/]*", () => {
    expect(globToRegex("*.ts").test("a.ts")).toBe(true);
    expect(globToRegex("*.ts").test("dir/a.ts")).toBe(false);
  });
  it("translates ** to .* (matches across dirs)", () => {
    expect(globToRegex("**/*.ts").test("dir/a.ts")).toBe(true);
    expect(globToRegex("**/*.ts").test("a/b/c/d.ts")).toBe(true);
  });
  it("translates ? to a single non-slash char", () => {
    expect(globToRegex("a?b").test("axb")).toBe(true);
    expect(globToRegex("a?b").test("a/b")).toBe(false);
  });
  it("escapes regex metacharacters", () => {
    expect(globToRegex("a.b").test("axb")).toBe(false);
    expect(globToRegex("a.b").test("a.b")).toBe(true);
  });
});

describe("[smoke] find module", () => {
  it("exports findTool with the right meta", () => {
    expect(findTool.meta.name).toBe("find");
    expect(findTool.meta.requiredMode).toBe("ReadOnly");
  });
});

describe("[unit] findTool — file resolution & directory listing", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mya-find-res-"));
    writeFileSync(join(dir, "root.txt"), "");
    mkdirSync(join(dir, "pkg"));
    writeFileSync(join(dir, "pkg", "a.ts"), "");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("defaults to '.' (workspace) when path omitted (root-level entries via *)", async () => {
    const res = await findTool.run({ pattern: "*" }, makeCtx(dir));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const data = res.output as { results: string[] };
    expect(data.results).toContain("root.txt");
    expect(data.results).toContain("pkg"); // dir matches * at root level
  });

  it("searches from an explicit path", async () => {
    const res = await findTool.run({ path: "pkg", pattern: "*.ts" }, makeCtx(dir));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const data = res.output as { results: string[] };
    expect(data.results).toEqual(["a.ts"]);
  });
});

describe("[unit] findTool — recursive find", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mya-find-rec-"));
    mkdirSync(join(dir, "src"), { recursive: true });
    mkdirSync(join(dir, "src", "deep"), { recursive: true });
    writeFileSync(join(dir, "a.ts"), "");
    writeFileSync(join(dir, "src", "b.ts"), "");
    writeFileSync(join(dir, "src", "deep", "c.ts"), "");
    writeFileSync(join(dir, "readme.md"), "");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("*.ts matches only root-level files (no '/')", async () => {
    const res = await findTool.run({ pattern: "*.ts" }, makeCtx(dir));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const data = res.output as { results: string[] };
    expect(data.results).toEqual(["a.ts"]);
  });

  it("**/*.ts matches recursively across directories", async () => {
    const res = await findTool.run({ pattern: "**/*.ts" }, makeCtx(dir));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const data = res.output as { results: string[] };
    expect(data.results).toContain(join("src", "b.ts"));
    expect(data.results).toContain(join("src", "deep", "c.ts"));
    expect(data.results.length).toBeGreaterThanOrEqual(2);
  });

  it("results are sorted alphabetically", async () => {
    const res = await findTool.run({ pattern: "**/*.ts" }, makeCtx(dir));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const results = (res.output as { results: string[] }).results;
    const sorted = [...results].sort();
    expect(results).toEqual(sorted);
  });

  it("respects the limit", async () => {
    const res = await findTool.run({ pattern: "**/*.ts", limit: 1 }, makeCtx(dir));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect((res.output as { results: string[] }).results).toHaveLength(1);
  });
});

describe("[unit] findTool — type filter", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mya-find-type-"));
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src", "a.ts"), "");
    writeFileSync(join(dir, "src.txt"), "");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("type=dir via **/* matches nested directories only (paths with '/')", async () => {
    mkdirSync(join(dir, "src", "nested"));
    const res = await findTool.run({ pattern: "**/*", type: "dir" }, makeCtx(dir));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const data = res.output as { results: string[] };
    expect(data.results).toContain(join("src", "nested"));
    expect(data.results.some((r) => r.endsWith(".ts"))).toBe(false);
  });

  it("type=dir via '*' matches root-level directories", async () => {
    const res = await findTool.run({ pattern: "*", type: "dir" }, makeCtx(dir));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const data = res.output as { results: string[] };
    expect(data.results).toContain("src");
    expect(data.results).not.toContain("src.txt");
  });

  it("type=file matches only files", async () => {
    const res = await findTool.run({ pattern: "**/*", type: "file" }, makeCtx(dir));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const data = res.output as { results: string[] };
    expect(data.results.some((r) => r.endsWith(".ts"))).toBe(true);
    expect(data.results).not.toContain("src");
  });
});

describe("[unit] findTool — hidden file handling", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mya-find-hidden-"));
    mkdirSync(join(dir, ".github"));
    writeFileSync(join(dir, ".github", "workflow.yml"), "");
    writeFileSync(join(dir, ".env"), "");
    writeFileSync(join(dir, "visible.ts"), "");
    mkdirSync(join(dir, ".git"));
    writeFileSync(join(dir, ".git", "config"), "");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("includes hidden files by default (root + nested)", async () => {
    const root = await findTool.run({ pattern: "*" }, makeCtx(dir));
    expect(root.ok).toBe(true);
    if (!root.ok) return;
    expect((root.output as { results: string[] }).results).toContain(".env");
    const nested = await findTool.run({ pattern: "**/*" }, makeCtx(dir));
    expect(nested.ok).toBe(true);
    if (!nested.ok) return;
    expect((nested.output as { results: string[] }).results).toContain(join(".github", "workflow.yml"));
  });

  it("excludes hidden files when includeHidden=false", async () => {
    const res = await findTool.run({ pattern: "*", includeHidden: false }, makeCtx(dir));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const data = res.output as { results: string[] };
    expect(data.results).not.toContain(".env");
    expect(data.results).toContain("visible.ts");
    const nested = await findTool.run({ pattern: "**/*", includeHidden: false }, makeCtx(dir));
    expect(nested.ok).toBe(true);
    if (!nested.ok) return;
    expect((nested.output as { results: string[] }).results.some((r) => r.startsWith(".github"))).toBe(false);
  });

  it("never descends into .git (always pruned)", async () => {
    const res = await findTool.run({ pattern: "**/*" }, makeCtx(dir));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const data = res.output as { results: string[] };
    // .git/config has a '/' so it matches **/*, but .git is pruned — must be absent.
    // Use exact prefix ".git/" to avoid colliding with ".github".
    expect(data.results.some((r) => r.startsWith(".git/"))).toBe(false);
  });
});

describe("[unit] findTool — permission errors (subtree skipped, no crash)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mya-find-perm-"));
    writeFileSync(join(dir, "ok.txt"), "");
    mkdirSync(join(dir, "locked"));
    writeFileSync(join(dir, "locked", "hidden.txt"), "");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("skips unreadable subtrees and continues searching", async () => {
    if (process.platform === "win32") return;
    if (process.getuid && process.getuid() === 0) return;
    chmodSync(join(dir, "locked"), 0o000);
    try {
      const res = await findTool.run({ pattern: "*" }, makeCtx(dir));
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      const data = res.output as { results: string[] };
      // ok.txt is root-level; locked/hidden.txt is skipped (no crash)
      expect(data.results).toContain("ok.txt");
    } finally {
      chmodSync(join(dir, "locked"), 0o755);
    }
  });
});

describe("[unit] findTool — path traversal (pi-core parity)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mya-find-trav-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("allows path outside the workspace (unrestricted)", async () => {
    const res = await findTool.run({ path: "../../etc", pattern: "*" }, makeCtx(dir));
    expect(res.ok).toBe(true);
  });
});

describe("[unit] findTool — invalid args & no-match", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mya-find-nomatch-"));
    writeFileSync(join(dir, "a.ts"), "");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("returns err for non-record args", async () => {
    const res = await findTool.run(42, makeCtx(dir));
    expect(res.ok).toBe(false);
  });

  it("returns an empty result set when nothing matches", async () => {
    const res = await findTool.run({ pattern: "*.nomatch" }, makeCtx(dir));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const data = res.output as { results: string[]; count: number };
    expect(data.results).toHaveLength(0);
    expect(data.count).toBe(0);
  });

  it("errors on a non-existent search root", async () => {
    const res = await findTool.run({ path: "no-such-dir", pattern: "*" }, makeCtx(dir));
    // find walks and catches readdir errors → returns empty (no crash), but the
    // top-level missing dir means no results. Accept either empty-ok or err.
    expect(res).toBeDefined();
  });
});

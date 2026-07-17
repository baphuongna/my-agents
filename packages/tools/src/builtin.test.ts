import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lsTool, findTool, globTool, grepTool } from "./builtin.js";
import type { TurnContext } from "@my-agent/core";

function makeCtx(cwd: string): TurnContext {
  return {
    cwd,
    workspace: cwd,
    mode: "Prompt" as never,
    hooks: undefined,
  } as unknown as TurnContext;
}

describe("lsTool", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "mya-ls-"));
    await mkdir(join(dir, "sub"));
    await writeFile(join(dir, "sub", "a.txt"), "hello");
    await writeFile(join(dir, "sub", "b.ts"), "code");
    await mkdir(join(dir, "sub", "nested"));
  });
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("lists directory entries with types", async () => {
    const res = await lsTool.run({ path: "sub" }, makeCtx(dir));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const data = res.output as { entries: Array<{ name: string; type: string; size?: number }>; count: number };
    expect(data.count).toBeGreaterThanOrEqual(3);
    const names = data.entries.map((e) => e.name);
    expect(names).toContain("a.txt");
    expect(names).toContain("b.ts");
    expect(names).toContain("nested");
    const subdir = data.entries.find((e) => e.name === "nested");
    expect(subdir?.type).toBe("dir");
    const txt = data.entries.find((e) => e.name === "a.txt");
    expect(txt?.type).toBe("file");
    expect(txt?.size).toBe(5);
  });

  it("includes truncated flag when limit exceeded", async () => {
    const res = await lsTool.run({ path: "sub", limit: 1 }, makeCtx(dir));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const data = res.output as { truncated: boolean };
    expect(data.truncated).toBe(true);
  });

  it("returns truncated=false when under limit", async () => {
    const res = await lsTool.run({ path: "sub", limit: 500 }, makeCtx(dir));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const data = res.output as { truncated: boolean };
    expect(data.truncated).toBe(false);
  });

  it("rejects path traversal", async () => {
    const res = await lsTool.run({ path: "../../etc" }, makeCtx(dir));
    expect(res.ok).toBe(false);
  });
});

describe("findTool", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "mya-find-"));
    await mkdir(join(dir, "src"));
    await mkdir(join(dir, "src", "deep"));
    await writeFile(join(dir, "a.ts"), "");
    await writeFile(join(dir, "src", "b.ts"), "");
    await writeFile(join(dir, "src", "deep", "c.ts"), "");
    await writeFile(join(dir, "readme.md"), "");
    await mkdir(join(dir, ".github"));
    await writeFile(join(dir, ".github", "workflow.yml"), "");
  });
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("finds files matching *.ts pattern (root level only)", async () => {
    const res = await findTool.run({ pattern: "*.ts" }, makeCtx(dir));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const data = res.output as { results: string[] };
    expect(data.results).toContain("a.ts");
    // *.ts does NOT recurse — src/b.ts should not match (has /)
    expect(data.results).not.toContain(join("src", "b.ts"));
  });

  it("finds files matching **/*.ts path pattern (recursive)", async () => {
    const res = await findTool.run({ pattern: "**/*.ts" }, makeCtx(dir));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const data = res.output as { results: string[] };
    // **/*.ts matches paths containing / — src/b.ts, src/deep/c.ts
    expect(data.results).toContain(join("src", "b.ts"));
    expect(data.results).toContain(join("src", "deep", "c.ts"));
    expect(data.results.length).toBeGreaterThanOrEqual(2);
  });

  it("respects limit", async () => {
    const res = await findTool.run({ pattern: "*.ts", limit: 1 }, makeCtx(dir));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const data = res.output as { results: string[] };
    expect(data.results.length).toBe(1);
  });

  it("finds files in .github directory (not .git)", async () => {
    const res = await findTool.run({ pattern: "**/*.yml" }, makeCtx(dir));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const data = res.output as { results: string[] };
    expect(data.results).toContain(join(".github", "workflow.yml"));
  });

  it("filters by type=dir", async () => {
    const res = await findTool.run({ pattern: "src", type: "dir" }, makeCtx(dir));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const data = res.output as { results: string[] };
    expect(data.results).toContain("src");
  });

  it("rejects path traversal", async () => {
    const res = await findTool.run({ path: "../../etc", pattern: "*" }, makeCtx(dir));
    expect(res.ok).toBe(false);
  });
});

describe("glob/grep cwd containment (S2)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "mya-glob-"));
    await writeFile(join(dir, "a.ts"), "const x = 1;\n");
  });
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("glob rejects cwd outside workspace", async () => {
    const res = await globTool.run({ pattern: "*.ts", cwd: "/etc" }, makeCtx(dir));
    expect(res.ok).toBe(false);
  });

  it("glob rejects cwd traversal escape", async () => {
    const res = await globTool.run({ pattern: "*.ts", cwd: "../../etc" }, makeCtx(dir));
    expect(res.ok).toBe(false);
  });

  it("glob allows cwd = workspace and finds files", async () => {
    const res = await globTool.run({ pattern: "*.ts", cwd: dir }, makeCtx(dir));
    expect(res.ok).toBe(true);
  });

  it("glob defaults to ctx.workspace when cwd omitted", async () => {
    const res = await globTool.run({ pattern: "*.ts" }, makeCtx(dir));
    expect(res.ok).toBe(true);
  });

  it("grep rejects cwd outside workspace", async () => {
    const res = await grepTool.run({ pattern: "x", cwd: "/etc" }, makeCtx(dir));
    expect(res.ok).toBe(false);
  });

  it("grep allows cwd = workspace", async () => {
    const res = await grepTool.run({ pattern: "const", cwd: dir }, makeCtx(dir));
    expect(res.ok).toBe(true);
  });
});

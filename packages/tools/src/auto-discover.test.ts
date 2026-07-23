/**
 * auto-discover.ts tests — boot-time tool export scanning.
 *
 * Covers: autoDiscoverTools (regex scan of `export const xxxTool`), missing dir,
 * non-.ts/.js files ignored, scanCustomToolDir (MYA_TOOLS_DIR env).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { autoDiscoverTools, scanCustomToolDir } from "./auto-discover.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "mya-autodiscover-"));
});
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe("auto-discover: autoDiscoverTools", () => {
  it("discovers `export const xxxTool` declarations in .ts files", async () => {
    await writeFile(
      join(dir, "tools.ts"),
      "export const readTool: ToolImpl = {} as ToolImpl;\nexport const writeTool: ToolImpl = {} as ToolImpl;\n",
    );
    const found = autoDiscoverTools(dir);
    expect(found).toContain("readTool");
    expect(found).toContain("writeTool");
    expect(found).toHaveLength(2);
  });

  it("discovers the `=` form too (export const xTool = ...)", async () => {
    await writeFile(join(dir, "more.js"), "export const globTool = {};\n");
    expect(autoDiscoverTools(dir)).toContain("globTool");
  });

  it("ignores names not ending in `Tool`", async () => {
    await writeFile(
      join(dir, "misc.ts"),
      "export const helper = 1;\nexport const realTool = {};\n",
    );
    const found = autoDiscoverTools(dir);
    expect(found).toContain("realTool");
    expect(found).not.toContain("helper");
  });

  it("ignores non-.ts/.js files", async () => {
    await writeFile(join(dir, "readme.md"), "export const mdTool = {};\n");
    expect(autoDiscoverTools(dir)).toEqual([]);
  });

  it("returns [] for a non-existent directory", () => {
    expect(autoDiscoverTools(join(dir, "does-not-exist"))).toEqual([]);
  });

  it("returns [] for an empty directory", () => {
    expect(autoDiscoverTools(dir)).toEqual([]);
  });
});

describe("auto-discover: scanCustomToolDir (MYA_TOOLS_DIR env)", () => {
  const prev = process.env.MYA_TOOLS_DIR;
  afterEach(() => {
    if (prev === undefined) delete process.env.MYA_TOOLS_DIR;
    else process.env.MYA_TOOLS_DIR = prev;
  });

  it("returns [] when MYA_TOOLS_DIR is unset", () => {
    delete process.env.MYA_TOOLS_DIR;
    expect(scanCustomToolDir()).toEqual([]);
  });

  it("scans the directory pointed to by MYA_TOOLS_DIR", async () => {
    await writeFile(join(dir, "custom.ts"), "export const myTool = {};\n");
    process.env.MYA_TOOLS_DIR = dir;
    expect(scanCustomToolDir()).toContain("myTool");
  });
});

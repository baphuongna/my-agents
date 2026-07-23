/**
 * path-safety.ts tests — write (lexical) vs read (canonical) path resolution.
 *
 * Covers: resolveInsideWorkspace (traversal/absolute-escape/symlink-escape),
 * resolveExistingInsideWorkspace (canonicalize + bound), isInsideWorkspace.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, symlink, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resolveInsideWorkspace,
  resolveExistingInsideWorkspace,
  isInsideWorkspace,
} from "./path-safety.js";

let ws: string;
beforeEach(async () => {
  ws = await mkdtemp(join(tmpdir(), "mya-pathsafety-"));
});
afterEach(async () => {
  if (ws) await rm(ws, { recursive: true, force: true });
});

describe("path-safety: resolveInsideWorkspace (WRITE — lexical)", () => {
  it("accepts a simple in-root relative path", () => {
    const r = resolveInsideWorkspace("src/a.ts", ws);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.abs.startsWith(ws)).toBe(true);
  });

  it("accepts a nested relative path", () => {
    const r = resolveInsideWorkspace("a/b/c.txt", ws);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.abs).toBe(join(ws, "a", "b", "c.txt"));
  });

  it("rejects parent-directory traversal (..)", () => {
    const r = resolveInsideWorkspace("../../etc/passwd", ws);
    expect(r.ok).toBe(false);
  });

  it("rejects a traversal buried inside the path", () => {
    const r = resolveInsideWorkspace("src/../../etc", ws);
    expect(r.ok).toBe(false);
  });

  it("rejects an absolute path that escapes the workspace", () => {
    const r = resolveInsideWorkspace("/etc/passwd", ws);
    expect(r.ok).toBe(false);
  });

  it("accepts an absolute path that IS the workspace root", () => {
    const r = resolveInsideWorkspace(ws, ws);
    expect(r.ok).toBe(true);
  });
});

describe("path-safety: resolveExistingInsideWorkspace (READ — canonical)", () => {
  beforeEach(async () => {
    await mkdir(join(ws, "src"));
    await writeFile(join(ws, "src", "a.ts"), "x");
  });

  it("resolves an existing in-root file canonically", () => {
    const r = resolveExistingInsideWorkspace("src/a.ts", ws);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.abs).toBe(join(ws, "src", "a.ts"));
  });

  it("falls back to lexical result for a non-existent file (read before write)", () => {
    const r = resolveExistingInsideWorkspace("src/does-not-exist.ts", ws);
    expect(r.ok).toBe(true);
  });

  it("rejects traversal before canonicalization", () => {
    const r = resolveExistingInsideWorkspace("../../etc/passwd", ws);
    expect(r.ok).toBe(false);
  });

  it("blocks a symlink that escapes the workspace", async () => {
    const target = await mkdtemp(join(tmpdir(), "escape-"));
    try {
      await symlink(target, join(ws, "evil"));
      const r = resolveExistingInsideWorkspace("evil/secret", ws);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("symlink-escape");
    } finally {
      await rm(target, { recursive: true, force: true });
    }
  });
});

describe("path-safety: isInsideWorkspace convenience", () => {
  it("returns true for an in-root path (write mode)", () => {
    expect(isInsideWorkspace("src/a.ts", ws, "write")).toBe(true);
  });

  it("returns false for a traversal (write mode)", () => {
    expect(isInsideWorkspace("../../etc", ws, "write")).toBe(false);
  });

  it("defaults to write mode when mode omitted", () => {
    expect(isInsideWorkspace("ok.txt", ws)).toBe(true);
    expect(isInsideWorkspace("../bad", ws)).toBe(false);
  });

  it("read mode returns false for traversal too", () => {
    expect(isInsideWorkspace("../../etc", ws, "read")).toBe(false);
  });
});

/**
 * Regression: FileBackend constructor must auto-create its memory dir.
 * Phase 17 fix: without it, `mya` (no args) crashes with ENOENT on fresh install
 * (when ~/.my-agent/memory doesn't exist yet).
 */
import { describe, it, expect } from "vitest";
import { FileBackend } from "./backends.js";
import { rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("FileBackend constructor auto-creates dir", () => {
  it("creates a non-existent dir on construction (idempotent)", async () => {
    const dir = join(tmpdir(), `mya-test-${Date.now()}-${Math.random()}`);
    // Pre-condition: dir must NOT exist
    await rm(dir, { recursive: true, force: true });
    await expect(stat(dir)).rejects.toThrow();

    new FileBackend("archivist" as never, dir);

    // Give the fire-and-forget mkdir a tick to complete.
    await new Promise((r) => setTimeout(r, 100));
    const s = await stat(dir);
    expect(s.isDirectory()).toBe(true);
    await rm(dir, { recursive: true, force: true });
  });

  it("is a no-op if the dir already exists", async () => {
    const dir = join(tmpdir(), `mya-test-existing-${Date.now()}`);
    const { mkdir } = await import("node:fs/promises");
    await mkdir(dir, { recursive: true });
    expect(() => new FileBackend("archivist" as never, dir)).not.toThrow();
    const s = await stat(dir);
    expect(s.isDirectory()).toBe(true);
    await rm(dir, { recursive: true, force: true });
  });
});

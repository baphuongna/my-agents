/**
 * ls tool — dedicated tests.
 *
 * Coverage: file resolution (default "."), directory listing, hidden files,
 * permission errors, binary file detection, limit/truncation, symlinks.
 *
 * Ported from pi's ls tool; mya ToolImpl API (`tool.meta.name` + `.run()`).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, chmodSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lsTool, looksBinary } from "./ls.js";
import type { TurnContext } from "@my-agent/core";

function makeCtx(cwd: string): TurnContext {
  return {
    cwd,
    workspace: cwd,
    mode: "Prompt" as never,
    hooks: undefined,
  } as unknown as TurnContext;
}

describe("[unit] looksBinary — pure heuristic", () => {
  it("returns false for empty content", () => {
    expect(looksBinary(new Uint8Array(0))).toBe(false);
  });

  it("returns true when a NUL byte is present", () => {
    const buf = new Uint8Array([0x68, 0x69, 0x00, 0x21]); // "hi\0!"
    expect(looksBinary(buf)).toBe(true);
  });

  it("returns false for plain ASCII text", () => {
    const buf = new TextEncoder().encode("Hello, world!\nThis is text.\n");
    expect(looksBinary(buf)).toBe(false);
  });

  it("returns true when control-byte ratio exceeds 30%", () => {
    // 10 bytes, 5 are control bytes (<0x09) → 50% → binary
    const buf = new Uint8Array([0x41, 0x01, 0x02, 0x42, 0x03, 0x04, 0x43, 0x05, 0x06, 0x44]);
    expect(looksBinary(buf)).toBe(true);
  });
});

describe("[smoke] ls module", () => {
  it("exports lsTool with the right meta", () => {
    expect(lsTool.meta.name).toBe("ls");
    expect(lsTool.meta.requiredMode).toBe("ReadOnly");
  });
});

describe("[unit] lsTool — file resolution & directory listing", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mya-ls-unit-"));
    mkdirSync(join(dir, "sub"));
    writeFileSync(join(dir, "sub", "a.txt"), "hello");
    writeFileSync(join(dir, "sub", "b.ts"), "code");
    mkdirSync(join(dir, "sub", "nested"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("defaults to '.' (workspace) when path omitted", async () => {
    const res = await lsTool.run({}, makeCtx(join(dir, "sub")));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const data = res.output as { entries: Array<{ name: string }> };
    const names = data.entries.map((e) => e.name);
    expect(names).toContain("a.txt");
    expect(names).toContain("nested");
  });

  it("lists entries with dir/file type and file size", async () => {
    const res = await lsTool.run({ path: "sub" }, makeCtx(dir));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const data = res.output as { entries: Array<{ name: string; type: string; size?: number }> };
    const txt = data.entries.find((e) => e.name === "a.txt");
    expect(txt?.type).toBe("file");
    expect(txt?.size).toBe(5);
    const subdir = data.entries.find((e) => e.name === "nested");
    expect(subdir?.type).toBe("dir");
  });

  it("sorts entries case-insensitively", async () => {
    writeFileSync(join(dir, "sub", "Zebra.txt"), "");
    writeFileSync(join(dir, "sub", "apple.txt"), "");
    const res = await lsTool.run({ path: "sub" }, makeCtx(dir));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const names = (res.output as { entries: Array<{ name: string }> }).entries.map((e) => e.name);
    const z = names.indexOf("Zebra.txt");
    const a = names.indexOf("apple.txt");
    expect(a).toBeLessThan(z); // apple before Zebra (case-insensitive)
  });

  it("returns (empty) count 0 for an empty directory", async () => {
    mkdirSync(join(dir, "emptydir"));
    const res = await lsTool.run({ path: "emptydir" }, makeCtx(dir));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const data = res.output as { entries: unknown[]; count: number };
    expect(data.entries).toHaveLength(0);
    expect(data.count).toBe(0);
  });

  it("errors on a non-existent path", async () => {
    const res = await lsTool.run({ path: "does-not-exist" }, makeCtx(dir));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/ENOENT|no such/i);
  });

  it("errors when the path is a file, not a directory", async () => {
    writeFileSync(join(dir, "afile.txt"), "x");
    const res = await lsTool.run({ path: "afile.txt" }, makeCtx(dir));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/ENOTDIR|not a directory/i);
  });
});

describe("[unit] lsTool — hidden files (dotfiles) included by default", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mya-ls-hidden-"));
    writeFileSync(join(dir, ".hidden"), "secret");
    writeFileSync(join(dir, "visible.txt"), "data");
    mkdirSync(join(dir, ".configdir"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("includes dotfiles in the listing", async () => {
    const res = await lsTool.run({ path: "." }, makeCtx(dir));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const names = (res.output as { entries: Array<{ name: string }> }).entries.map((e) => e.name);
    expect(names).toContain(".hidden");
    expect(names).toContain("visible.txt");
    expect(names).toContain(".configdir");
  });
});

describe("[unit] lsTool — binary file detection", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mya-ls-bin-"));
    writeFileSync(join(dir, "text.txt"), "plain text content\n");
    // A file with a NUL byte → binary.
    writeFileSync(join(dir, "blob.bin"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0d, 0x0a]));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("does NOT mark binary when detectBinary is false (default)", async () => {
    const res = await lsTool.run({ path: "." }, makeCtx(dir));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const blob = (res.output as { entries: Array<{ name: string; binary?: boolean }> }).entries.find((e) => e.name === "blob.bin");
    expect(blob?.binary).toBeUndefined();
  });

  it("marks binary files when detectBinary is true", async () => {
    const res = await lsTool.run({ path: ".", detectBinary: true }, makeCtx(dir));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const entries = (res.output as { entries: Array<{ name: string; binary?: boolean }> }).entries;
    const blob = entries.find((e) => e.name === "blob.bin");
    const text = entries.find((e) => e.name === "text.txt");
    expect(blob?.binary).toBe(true);
    expect(text?.binary).toBe(false);
  });
});

describe("[unit] lsTool — symlinks", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mya-ls-sym-"));
    writeFileSync(join(dir, "target.txt"), "t");
    try {
      symlinkSync("target.txt", join(dir, "link.txt"));
    } catch {
      // Some CI sandboxes forbid symlinks; the test below skips on failure.
    }
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("reports symlink type", async () => {
    const res = await lsTool.run({ path: "." }, makeCtx(dir));
    if (!res.ok) return; // symlink creation may have failed in sandbox
    const link = (res.output as { entries: Array<{ name: string; type: string }> }).entries.find((e) => e.name === "link.txt");
    if (!link) return; // skip if symlink wasn't created
    expect(link.type).toBe("symlink");
  });
});

describe("[unit] lsTool — permission errors", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mya-ls-perm-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("returns a failed ToolResult when the directory is unreadable", async () => {
    // Skip on platforms/users where chmod has no effect (e.g. running as root).
    if (process.platform === "win32") return;
    if (process.getuid && process.getuid() === 0) return;
    mkdirSync(join(dir, "noperm"));
    writeFileSync(join(dir, "noperm", "secret.txt"), "x");
    chmodSync(join(dir, "noperm"), 0o000);
    try {
      const res = await lsTool.run({ path: "noperm" }, makeCtx(dir));
      // Either the readdir fails (EACCES) → err, or entries come back empty.
      if (!res.ok) {
        expect(res.error).toMatch(/EACCES|permission/i);
      } else {
        // Some systems still allow read; just confirm no crash.
        expect(res.output).toBeDefined();
      }
    } finally {
      chmodSync(join(dir, "noperm"), 0o755); // restore so cleanup works
    }
  });
});

describe("[unit] lsTool — limit & truncation", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mya-ls-limit-"));
    for (let i = 0; i < 5; i++) writeFileSync(join(dir, `f${i}.txt`), "");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("caps the entry count at limit and sets truncated=true", async () => {
    const res = await lsTool.run({ path: ".", limit: 2 }, makeCtx(dir));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const data = res.output as { entries: unknown[]; truncated: boolean; count: number };
    expect(data.entries).toHaveLength(2);
    expect(data.truncated).toBe(true);
  });

  it("sets truncated=false when under the limit", async () => {
    const res = await lsTool.run({ path: ".", limit: 500 }, makeCtx(dir));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect((res.output as { truncated: boolean }).truncated).toBe(false);
  });
});

describe("[unit] lsTool — invalid args", () => {
  it("returns err for non-record args", async () => {
    const res = await lsTool.run("not-an-object", makeCtx(process.cwd()));
    expect(res.ok).toBe(false);
  });
});

/**
 * Phase 26 tests: F3 (export path-traversal) + F4 (import arbitrary read)
 * + F5 (TOML injection / config key allow-list).
 */
import { describe, it, expect } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { containPath, containExistingPath, defaultReadRoots } from "./pathGuard.js";
import { readConfig, writeConfig, validateKey, validateValue, CONFIG_KEY_ALLOWLIST } from "./configStore.js";

const TMP = join(tmpdir(), `mya-sec-${Date.now()}-${Math.random()}`);

describe("pathGuard.containPath (F3)", () => {
  it("allows plain relative paths inside root", async () => {
    await mkdir(TMP, { recursive: true });
    const r = await containPath("a/b/c.txt", TMP);
    expect(r).not.toBeNull();
    expect(r!.startsWith(TMP)).toBe(true);
    await rm(TMP, { recursive: true, force: true });
  });
  it("rejects path-traversal with '..'", async () => {
    await mkdir(TMP, { recursive: true });
    const r = await containPath("../../etc/passwd", TMP);
    expect(r).toBeNull();
    await rm(TMP, { recursive: true, force: true });
  });
  it("rejects a path whose resolved realparent escapes root", async () => {
    await mkdir(TMP, { recursive: true });
    // Construct an absolute path under /tmp/../etc via a name that escapes.
    // The real escape is ".." segments that, after resolution, leave the root.
    const r = await containPath("/../etc/shadow", TMP);
    expect(r).toBeNull();
    await rm(TMP, { recursive: true, force: true });
  });
  it("rejects embedded newlines", async () => {
    await mkdir(TMP, { recursive: true });
    const r = await containPath("foo\nbar", TMP);
    expect(r).toBeNull();
    await rm(TMP, { recursive: true, force: true });
  });
});

describe("pathGuard.containExistingPath (F4)", () => {
  it("allows existing file in cwd", async () => {
    await mkdir(TMP, { recursive: true });
    const target = join(TMP, "ok.txt");
    await writeFile(target, "hello", "utf8");
    const r = await containExistingPath(target, [TMP]);
    expect(r).toBe(target);
    await rm(TMP, { recursive: true, force: true });
  });
  it("rejects /etc/passwd", async () => {
    const r = await containExistingPath("/etc/passwd", defaultReadRoots("/tmp"));
    expect(r).toBeNull();
  });
  it("rejects nonexistent path", async () => {
    const r = await containExistingPath("/nonexistent/never/file.txt", defaultReadRoots("/tmp"));
    expect(r).toBeNull();
  });
});

describe("configStore validateKey/validateValue (F5)", () => {
  it("rejects unknown key", () => {
    expect(validateKey("evilKey")).toMatch(/unknown/);
    expect(validateKey("")).toMatch(/unknown/);
  });
  it("accepts allow-listed key", () => {
    for (const k of CONFIG_KEY_ALLOWLIST) expect(validateKey(k)).toBeNull();
  });
  it("rejects value with newline (TOML section injection)", () => {
    expect(validateValue("good\n[evil]\nfoo = 1")).toMatch(/forbidden/);
  });
  it("rejects value with CR/NUL/control chars", () => {
    expect(validateValue("a\x00b")).toMatch(/forbidden/);
    expect(validateValue("a\rb")).toMatch(/forbidden/);
    expect(validateValue("a\tb")).toMatch(/forbidden/);
  });
  it("rejects triple-quote sequence", () => {
    const triple = String.fromCharCode(34).repeat(3);
    expect(validateValue("ok " + triple + " bad")).toMatch(/forbidden/);
  });
  it("accepts normal value with spaces + punctuation", () => {
    expect(validateValue("hello world (gpt-4.1)")).toBeNull();
  });
  it("rejects value > 1024 chars", () => {
    expect(validateValue("x".repeat(1025))).toMatch(/too long/);
  });
});

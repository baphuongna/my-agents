/**
 * Phase 26 tests: F3 (export path-traversal) + F4 (import arbitrary read)
 * + F5 (TOML injection / config key allow-list).
 */
import { describe, it, expect } from "vitest";
import { mkdir, writeFile, rm, readFile } from "node:fs/promises";
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
    const r = await containExistingPath("/etc/passwd", await defaultReadRoots("/tmp"));
    expect(r).toBeNull();
  });
  it("rejects nonexistent path", async () => {
    const r = await containExistingPath("/nonexistent/never/file.txt", await defaultReadRoots("/tmp"));
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

describe("Phase 26 follow-up: symlink attacks blocked", () => {
  it("containPath rejects a dangling final symlink (F3-1)", async () => {
    const dir = join(tmpdir(), `mya-sym-${Date.now()}-${Math.random()}`);
    await mkdir(dir, { recursive: true });
    // Create a dangling symlink INSIDE the root pointing outside.
    await import("node:fs/promises").then((fs) => fs.symlink("/nonexistent/never/file.txt", join(dir, "evil.md")));
    const r = await containPath("evil.md", dir);
    expect(r).toBeNull(); // rejected — symlink at final leaf
    await rm(dir, { recursive: true, force: true });
  });
  it("containExistingPath rejects symlinked ~/.my-agent (F4-1)", async () => {
    const dir = join(tmpdir(), `mya-home-${Date.now()}-${Math.random()}`);
    await mkdir(dir, { recursive: true });
    // Symlink a fake ~/.my-agent to /etc so /import /etc/passwd would be inside the symlinked target.
    const fakeHome = join(dir, "home");
    await mkdir(fakeHome, { recursive: true });
    await import("node:fs/promises").then((fs) =>
      fs.symlink("/etc", join(fakeHome, ".my-agent")),
    );
    const roots = await defaultReadRoots(fakeHome); // should be empty (symlinked root rejected)
    expect(roots).not.toContain(join(fakeHome, ".my-agent"));
    await rm(dir, { recursive: true, force: true });
  });
  it("writeConfig rejects when config.toml is a symlink (F5-1)", async () => {
    // Set HOME to a fake directory; symlink config.toml to /tmp/elsewhere.
    const fakeHome = join(tmpdir(), `mya-cfg-${Date.now()}-${Math.random()}`);
    await mkdir(fakeHome + "/.my-agent", { recursive: true });
    const elsewhere = join(tmpdir(), `mya-elsewhere-${Date.now()}`);
    await mkdir(elsewhere, { recursive: true });
    await writeFile(join(elsewhere, "config.toml"), "evil = 1\n", "utf8");
    await import("node:fs/promises").then((fs) =>
      fs.symlink(join(elsewhere, "config.toml"), join(fakeHome, ".my-agent", "config.toml")),
    );
    process.env["HOME"] = fakeHome;
    try {
      await writeConfig("model", "gpt-4");
      // If write went through, it followed the symlink and wrote to elsewhere/config.toml
      const offending = await readFile(join(elsewhere, "config.toml"), "utf8");
      expect(offending).toContain("evil = 1"); // unchanged — write was refused
    } catch (e: unknown) {
      // expected — writeConfig throws on symlink ref
      expect(String((e as Error).message)).toMatch(/symlink|outside/i);
    } finally {
      await rm(fakeHome, { recursive: true, force: true });
      await rm(elsewhere, { recursive: true, force: true });
    }
  });
});

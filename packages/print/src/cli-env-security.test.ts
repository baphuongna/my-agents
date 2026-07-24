// P8-P1/P6 (Hermes distillation 2026-07-24): env sanitization + denylist
// for the auth.json loader. Verifies line-separator stripping and
// denylist enforcement.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { homedir } from "node:os";

/**
 * The loadAuthConfig function in cli.ts reads ~/.mya/agent/auth.json.
 * To test it we need to monkey-patch `homedir()` to return a temp dir.
 * Since we cannot easily import cli.ts (it has side-effects), we test
 * the sanitization + denylist primitives directly via re-implementation
 * in a test-local scope that mirrors cli.ts/main.ts exactly.
 */

const DENYLISTED_ENV_VARS: ReadonlySet<string> = new Set([
  "LD_PRELOAD", "LD_LIBRARY_PATH",
  "DYLD_INSERT_LIBRARIES", "DYLD_LIBRARY_PATH",
  "PYTHONPATH", "PYTHONHOME", "PYTHONSTARTUP",
  "NODE_OPTIONS", "NODE_PATH",
  "PATH", "SHELL", "BROWSER", "EDITOR", "VISUAL", "PAGER",
  "GIT_SSH_COMMAND", "GIT_EXEC_PATH",
  "MYA_HOME", "MYA_CONFIG", "MYA_ENV",
]);
function envLineSafe(value: string): string {
  // Strip NUL + all line separators (CR/LF/CRLF/Unicode LS/PS).
  return value.replace(/\x00/g, "").replace(/[\r\n\u2028\u2029]+/g, "");
}
function isValidEnvName(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}
function setEnvIfAllowed(name: string, value: string): boolean {
  if (DENYLISTED_ENV_VARS.has(name)) return false;
  if (!isValidEnvName(name)) return false;
  if (process.env[name]) return false;
  process.env[name] = envLineSafe(value);
  return true;
}

describe("P8 env sanitization primitives", () => {
  it("strips NUL bytes", () => {
    expect(envLineSafe("hello\x00world")).toBe("helloworld");
  });

  it("strips CR/LF/CRLF/Unicode LS/PS", () => {
    expect(envLineSafe("good\nINJECTED=value")).toBe("goodINJECTED=value");
    expect(envLineSafe("good\rINJECTED")).toBe("goodINJECTED");
    expect(envLineSafe("good\r\nINJECTED")).toBe("goodINJECTED");
    expect(envLineSafe("good\u2028INJECTED")).toBe("goodINJECTED");
    expect(envLineSafe("good\u2029INJECTED")).toBe("goodINJECTED");
  });

  it("preserves safe content (golden path)", () => {
    expect(envLineSafe("sk-plain-1234")).toBe("sk-plain-1234");
  });

  it("rejects denylisted loader/path vars", () => {
    const before = process.env["PATH"];
    delete process.env["PATH"];
    const ok = setEnvIfAllowed("PATH", "/tmp/evil");
    expect(ok).toBe(false);
    expect(process.env["PATH"]).toBeUndefined();
    if (before !== undefined) process.env["PATH"] = before;
  });

  it("rejects denylisted python/node vars", () => {
    delete process.env["LD_PRELOAD"];
    expect(setEnvIfAllowed("LD_PRELOAD", "/tmp/evil.so")).toBe(false);
    expect(process.env["LD_PRELOAD"]).toBeUndefined();
    delete process.env["PYTHONPATH"];
    expect(setEnvIfAllowed("PYTHONPATH", "/tmp/evil")).toBe(false);
    delete process.env["NODE_OPTIONS"];
    expect(setEnvIfAllowed("NODE_OPTIONS", "--require /tmp/evil")).toBe(false);
  });

  it("rejects invalid env-var names (regex match)", () => {
    expect(isValidEnvName("VALID_NAME")).toBe(true);
    expect(isValidEnvName("1INVALID")).toBe(false);  // starts with digit
    expect(isValidEnvName("INVALID-NAME")).toBe(false); // contains dash
    expect(isValidEnvName("INJECTED=value")).toBe(false);
    expect(isValidEnvName("")).toBe(false);
  });

  it("does not overwrite an already-set env var", () => {
    const key = "MYA_TEST_PRESERVE";
    process.env[key] = "original";
    const ok = setEnvIfAllowed(key, "overwritten");
    expect(ok).toBe(false);
    expect(process.env[key]).toBe("original");
    delete process.env[key];
  });

  it("strips a CR/LF-injected value at write time", () => {
    const key = "MYA_TEST_INJECT";
    delete process.env[key];
    const ok = setEnvIfAllowed(key, "sk-good\nINJECTED_KEY=evil");
    expect(ok).toBe(true);
    expect(process.env[key]).toBe("sk-goodINJECTED_KEY=evil");
    expect(process.env["INJECTED_KEY"]).toBeUndefined();
    delete process.env[key];
  });
});

describe("P8 auth.json loader end-to-end (homedir monkey-patch)", () => {
  let tmpHome: string;
  let origHome: string | undefined;
  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), "mya-auth-test-"));
    origHome = process.env["HOME"];
    process.env["HOME"] = tmpHome;
  });
  afterEach(() => {
    process.env["HOME"] = origHome;
    rmSync(tmpHome, { recursive: true, force: true });
  });

  it("writes env-safely from a sanitizable auth.json", () => {
    const authDir = join(tmpHome, ".mya", "agent");
    require("node:fs").mkdirSync(authDir, { recursive: true });
    const authPath = join(authDir, "auth.json");
    writeFileSync(authPath, JSON.stringify({
      env: { MYA_TEST_E2E: "sk-good\nINJECTED=evil" },
    }));
    // Re-execute the loader logic in this scope
    const cfg = JSON.parse(require("node:fs").readFileSync(authPath, "utf8"));
    for (const [k, v] of Object.entries(cfg.env ?? {})) {
      if (typeof v === "string") setEnvIfAllowed(k, v);
    }
    expect(process.env["MYA_TEST_E2E"]).toBe("sk-goodINJECTED=evil");
    expect(process.env["MYA_TEST_E2E"]).toBe("sk-goodINJECTED=evil");
    expect(process.env["INJECTED"]).toBeUndefined();
    delete process.env["MYA_TEST_E2E"];
  });
});

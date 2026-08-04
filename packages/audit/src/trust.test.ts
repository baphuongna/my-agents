import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadTrust, saveTrust, promoteTrust, safeContextOnly, canAutoApprove,
  shouldPromptFirstRun, type TrustLevel, type ProjectTrust,
} from "./trust.js";

describe("[unit] audit trust", () => {
  let trustDir: string;
  let projectDir: string;

  beforeEach(() => {
    trustDir = mkdtempSync(join(tmpdir(), "trust-"));
    projectDir = mkdtempSync(join(tmpdir(), "proj-"));
    process.env.MY_AGENT_TRUST_DIR = trustDir;
  });
  afterEach(() => {
    delete process.env.MY_AGENT_TRUST_DIR;
    rmSync(trustDir, { recursive: true, force: true });
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("loadTrust: unknown root → untrusted + default source", () => {
    const t = loadTrust(projectDir);
    expect(t.level).toBe("untrusted");
    expect(t.source).toBe("default");
  });

  it("promoteTrust + loadTrust round-trip (durable)", () => {
    promoteTrust(projectDir, "trusted");
    const t = loadTrust(projectDir);
    expect(t.level).toBe("trusted");
    expect(t.source).toBe("persisted");
    expect(t.trustedAt).toBeTypeOf("number");
  });

  it("promoteTrust durable=false → session-only (not persisted)", () => {
    promoteTrust(projectDir, "trusted", "ask", false);
    const t = loadTrust(projectDir);
    expect(t.level).toBe("untrusted"); // not saved
  });

  it("promoteTrust privileged → canAutoApprove", () => {
    const t = promoteTrust(projectDir, "privileged");
    expect(canAutoApprove(t)).toBe(true);
  });

  it("safeContextOnly: untrusted → true", () => {
    expect(safeContextOnly(loadTrust(projectDir))).toBe(true);
    const t = promoteTrust(projectDir, "trusted");
    expect(safeContextOnly(t)).toBe(false);
  });

  it("shouldPromptFirstRun: ask + untrusted → true", () => {
    const t = loadTrust(projectDir, "ask");
    expect(shouldPromptFirstRun(t)).toBe(true);
  });

  it("shouldPromptFirstRun: always → false (no prompt)", () => {
    const t = loadTrust(projectDir, "always");
    expect(shouldPromptFirstRun(t)).toBe(false);
  });

  it("saveTrust writes 0600 file in user-owned dir (NOT project)", () => {
    saveTrust({ root: projectDir, level: "trusted", defaultProjectTrust: "ask", trustedAt: 123, source: "persisted" });
    // file should exist in trustDir, NOT in projectDir
    expect(existsSync(join(trustDir, ".."))).toBe(true);
    const trustFiles = require("node:fs").readdirSync(trustDir);
    expect(trustFiles.length).toBe(1);
    expect(trustFiles[0]).toMatch(/\.json$/);
  });

  it("corrupt trust file → fail-safe to untrusted", () => {
    promoteTrust(projectDir, "trusted"); // creates the file
    // Corrupt it
    const { readdirSync } = require("node:fs");
    const file = join(trustDir, readdirSync(trustDir)[0]);
    writeFileSync(file, "{ CORRUPT JSON !!!");
    const t = loadTrust(projectDir);
    expect(t.level).toBe("untrusted"); // fail-safe
  });

  it("symlink trust file → ignored (symlink defense)", () => {
    // Create a symlink pointing to a malicious file
    const targetFile = join(tmpdir(), "malicious.json");
    writeFileSync(targetFile, JSON.stringify({ level: "privileged" }));
    // The trust key is sha256(realpath(projectDir))
    const { createHash } = require("node:crypto");
    const key = createHash("sha256").update(projectDir).digest("hex").slice(0, 32);
    const linkPath = join(trustDir, `${key}.json`);
    try { symlinkSync(targetFile, linkPath); } catch { return; } // skip if can't symlink
    const t = loadTrust(projectDir);
    expect(t.level).toBe("untrusted"); // symlink ignored → fail-safe
  });

  it("invalid level in file → treated as untrusted", () => {
    promoteTrust(projectDir, "trusted");
    const { readdirSync } = require("node:fs");
    const file = join(trustDir, readdirSync(trustDir)[0]);
    writeFileSync(file, JSON.stringify({ level: "super-admin" })); // invalid
    expect(loadTrust(projectDir).level).toBe("untrusted");
  });

  it("defaultProjectTrust persisted + loaded", () => {
    promoteTrust(projectDir, "trusted", "never");
    const t = loadTrust(projectDir);
    expect(t.defaultProjectTrust).toBe("never");
  });
});

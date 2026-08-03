import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildAgentEnv } from "./build-env.js";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("[unit] buildAgentEnv", () => {
  let origHome: string | undefined;
  let tmpHome: string;

  beforeEach(() => {
    origHome = process.env.HOME;
    tmpHome = mkdtempSync(join(tmpdir(), "build-env-test-"));
    process.env.HOME = tmpHome;
  });

  afterEach(() => {
    if (origHome !== undefined) process.env.HOME = origHome;
    rmSync(tmpHome, { recursive: true, force: true });
  });

  it("returns empty env when auth.json missing", () => {
    const env = buildAgentEnv();
    expect(env.PI_CODING_AGENT_DIR).toBeDefined();
    expect(env.PI_CODING_AGENT_DIR).toContain(".mya/agent");
  });

  it("maps api_key credentials to env vars", () => {
    mkdirSync(join(tmpHome, ".mya", "agent"), { recursive: true });
    writeFileSync(
      join(tmpHome, ".mya", "agent", "auth.json"),
      JSON.stringify({ anthropic: { type: "api_key", key: "sk-test-123" } }),
    );
    const env = buildAgentEnv();
    expect(env.ANTHROPIC_API_KEY).toBe("sk-test-123");
  });

  it("passes through env block from auth.json", () => {
    mkdirSync(join(tmpHome, ".mya", "agent"), { recursive: true });
    writeFileSync(
      join(tmpHome, ".mya", "agent", "auth.json"),
      JSON.stringify({ env: { CUSTOM_VAR: "custom-value" } }),
    );
    const env = buildAgentEnv();
    expect(env.CUSTOM_VAR).toBe("custom-value");
  });

  it("always sets PI_CODING_AGENT_DIR", () => {
    const env = buildAgentEnv();
    expect(env.PI_CODING_AGENT_DIR).toContain(".mya");
  });

  it("skips oauth credentials", () => {
    mkdirSync(join(tmpHome, ".mya", "agent"), { recursive: true });
    writeFileSync(
      join(tmpHome, ".mya", "agent", "auth.json"),
      JSON.stringify({ google: { type: "oauth", key: "token" } }),
    );
    const env = buildAgentEnv();
    expect(env.GOOGLE_API_KEY).toBeUndefined();
  });

  it("rejects array as auth.json root", () => {
    mkdirSync(join(tmpHome, ".mya", "agent"), { recursive: true });
    writeFileSync(join(tmpHome, ".mya", "agent", "auth.json"), JSON.stringify(["not", "valid"]));
    const env = buildAgentEnv();
    expect(env.PI_CODING_AGENT_DIR).toBeDefined();
  });
});

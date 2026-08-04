import { describe, it, expect, vi } from "vitest";
import { startMcpOAuth, completeMcpOAuth, getMcpToken } from "./mcp-oauth.js";
import type { SecretStore } from "@my-agent/secrets";

function mockStore(): SecretStore {
  return {
    writeSealedFile: vi.fn(),
    resolve: vi.fn(() => null),
  } as unknown as SecretStore;
}

describe("[unit] MCP OAuth", () => {
  it("startMcpOAuth returns url + state", () => {
    const result = startMcpOAuth("server1", "https://auth.example.com/authorize", "https://localhost/callback");
    expect(result.url).toContain("auth.example.com");
    expect(result.state).toContain("server1");
  });

  it("startMcpOAuth includes PKCE code_challenge in URL", () => {
    const result = startMcpOAuth("s1", "https://auth.example.com/authorize", "https://cb");
    expect(result.url).toContain("code_challenge");
    expect(result.url).toContain("code_challenge_method");
  });

  it("startMcpOAuth includes state in URL", () => {
    const result = startMcpOAuth("s1", "https://auth.example.com/authorize", "https://cb");
    expect(result.url).toContain(`state=${encodeURIComponent(result.state)}`);
  });

  it("completeMcpOAuth: invalid state → error", async () => {
    const r = await completeMcpOAuth("invalid-state", "code", "https://token", "cid", mockStore());
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/invalid or expired/);
  });

  it("getMcpToken: no token stored → null", () => {
    expect(getMcpToken("unknown-server", mockStore())).toBeNull();
  });

  it("startMcpOAuth with scopes", () => {
    const result = startMcpOAuth("s1", "https://auth.example.com/authorize", "https://cb", "client1", ["read", "write"]);
    expect(result.url).toContain("scope=");
  });
});

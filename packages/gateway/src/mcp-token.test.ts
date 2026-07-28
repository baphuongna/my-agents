/**
 * Tests for MCP OAuth token helpers (mcp-oauth.ts):
 *   - getMcpToken: retrieve a stored OAuth token from a SecretStore.
 *   - startMcpOAuth: begin a PKCE flow (returns url + state).
 *
 * No real network calls — the SecretStore is a minimal in-memory fake.
 */
import { describe, it, expect } from "vitest";
import { getMcpToken, startMcpOAuth } from "./mcp-oauth.js";
import type { SecretStore, SecretRef } from "@my-agent/secrets";

/** Minimal in-memory fake SecretStore for testing token retrieval. */
function fakeStore(files: Record<string, string> = {}): SecretStore {
  return {
    resolve: (spec: SecretRef) => {
      if (spec.from === "file") return files[spec.ref] ?? null;
      return null;
    },
    writeSealedFile: (path: string, data: string) => {
      files[path] = data;
    },
  } as unknown as SecretStore;
}

describe("getMcpToken", () => {
  it("returns null when no token file exists", () => {
    const store = fakeStore();
    expect(getMcpToken("missing-server", store)).toBeNull();
  });

  it("returns the stored token JSON when the file exists", () => {
    const tokenJson = JSON.stringify({ access_token: "abc123", token_type: "bearer" });
    const store = fakeStore();
    // Write to the expected ~/.mya/mcp-tokens/<serverId>.json path
    const { join } = require("node:path");
    const { homedir } = require("node:os");
    const tokenPath = join(homedir(), ".mya", "mcp-tokens", "my-server.json");
    store.writeSealedFile(tokenPath, tokenJson);
    expect(getMcpToken("my-server", store)).toBe(tokenJson);
  });

  it("returns null when resolve throws", () => {
    const store = {
      resolve: () => {
        throw new Error("disk error");
      },
      writeSealedFile: () => {},
    } as unknown as SecretStore;
    expect(getMcpToken("any", store)).toBeNull();
  });
});

describe("startMcpOAuth", () => {
  it("returns a URL and state for a server", () => {
    const result = startMcpOAuth(
      "server-1",
      "https://auth.example.com/authorize",
      "http://localhost:3000/callback",
      "client-xyz",
      ["read", "write"],
    );
    expect(result.url).toContain("https://auth.example.com/authorize");
    expect(result.url).toContain("client_id=client-xyz");
    expect(result.url).toContain("code_challenge=");
    expect(result.state).toContain("server-1");
  });

  it("uses a default clientId when not specified", () => {
    const result = startMcpOAuth(
      "s2",
      "https://auth.example.com/authorize",
      "http://localhost:3000/callback",
    );
    expect(result.url).toContain("client_id=mya-mcp");
  });
});

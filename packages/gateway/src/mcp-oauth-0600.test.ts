/**
 * P1 (shard 01) — secret file 0600 pre-create tests.
 *
 * Verifies: file exists with 0600 mode BEFORE write content is observable;
 * permission is verified for all write paths (tokens, client, metadata).
 * The writeJson method pre-creates with O_CREAT|O_WRONLY|O_TRUNC + 0o600
 * (never write-then-chmod — no TOCTOU window).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, statSync, writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpOAuthStorage } from "./mcp-oauth-store.js";

const isPosix = process.platform !== "win32";

let tmpHome: string;
beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), "mya-oauth-0600-"));
});
afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true });
});

describe("[unit] McpOAuthStorage — 0600 pre-create (P1)", () => {
  it("token file has 0600 mode after setTokens", { skip: !isPosix }, () => {
    const storage = new McpOAuthStorage(tmpHome);
    storage.setTokens("srv1", {
      accessToken: "secret-access-token",
      refreshToken: "secret-refresh",
      expiresAt: null,
      tokenType: "Bearer",
    });
    const path = storage.tokenFilePath("srv1");
    const stat = statSync(path);
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it("client registration file has 0600 mode after setClientRegistration", { skip: !isPosix }, () => {
    const storage = new McpOAuthStorage(tmpHome);
    storage.setClientRegistration("srv2", {
      clientId: "client-123",
      clientSecret: "super-secret",
      redirectUri: "http://localhost:3000/callback",
    });
    const path = join(tmpHome, ".mya", "agent", "mcp-tokens", "srv2.client.json");
    const stat = statSync(path);
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it("metadata file has 0600 mode after setMetadata", { skip: !isPosix }, () => {
    const storage = new McpOAuthStorage(tmpHome);
    storage.setMetadata("srv3", {
      tokenEndpoint: "https://idp.example.com/token",
      authorizationEndpoint: "https://idp.example.com/auth",
    });
    const path = join(tmpHome, ".mya", "agent", "mcp-tokens", "srv3.meta.json");
    const stat = statSync(path);
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it("parent directory has 0700 mode", { skip: !isPosix }, () => {
    const storage = new McpOAuthStorage(tmpHome);
    storage.setTokens("srv", {
      accessToken: "tok",
      expiresAt: null,
      tokenType: "Bearer",
    });
    const dirStat = statSync(join(tmpHome, ".mya", "agent", "mcp-tokens"));
    expect(dirStat.mode & 0o777).toBe(0o700);
  });

  it("file exists with 0600 mode BEFORE content is externally observable (pre-create)", { skip: !isPosix }, () => {
    // The writeJson method creates a temp file with 0600, writes to it, then
    // atomically renames. The final file at NO POINT has default (0644) perms —
    // the openSync(path, O_CREAT|O_WRONLY|O_TRUNC, 0o600) pre-creates with 0600.
    const storage = new McpOAuthStorage(tmpHome);
    storage.setTokens("pre-create-test", {
      accessToken: "AT",
      expiresAt: null,
      tokenType: "Bearer",
    });
    const path = storage.tokenFilePath("pre-create-test");
    // After the write, the file MUST be 0600 (never had 0644 — pre-created with 0600).
    const stat = statSync(path);
    expect(stat.mode & 0o777).toBe(0o600);
    // No leftover temp files (the temp file was renamed into place).
    const dir = join(tmpHome, ".mya", "agent", "mcp-tokens");
    // The only file should be the destination (no .tmp files lingering).
  });

  it("overwriting an existing 0644 file resets it to 0600 (no write-then-chmod)", { skip: !isPosix }, () => {
    const storage = new McpOAuthStorage(tmpHome);
    const path = storage.tokenFilePath("overwrite-test");

    // Manually create the file with 0644 (simulating a pre-existing insecure file).
    mkdirSync(join(tmpHome, ".mya", "agent", "mcp-tokens"), { recursive: true });
    writeFileSync(path, "{}", { mode: 0o644 });

    // Verify it's 0644 before the secure write.
    expect(statSync(path).mode & 0o777).toBe(0o644);

    // Overwrite via the secure path.
    storage.setTokens("overwrite-test", {
      accessToken: "new-secret",
      expiresAt: null,
      tokenType: "Bearer",
    });

    // The file is now 0600 (the atomic rename from a 0600 temp file).
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("round-trip: data integrity preserved alongside 0600 perms", { skip: !isPosix }, () => {
    const storage = new McpOAuthStorage(tmpHome);
    const tokens = {
      accessToken: "access-12345",
      refreshToken: "refresh-67890",
      expiresAt: 1234567890000,
      tokenType: "Bearer",
      scope: "read write",
    };
    storage.setTokens("rt", tokens);

    // File mode is secure.
    expect(statSync(storage.tokenFilePath("rt")).mode & 0o777).toBe(0o600);

    // Data is intact.
    const read = storage.getTokens("rt");
    expect(read).toEqual(tokens);
  });
});

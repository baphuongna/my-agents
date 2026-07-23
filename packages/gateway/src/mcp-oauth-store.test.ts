/**
 * @my-agent/gateway — MCP OAuth token storage (PLAN-HERMES-PORT Phase 6) tests.
 *
 * Covers: token/client/metadata round-trips, atomic 0600 writes, dead-client
 * poisoning, expiry/TTL helpers, cross-process reload tracking, and 401
 * deduplication. Uses an isolated temp "home" so the real user dir is untouched.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { setTimeProvider, nowWallclock, type TimeProvider } from "@my-agent/core";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  McpOAuthStorage,
  OAuthReloadTracker,
  OAuth401Dedup,
  type McpTokens,
  type ClientRegistration,
  type OAuthMetadata,
} from "./mcp-oauth-store.js";

// Capture the real clock functions at module load (before any override).
const realWallclock = (): number => Date.now();
const realMonotonic = (): number =>
  typeof performance !== "undefined" ? performance.now() * 1000 : Date.now();

// Mutable fake clock so expiry/TTL checks are deterministic.
let clock = 1_000_000;
let home: string;

beforeEach(() => {
  clock = 1_000_000;
  setTimeProvider({ nowWallclock: () => clock, nowMonotonic: () => clock });
  home = mkdtempSync(join(tmpdir(), "mcp-oauth-store-"));
});

afterEach(() => {
  setTimeProvider({ nowWallclock: realWallclock, nowMonotonic: realMonotonic });
  rmSync(home, { recursive: true, force: true });
});

const isPosix = process.platform !== "win32";

/** Absolute token dir for the current temp home (created on demand). */
function tokensDir(): string {
  return join(home, ".mya", "agent", "mcp-tokens");
}

/** Ensure the token dir exists, then write arbitrary bytes into a file. */
function writeRaw(name: string, content: string): string {
  mkdirSync(tokensDir(), { recursive: true });
  const path = join(tokensDir(), name);
  writeFileSync(path, content);
  return path;
}

// ─── Token storage ──────────────────────────────────────────────────────────

describe("McpOAuthStorage — tokens", () => {
  it("round-trips tokens via set/get", () => {
    const store = new McpOAuthStorage(home);
    const tokens: McpTokens = {
      accessToken: "atk-123",
      refreshToken: "rtk-456",
      expiresAt: clock + 3600_000,
      tokenType: "Bearer",
      scope: "read write",
    };
    store.setTokens("srv", tokens);
    const got = store.getTokens("srv");
    expect(got).not.toBeNull();
    expect(got).toEqual(tokens);
  });

  it("defaults tokenType to Bearer and expiresAt to null when absent on disk", () => {
    const store = new McpOAuthStorage(home);
    // Hand-write a minimal token file lacking tokenType/expiresAt.
    writeRaw("srv.json", JSON.stringify({ accessToken: "bare" }));
    const got = store.getTokens("srv");
    expect(got).toEqual({ accessToken: "bare", refreshToken: undefined, expiresAt: null, tokenType: "Bearer", scope: undefined });
  });

  it("returns null when the token file is missing", () => {
    const store = new McpOAuthStorage(home);
    expect(store.getTokens("nope")).toBeNull();
  });

  it("returns null when the token file is corrupted JSON", () => {
    const store = new McpOAuthStorage(home);
    writeRaw("bad.json", "{not json");
    expect(store.getTokens("bad")).toBeNull();
  });
});

// ─── Client registration ────────────────────────────────────────────────────

describe("McpOAuthStorage — client registration", () => {
  it("round-trips a client registration via set/get", () => {
    const store = new McpOAuthStorage(home);
    const reg: ClientRegistration = {
      clientId: "cid-1",
      clientSecret: "sec-1",
      redirectUri: "http://localhost:8080/cb",
    };
    store.setClientRegistration("srv", reg);
    expect(store.getClientRegistration("srv")).toEqual(reg);
  });

  it("returns null when the client file is missing", () => {
    const store = new McpOAuthStorage(home);
    expect(store.getClientRegistration("nope")).toBeNull();
  });

  it("returns null when the client file is corrupted", () => {
    const store = new McpOAuthStorage(home);
    writeRaw("bad.client.json", "!!!");
    expect(store.getClientRegistration("bad")).toBeNull();
  });

  it("poisons a client registration, leaving a .bak and removing the live file", () => {
    const store = new McpOAuthStorage(home);
    const reg: ClientRegistration = { clientId: "cid", redirectUri: "http://localhost/cb" };
    const meta: OAuthMetadata = {
      tokenEndpoint: "https://idp/token",
      authorizationEndpoint: "https://idp/authorize",
    };
    store.setClientRegistration("srv", reg);
    store.setMetadata("srv", meta);

    const clientPath = join(home, ".mya", "agent", "mcp-tokens", "srv.client.json");
    const metaPath = join(home, ".mya", "agent", "mcp-tokens", "srv.meta.json");

    store.poisonClientRegistration("srv");

    // Live files gone, .bak backups present.
    expect(existsSync(clientPath)).toBe(false);
    expect(existsSync(metaPath)).toBe(false);
    expect(existsSync(`${clientPath}.bak`)).toBe(true);
    expect(existsSync(`${metaPath}.bak`)).toBe(true);
    // Backups retain the original content.
    expect(JSON.parse(readFileSync(`${clientPath}.bak`, "utf-8"))).toEqual(reg);
  });

  it("poison is a no-op when there is nothing to poison", () => {
    const store = new McpOAuthStorage(home);
    expect(() => store.poisonClientRegistration("ghost")).not.toThrow();
    expect(store.getClientRegistration("ghost")).toBeNull();
  });
});

// ─── Metadata ───────────────────────────────────────────────────────────────

describe("McpOAuthStorage — metadata", () => {
  it("round-trips metadata via set/get", () => {
    const store = new McpOAuthStorage(home);
    const meta: OAuthMetadata = {
      tokenEndpoint: "https://idp/token",
      authorizationEndpoint: "https://idp/authorize",
      registrationEndpoint: "https://idp/register",
    };
    store.setMetadata("srv", meta);
    expect(store.getMetadata("srv")).toEqual(meta);
  });

  it("returns null when metadata is missing", () => {
    const store = new McpOAuthStorage(home);
    expect(store.getMetadata("nope")).toBeNull();
  });

  it("returns null when metadata is corrupted", () => {
    const store = new McpOAuthStorage(home);
    writeRaw("bad.meta.json", "not json");
    expect(store.getMetadata("bad")).toBeNull();
  });
});

// ─── Expiry / TTL ───────────────────────────────────────────────────────────

describe("McpOAuthStorage — isExpired", () => {
  it("treats tokens with no expiry as valid", () => {
    const store = new McpOAuthStorage(home);
    const tokens: McpTokens = { accessToken: "a", tokenType: "Bearer", expiresAt: null };
    expect(store.isExpired(tokens)).toBe(false);
  });

  it("is expired when now is at-or-past the expiry", () => {
    const store = new McpOAuthStorage(home);
    const tokens: McpTokens = { accessToken: "a", tokenType: "Bearer", expiresAt: clock + 1000 };
    expect(store.isExpired(tokens)).toBe(false);
    // exactly at expiry → expired
    expect(store.isExpired(tokens, clock + 1000)).toBe(true);
    // past expiry → expired
    expect(store.isExpired(tokens, clock + 5000)).toBe(true);
  });

  it("is valid for a future expiry", () => {
    const store = new McpOAuthStorage(home);
    const tokens: McpTokens = { accessToken: "a", tokenType: "Bearer", expiresAt: clock + 3_600_000 };
    expect(store.isExpired(tokens)).toBe(false);
  });
});

describe("McpOAuthStorage — remainingTtl", () => {
  it("returns Infinity when there is no expiry", () => {
    const store = new McpOAuthStorage(home);
    const tokens: McpTokens = { accessToken: "a", tokenType: "Bearer", expiresAt: null };
    expect(store.remainingTtl(tokens)).toBe(Infinity);
  });

  it("returns 0 once expired", () => {
    const store = new McpOAuthStorage(home);
    const tokens: McpTokens = { accessToken: "a", tokenType: "Bearer", expiresAt: clock + 1000 };
    expect(store.remainingTtl(tokens, clock + 1000)).toBe(0);
    expect(store.remainingTtl(tokens, clock + 9999)).toBe(0);
  });

  it("returns a positive whole-second TTL for a future expiry", () => {
    const store = new McpOAuthStorage(home);
    const tokens: McpTokens = { accessToken: "a", tokenType: "Bearer", expiresAt: clock + 90_000 }; // 90s
    expect(store.remainingTtl(tokens, clock)).toBe(90);
  });
});

// ─── Atomic write / permissions ─────────────────────────────────────────────

describe("McpOAuthStorage — atomic write", () => {
  it("writes the token file with 0600 permissions (POSIX)", { skip: !isPosix }, () => {
    const store = new McpOAuthStorage(home);
    store.setTokens("srv", { accessToken: "a", tokenType: "Bearer", expiresAt: null });
    const stat = statSync(join(home, ".mya", "agent", "mcp-tokens", "srv.json"));
    // 0o600 = rw for owner only.
    const mode = stat.mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("creates the parent directory with 0700 (POSIX)", { skip: !isPosix }, () => {
    const store = new McpOAuthStorage(home);
    store.setTokens("srv", { accessToken: "a", tokenType: "Bearer", expiresAt: null });
    const dirStat = statSync(join(home, ".mya", "agent", "mcp-tokens"));
    expect(dirStat.mode & 0o777).toBe(0o700);
  });

  it("does not leave a stray temp file after write", () => {
    const store = new McpOAuthStorage(home);
    store.setTokens("srv", { accessToken: "a", tokenType: "Bearer", expiresAt: null });
    const dir = join(home, ".mya", "agent", "mcp-tokens");
    const fs = require("node:fs").readdirSync(dir) as string[];
    expect(fs.some((f) => f.endsWith(".tmp"))).toBe(false);
  });
});

// ─── OAuthReloadTracker ─────────────────────────────────────────────────────

describe("OAuthReloadTracker", () => {
  it("returns false on the first check (establishes a baseline)", () => {
    const store = new McpOAuthStorage(home);
    const tracker = new OAuthReloadTracker();
    store.setTokens("srv", { accessToken: "v1", tokenType: "Bearer", expiresAt: null });
    expect(tracker.hasDiskChanged(store, "srv")).toBe(false);
  });

  it("returns false when the file is unchanged across checks", () => {
    const store = new McpOAuthStorage(home);
    const tracker = new OAuthReloadTracker();
    store.setTokens("srv", { accessToken: "v1", tokenType: "Bearer", expiresAt: null });
    tracker.hasDiskChanged(store, "srv"); // baseline
    // No change → still false.
    expect(tracker.hasDiskChanged(store, "srv")).toBe(false);
  });

  it("returns true when the file changed on disk since the last check", () => {
    const store = new McpOAuthStorage(home);
    const tracker = new OAuthReloadTracker();
    store.setTokens("srv", { accessToken: "short", tokenType: "Bearer", expiresAt: null });
    tracker.hasDiskChanged(store, "srv"); // baseline
    // Another process (simulated by re-writing) updates the file with a
    // different-length token; the size tiebreaker makes this deterministic
    // even when both writes land in the same filesystem mtime tick.
    store.setTokens("srv", { accessToken: "a-much-longer-refreshed-token", tokenType: "Bearer", expiresAt: null });
    expect(tracker.hasDiskChanged(store, "srv")).toBe(true);
  });

  it("returns false when the token file does not exist", () => {
    const store = new McpOAuthStorage(home);
    const tracker = new OAuthReloadTracker();
    expect(tracker.hasDiskChanged(store, "ghost")).toBe(false);
  });

  it("tracks servers independently", () => {
    const store = new McpOAuthStorage(home);
    const tracker = new OAuthReloadTracker();
    store.setTokens("a", { accessToken: "one", tokenType: "Bearer", expiresAt: null });
    store.setTokens("b", { accessToken: "one", tokenType: "Bearer", expiresAt: null });
    tracker.hasDiskChanged(store, "a"); // baseline a
    tracker.hasDiskChanged(store, "b"); // baseline b
    // Only 'a' is refreshed (different-length token) → detected.
    store.setTokens("a", { accessToken: "one-refreshed-longer", tokenType: "Bearer", expiresAt: null });
    expect(tracker.hasDiskChanged(store, "a")).toBe(true);
    // b untouched → false.
    expect(tracker.hasDiskChanged(store, "b")).toBe(false);
  });
});

// ─── OAuth401Dedup ──────────────────────────────────────────────────────────

describe("OAuth401Dedup", () => {
  it("deduplicates concurrent 401s for the same token into one recovery", async () => {
    const dedup = new OAuth401Dedup();
    let calls = 0;
    const recovery = (): Promise<boolean> =>
      new Promise((resolve) => {
        calls += 1;
        setTimeout(() => resolve(true), 10);
      });

    // Fire several concurrent recoveries with the same failed access token.
    const results = await Promise.all([
      dedup.handle401("srv", "atk", recovery),
      dedup.handle401("srv", "atk", recovery),
      dedup.handle401("srv", "atk", recovery),
    ]);
    expect(results).toEqual([true, true, true]);
    expect(calls).toBe(1); // recovery ran exactly once
  });

  it("runs separate recoveries for different failed tokens", async () => {
    const dedup = new OAuth401Dedup();
    let calls = 0;
    const recovery = (): Promise<boolean> => {
      calls += 1;
      return Promise.resolve(true);
    };
    await Promise.all([
      dedup.handle401("srv", "atk-1", recovery),
      dedup.handle401("srv", "atk-2", recovery),
    ]);
    expect(calls).toBe(2);
  });

  it("propagates the shared result (including false) to all awaiters", async () => {
    const dedup = new OAuth401Dedup();
    const recovery = (): Promise<boolean> => Promise.resolve(false);
    const results = await Promise.all([
      dedup.handle401("srv", "atk", recovery),
      dedup.handle401("srv", "atk", recovery),
    ]);
    expect(results).toEqual([false, false]);
  });

  it("allows a fresh recovery after the dedup entry is reaped", async () => {
    const dedup = new OAuth401Dedup(50); // short reap window for a fast test
    let calls = 0;
    const recovery = (): Promise<boolean> => {
      calls += 1;
      return Promise.resolve(true);
    };
    await dedup.handle401("srv", "atk", recovery); // first recovery
    // Wait past the reap window so the dedup entry is removed.
    await new Promise<void>((r) => setTimeout(r, 80));
    await dedup.handle401("srv", "atk", recovery); // entry reaped → runs again
    expect(calls).toBe(2);
  });

  it("clear() removes all in-flight dedup entries", async () => {
    const dedup = new OAuth401Dedup();
    let calls = 0;
    const recovery = (): Promise<boolean> =>
      new Promise((resolve) => {
        calls += 1;
        setTimeout(() => resolve(true), 50);
      });
    // Kick off a recovery (deduplicated) — but do NOT await it yet.
    void dedup.handle401("srv", "atk", recovery);
    dedup.clear(); // wipe pending map immediately
    // A new recovery with the same key now runs again (no in-flight entry).
    await dedup.handle401("srv", "atk", recovery);
    // Allow the first (cleared-from-map but still-running) promise to settle.
    await new Promise<void>((r) => setTimeout(r, 60));
    expect(calls).toBe(2);
  });
});

// Sanity: the injected clock is actually wired through core.time.
describe("time wiring", () => {
  it("nowWallclock reflects the injected provider", () => {
    clock = 4_242_424;
    expect(nowWallclock()).toBe(4_242_424);
  });
});

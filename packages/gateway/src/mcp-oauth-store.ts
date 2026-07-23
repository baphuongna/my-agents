/**
 * @my-agent/gateway — MCP OAuth secure token storage (PLAN-HERMES-PORT Phase 6).
 *
 * Foundation for MCP OAuth 2.1 PKCE. Provides atomic, 0600-protected token
 * storage plus cross-process reload tracking and 401 deduplication helpers.
 * The full OAuth flow (browser launch, callback server) is a follow-up.
 *
 * Source: §5 MCP OAuth 2.1 PKCE, docs/hermes-deep-dive-r3.md.
 *
 * Conventions:
 *   - All timestamps via `nowWallclock()` (single time helper, invariant #10).
 *   - Atomic writes: temp file (0600) + rename to avoid the TOCTOU window
 *     where a `write + chmod` sequence briefly leaves the file 0o644.
 */
import { existsSync, mkdirSync, openSync, closeSync, writeSync, renameSync, readFileSync, unlinkSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { nowWallclock } from "@my-agent/core";

export interface McpTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number | null; // absolute wallclock ms
  tokenType: string;
  scope?: string;
}

export interface ClientRegistration {
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
}

export interface OAuthMetadata {
  tokenEndpoint: string;
  authorizationEndpoint: string;
  registrationEndpoint?: string;
}

/**
 * Secure on-disk storage for MCP OAuth tokens, client registrations, and IdP
 * metadata. Files are written atomically with 0600 permissions; the parent
 * directory is 0700.
 */
export class McpOAuthStorage {
  private readonly tokensDir: string;

  constructor(home?: string) {
    this.tokensDir = join(home ?? homedir(), ".mya", "agent", "mcp-tokens");
  }

  /** Absolute path to a server's token file. Exposed so callers (and the reload
   * tracker) can stat it without reaching into private state. */
  tokenFilePath(serverId: string): string {
    return join(this.tokensDir, `${serverId}.json`);
  }

  /** Atomic write with 0600 permissions. Writes to a temp file (same dir, pid
   * suffix) then renames into place — the rename is atomic on POSIX. */
  private writeJson(path: string, data: unknown): void {
    // Ensure parent dir exists with 0700.
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
    // Temp file is truncated (mode "w") + 0600, then atomically renamed.
    const tmp = `${path}.tmp.${process.pid}`;
    const fd = openSync(tmp, "w", 0o600);
    try {
      writeSync(fd, JSON.stringify(data, null, 2));
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, path); // atomic on POSIX
  }

  /** Read tokens for a server. Returns null when absent or unparseable. */
  getTokens(serverId: string): McpTokens | null {
    const path = this.tokenFilePath(serverId);
    if (!existsSync(path)) return null;
    try {
      const data = JSON.parse(readFileSync(path, "utf-8")) as Partial<McpTokens>;
      return {
        accessToken: data.accessToken ?? "",
        refreshToken: data.refreshToken,
        expiresAt: data.expiresAt ?? null,
        tokenType: data.tokenType ?? "Bearer",
        scope: data.scope,
      };
    } catch {
      return null;
    }
  }

  setTokens(serverId: string, tokens: McpTokens): void {
    this.writeJson(this.tokenFilePath(serverId), tokens);
  }

  getClientRegistration(serverId: string): ClientRegistration | null {
    const path = join(this.tokensDir, `${serverId}.client.json`);
    if (!existsSync(path)) return null;
    try {
      return JSON.parse(readFileSync(path, "utf-8")) as ClientRegistration;
    } catch {
      return null;
    }
  }

  setClientRegistration(serverId: string, reg: ClientRegistration): void {
    this.writeJson(join(this.tokensDir, `${serverId}.client.json`), reg);
  }

  getMetadata(serverId: string): OAuthMetadata | null {
    const path = join(this.tokensDir, `${serverId}.meta.json`);
    if (!existsSync(path)) return null;
    try {
      return JSON.parse(readFileSync(path, "utf-8")) as OAuthMetadata;
    } catch {
      return null;
    }
  }

  setMetadata(serverId: string, meta: OAuthMetadata): void {
    this.writeJson(join(this.tokensDir, `${serverId}.meta.json`), meta);
  }

  /** Poison a dead client registration: when the IdP rejects client_id
   * (`invalid_client`), move the registration + metadata aside to a `.bak`
   * for debugging. If the rename fails (e.g. cross-device), fall back to
   * unlink so the next flow re-runs RFC 7591 dynamic registration. */
  poisonClientRegistration(serverId: string): void {
    const paths = [
      join(this.tokensDir, `${serverId}.client.json`),
      join(this.tokensDir, `${serverId}.meta.json`),
    ];
    for (const path of paths) {
      if (!existsSync(path)) continue;
      try {
        renameSync(path, `${path}.bak`); // keep a backup for debugging
      } catch {
        try { unlinkSync(path); } catch { /* already gone */ }
      }
    }
  }

  /** True if the tokens have expired (at-or-past the absolute expiry). Tokens
   * with no expiry are treated as valid (no expiry = valid). */
  isExpired(tokens: McpTokens, now?: number): boolean {
    if (!tokens.expiresAt) return false; // no expiry = valid
    const t = now ?? nowWallclock();
    return t >= tokens.expiresAt;
  }

  /** Remaining TTL in whole seconds. No expiry → Infinity; expired → 0. */
  remainingTtl(tokens: McpTokens, now?: number): number {
    if (!tokens.expiresAt) return Infinity;
    const t = now ?? nowWallclock();
    return Math.max(0, Math.floor((tokens.expiresAt - t) / 1000));
  }
}

/**
 * Tracks on-disk token file mtimes so a process can detect when another process
 * has refreshed tokens and force a reload. Uses `mtimeMs` (number) for
 * cross-version Node compatibility.
 */
export class OAuthReloadTracker {
  // Fingerprint = "mtimeMs|size". mtimeMs alone can miss two writes that land
  // in the same filesystem tick (and mtimeNs is unavailable on some Node builds);
  // adding size catches same-tick writes whose content length changed — the
  // common case for a refreshed access token. Stays stat-based (no file read).
  private lastFingerprint = new Map<string, string>(); // serverId → fingerprint

  /** Returns true if the token file on disk changed since the last check.
   * The first check establishes a baseline and returns false (no prior data). */
  hasDiskChanged(storage: McpOAuthStorage, serverId: string): boolean {
    const path = storage.tokenFilePath(serverId);
    try {
      const stat = statSync(path);
      // mtimeMs (ms, sub-ms float where available) + size as the fingerprint.
      const fingerprint = `${stat.mtimeMs}|${stat.size}`;
      const last = this.lastFingerprint.get(serverId);
      this.lastFingerprint.set(serverId, fingerprint);
      return last !== undefined && last !== fingerprint;
    } catch {
      return false;
    }
  }
}

/**
 * Deduplicates concurrent 401 recovery attempts so a thundering herd of failing
 * tool calls triggers exactly one token refresh. Subsequent callers await the
 * in-flight recovery and receive the same result.
 */
export class OAuth401Dedup {
  private pending = new Map<string, Promise<boolean>>(); // key → in-flight recovery

  /** @param reapMs how long after a recovery settles to keep the dedup entry
   * (coalesces late-arriving 401s). Defaults to 5 s; injectable for tests. */
  constructor(private readonly reapMs: number = 5000) {}

  /** Run a 401 recovery, deduplicated by serverId + the failed access token.
   * Concurrent callers with the same key share the single in-flight promise.
   * The entry is cleared shortly after resolution to coalesce late arrivals. */
  async handle401(
    serverId: string,
    failedAccessToken: string | undefined,
    recovery: () => Promise<boolean>,
  ): Promise<boolean> {
    const key = `${serverId}:${failedAccessToken ?? "<unknown>"}`;
    const existing = this.pending.get(key);
    if (existing) return existing;
    const promise = recovery().finally(() => {
      // Clean up after a short delay to catch late-arriving 401s.
      setTimeout(() => this.pending.delete(key), this.reapMs);
    });
    this.pending.set(key, promise);
    return promise;
  }

  /** Clear all in-flight dedup entries. */
  clear(): void {
    this.pending.clear();
  }
}

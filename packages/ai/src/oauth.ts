/**
 * @my-agent/ai/oauth — OAuth 2.1 + PKCE loopback auth flow (§6.1).
 *
 * Flow: generate code_verifier (random 43–128 chars) → code_challenge =
 * S256(verifier) → auth URL with random `state` (CSRF) → loopback
 * http://127.0.0.1:{ephemeral}/callback (never 0.0.0.0) → exchange code+verifier
 * for tokens. Store tokens only via SecretRef{from:"keyring"} (§14.2); rotate
 * refresh tokens on every use; revoke on profile removal.
 *
 * Tier-1 ships the PKCE primitives + the loopback server + the token-exchange
 * request shape. The browser-open + device-code fallback UI handoff is wired by
 * the host transport (RuntimeEvent{kind:"auth";stage:"device_code"}).
 *
 * Source: §6.1 Provider auth flows; claw-code oauth.rs, MyAgents OAuth.
 */
import { createServer, type Server } from "node:http";
import { createHash, randomBytes } from "node:crypto";

/** PKCE challenge pair (S256). */
export interface PkcePair {
  verifier: string; // 43–128 chars, sent in the token exchange
  challenge: string; // base64url(SHA256(verifier)), sent in the auth request
  method: "S256";
}

/** Generate a PKCE verifier + its S256 challenge. */
export function generatePkce(byteLen = 32): PkcePair {
  const verifier = base64url(randomBytes(byteLen)); // 32 bytes → 43 chars (min legal)
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge, method: "S256" };
}

/** A pending authorization request (the URL to open + the state to check). */
export interface AuthRequest {
  url: string;
  state: string; // CSRF token echoed back by the provider
  pkce: PkcePair;
}

/** Build the authorization URL for a provider config. */
export function buildAuthUrl(opts: {
  authEndpoint: string;
  clientId: string;
  redirectUri: string; // the loopback callback
  scopes: string[];
  pkce: PkcePair;
  state?: string;
}): AuthRequest {
  const state = opts.state ?? base64url(randomBytes(16));
  const params = new URLSearchParams({
    response_type: "code",
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    scope: opts.scopes.join(" "),
    state,
    code_challenge: opts.pkce.challenge,
    code_challenge_method: "S256",
  });
  return { url: `${opts.authEndpoint}?${params.toString()}`, state, pkce: opts.pkce };
}

/** The code+state received at the loopback callback. */
export interface CallbackResult {
  code: string;
  state: string;
}

/** Loopback OAuth server — binds 127.0.0.1:{ephemeral} (NEVER 0.0.0.0 per §6.1).
 * Resolves with the callback's code+state, then closes. */
export class LoopbackServer {
  private server: Server | null = null;
  private resolveCb: ((r: CallbackResult) => void) | null = null;
  redirectUri = "";
  port = 0;

  /** Start listening on an ephemeral 127.0.0.1 port; resolves with the
   * assigned port + the redirectUri. */
  start(): Promise<{ port: number; redirectUri: string }> {
    return new Promise((resolveStart, rejectStart) => {
      this.server = createServer((req, res) => {
        const url = new URL(req.url ?? "/", `http://127.0.0.1:${this.port}`);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const err = url.searchParams.get("error");
        if (code && state) {
          res.writeHead(200, { "content-type": "text/html" });
          res.end("<html><body>Auth complete. You may close this tab.</body></html>");
          this.resolveCb?.({ code, state });
        } else {
          res.writeHead(400, { "content-type": "text/html; charset=utf-8", "x-content-type-options": "nosniff" });
          // M6 fix: HTML-escape the error param (was reflected XSS).
          res.end(`<html><body>Auth failed: ${escapeHtml(err ?? "no code")}</body></html>`);
        }
      });
      this.server.on("error", rejectStart);
      // bind to 127.0.0.1 only (ephemeral port)
      this.server.listen(0, "127.0.0.1", () => {
        const addr = this.server!.address();
        if (addr && typeof addr === "object") {
          this.port = addr.port;
          this.redirectUri = `http://127.0.0.1:${this.port}/callback`;
          resolveStart({ port: this.port, redirectUri: this.redirectUri });
        } else {
          rejectStart(new Error("failed to bind loopback server"));
        }
      });
    });
  }

  /** Wait for the callback code+state. */
  waitForCallback(): Promise<CallbackResult> {
    return new Promise((resolve) => {
      this.resolveCb = resolve;
    });
  }

  close(): void {
    this.server?.close();
    this.server = null;
  }
}

/** Token exchange response (RFC 6749). */
export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type: string;
  scope?: string;
}

/** Exchange an authorization code for tokens (PKCE verifier required). */
export async function exchangeCode(opts: {
  tokenEndpoint: string;
  clientId: string;
  code: string;
  redirectUri: string;
  verifier: string; // the PKCE verifier
}): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: opts.code,
    redirect_uri: opts.redirectUri,
    client_id: opts.clientId,
    code_verifier: opts.verifier,
  });
  const resp = await fetch(opts.tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!resp.ok) {
    throw new Error(`token exchange failed: ${resp.status} ${await resp.text()}`);
  }
  return (await resp.json()) as TokenResponse;
}

/** Refresh an access token (rotate the refresh token on every use per §6.1). */
export async function refreshAccessToken(opts: {
  tokenEndpoint: string;
  clientId: string;
  refreshToken: string;
}): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: opts.refreshToken,
    client_id: opts.clientId,
  });
  const resp = await fetch(opts.tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!resp.ok) {
    throw new Error(`token refresh failed: ${resp.status}`);
  }
  return (await resp.json()) as TokenResponse;
}

/** base64url encode (RFC 4648 §5) — URL-safe, no padding. */
function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** HTML-escape a string (M6: the OAuth error page reflected the raw query param). */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** M5 fix: verify the OAuth callback state matches the expected CSRF token
 * (constant-time). Throws on mismatch — callers MUST call this on the callback
 * result; never trust an unverified state. */
export function verifyCallbackState(expected: string, result: CallbackResult): void {
  const a = Buffer.from(expected);
  const b = Buffer.from(result.state);
  if (a.length !== b.length || !cryptoTimingSafeEqual(a, b)) {
    throw new Error("oauth: state mismatch (possible login-CSRF)");
  }
}

import { timingSafeEqual as cryptoTimingSafeEqual } from "node:crypto";

/** Verify a PKCE challenge against a verifier (M6: constant-time compare). */
export function verifyPkce(verifier: string, challenge: string): boolean {
  const computed = base64url(createHash("sha256").update(verifier).digest());
  const a = Buffer.from(computed);
  const b = Buffer.from(challenge);
  return a.length === b.length && cryptoTimingSafeEqual(a, b);
}

/**
 * @my-agent/gateway — MCP OAuth flow.
 *
 * B2: OAuth/PKCE flow for MCP server connections.
 * Uses existing PKCE primitives from packages/ai/src/oauth.ts.
 *
 * Source: §06.1 OAuth/PKCE + §12.1 MCP lifecycle, PLAN-FEATURES B2.
 */
import { generatePkce, buildAuthUrl, exchangeCode } from "@my-agent/ai";
import type { SecretStore } from "@my-agent/secrets";
import { nowWallclock } from "@my-agent/core";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

interface PendingOAuth {
  serverId: string;
  verifier: string;
  state: string;
  redirectUri: string;
  createdAt: number;
}

const pendingFlows = new Map<string, PendingOAuth>();
const OAUTH_TIMEOUT_MS = 10 * 60_000;

/** Start an OAuth flow for an MCP server. Returns redirect URL + state. */
export function startMcpOAuth(
  serverId: string,
  authEndpoint: string,
  redirectUri: string,
  clientId = "mya-mcp",
  scopes: string[] = [],
): { url: string; state: string } {
  const pkce = generatePkce();
  const state = `${serverId}-${nowWallclock().toString(36)}`;
  pendingFlows.set(state, {
    serverId, verifier: pkce.verifier, state, redirectUri, createdAt: nowWallclock(),
  });
  // Prune expired flows
  const cutoff = nowWallclock() - OAUTH_TIMEOUT_MS;
  for (const [key, flow] of pendingFlows) {
    if (flow.createdAt < cutoff) pendingFlows.delete(key);
  }
  const authReq = buildAuthUrl({
    authEndpoint,
    clientId,
    redirectUri,
    scopes,
    pkce,
    state,
  });
  return { url: authReq.url, state: authReq.state };
}

/** Complete an OAuth flow — exchange code for token, store via SecretStore. */
export async function completeMcpOAuth(
  state: string,
  code: string,
  tokenEndpoint: string,
  clientId: string,
  store: SecretStore,
): Promise<{ ok: boolean; error?: string }> {
  const flow = pendingFlows.get(state);
  if (!flow) return { ok: false, error: "invalid or expired state" };
  pendingFlows.delete(state);

  try {
    const tokens = await exchangeCode({
      tokenEndpoint,
      clientId,
      code,
      redirectUri: flow.redirectUri,
      verifier: flow.verifier,
    });
    // Store the token via SecretStore (file-backed)
    const tokenDir = join(homedir(), ".mya", "mcp-tokens");
    try { mkdirSync(tokenDir, { recursive: true }); } catch { /* exists */ }
    const tokenPath = join(tokenDir, `${flow.serverId}.json`);
    store.writeSealedFile(tokenPath, JSON.stringify(tokens));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Get a stored MCP OAuth token (if exists). */
export function getMcpToken(serverId: string, store: SecretStore): string | null {
  try {
    const tokenPath = join(homedir(), ".mya", "mcp-tokens", `${serverId}.json`);
    return store.resolve({ from: "file", ref: tokenPath }) ?? null;
  } catch {
    return null;
  }
}

/**
 * @my-agent/gateway — MCP OAuth flow.
 *
 * B2: OAuth/PKCE flow for MCP server connections.
 * Uses existing PKCE primitives from packages/ai/src/oauth.ts.
 *
 * Source: §06.1 OAuth/PKCE + §12.1 MCP lifecycle, PLAN-FEATURES B2.
 */
import { generatePkce, buildAuthUrl, exchangeCode } from "@my-agent/ai";
import { SecretStore } from "@my-agent/secrets";
import { nowWallclock } from "@my-agent/core";

interface PendingOAuth {
  serverId: string;
  verifier: string;
  state: string;
  redirectUri: string;
  createdAt: number;
}

const pendingFlows = new Map<string, PendingOAuth>();
const OAUTH_TIMEOUT_MS = 10 * 60_000;

/** Start an OAuth flow for an MCP server. Returns redirect URL. */
export function startMcpOAuth(serverId: string, authEndpoint: string, redirectUri: string): {
  url: string;
  state: string;
} {
  const { verifier, challenge } = generatePkce();
  const state = `${serverId}-${nowWallclock().toString(36)}`;
  pendingFlows.set(state, {
    serverId, verifier, state, redirectUri, createdAt: nowWallclock(),
  });
  // Prune expired flows
  const cutoff = nowWallclock() - OAUTH_TIMEOUT_MS;
  for (const [key, flow] of pendingFlows) {
    if (flow.createdAt < cutoff) pendingFlows.delete(key);
  }
  const url = buildAuthUrl(authEndpoint, {
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  });
  return { url, state };
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
    const tokens = await exchangeCode(tokenEndpoint, {
      code,
      client_id: clientId,
      code_verifier: flow.verifier,
      redirect_uri: flow.redirectUri,
    });
    // Store the token via SecretStore (keyring-backed)
    store.writeSealedFile(
      `${process.env.HOME}/.mya/mcp-tokens/${flow.serverId}.json`,
      JSON.stringify(tokens),
    );
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Get a stored MCP OAuth token (if exists). */
export function getMcpToken(serverId: string, store: SecretStore): string | null {
  try {
    const path = `${process.env.HOME}/.mya/mcp-tokens/${serverId}.json`;
    return store.resolve({ from: "file", ref: path }) ?? null;
  } catch {
    return null;
  }
}

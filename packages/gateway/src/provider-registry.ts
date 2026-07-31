/**
 * Engine-driven provider discovery.
 *
 * Replaces the old hardcoded PROVIDER_REGISTRY (37 entries that drifted
 * from pi-ai). Provider list, names, env keys, default models, and model
 * metadata all come from `@earendil-works/pi-ai` — always in sync.
 *
 * Zero hardcode: provider IDs from `builtinProviders()`, env key names
 * discovered by intercepting the auth resolve() call.
 */
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";

export interface ProviderEntry {
  id: string;
  name: string;
  /** Primary env var for API key (e.g. "ZAI_API_KEY"). Empty for OAuth-only. */
  envKey: string;
  /** All env vars this provider checks (e.g. anthropic checks 3). */
  allEnvKeys: string[];
  /** First model in the provider's catalog (pi-ai's default ordering). */
  model: string;
  /** True if provider supports OAuth (subscription) login. */
  hasOAuth: boolean;
  /** OAuth display name (e.g. "Anthropic (Claude Pro/Max)"). */
  oauthName?: string;
  /** Model metadata from pi-ai engine. */
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
}

export interface ProviderSummary extends ProviderEntry {
  configured: boolean;
}

// ── Cache: provider metadata is static per process ──────────────────────

let cached: ProviderEntry[] | null = null;

interface AuthResolveInput {
  ctx: {
    env(name: string): Promise<string | undefined>;
    fileExists(path: string): Promise<boolean>;
  };
  credential?: { key?: string };
}

/**
 * Discover ALL env key names by intercepting the auth resolve() call.
 *
 * Awaits resolve() to completion so ALL env vars are captured (important
 * for multi-var providers like anthropic with 3 keys, bedrock with 6).
 *
 * Returns env keys in priority order (first set wins in pi-ai).
 */
async function discoverEnvKeys(auth: {
  apiKey?: { resolve?: (input: AuthResolveInput) => Promise<unknown> };
}): Promise<string[]> {
  const keys: string[] = [];
  const ctx = {
    env: async (name: string) => {
      keys.push(name);
      return undefined; // return undefined so resolve() checks all vars
    },
    fileExists: async () => false,
  };
  try {
    await auth.apiKey?.resolve?.({ ctx });
  } catch {
    // OAuth-only providers have no apiKey.resolve
  }
  return keys;
}

/**
 * Initialize provider registry from pi-ai engine. Async — call once at startup.
 * After this completes, getProviderRegistry() and detectProviderSummary() are sync.
 */
export async function initProviderRegistry(): Promise<ProviderEntry[]> {
  if (cached) return cached;

  const providers = builtinProviders();
  const entries: ProviderEntry[] = [];
  for (const p of providers) {
    const allEnvKeys = await discoverEnvKeys(p.auth as never);
    // Prefer _API_KEY vars over _TOKEN / _AUTH_TOKEN for display + add-key flow.
    const primary =
      allEnvKeys.find((k) => k.endsWith("_API_KEY")) ?? allEnvKeys[0] ?? "";
    const models = p.getModels();
    const first = models[0];
    entries.push({
      id: p.id,
      name: p.name,
      envKey: primary,
      allEnvKeys,
      model: first?.id ?? "",
      hasOAuth: !!p.auth.oauth,
      oauthName: p.auth.oauth?.name,
      contextWindow: first?.contextWindow,
      maxTokens: first?.maxTokens,
      reasoning: first?.reasoning,
    });
  }
  cached = entries;
  return entries;
}

/**
 * Get the cached provider registry. Call `initProviderRegistry()` first.
 * If not initialized yet, returns a sync fallback (first env var only).
 */
export function getProviderRegistry(): ProviderEntry[] {
  if (cached) return cached;
  // Fallback: sync discovery (captures only first env var per provider).
  // This is used if /status is called before init completes.
  const providers = builtinProviders();
  cached = providers.map((p) => {
    const keys: string[] = [];
    const ctx = {
      env: (name: string) => {
        keys.push(name);
        return Promise.resolve(undefined);
      },
      fileExists: () => Promise.resolve(false),
    };
    p.auth.apiKey?.resolve?.({ ctx })?.catch(() => {});
    const primary =
      keys.find((k) => k.endsWith("_API_KEY")) ?? keys[0] ?? "";
    const models = p.getModels();
    const first = models[0];
    return {
      id: p.id,
      name: p.name,
      envKey: primary,
      allEnvKeys: keys,
      model: first?.id ?? "",
      hasOAuth: !!p.auth.oauth,
      oauthName: p.auth.oauth?.name,
      contextWindow: first?.contextWindow,
      maxTokens: first?.maxTokens,
      reasoning: first?.reasoning,
    };
  });
  return cached;
}

/**
 * Detect provider configuration status from environment.
 * Replaces the old hardcoded detectProviderSummary().
 *
 * Uses allEnvKeys for configured check so multi-var providers
 * (anthropic: 3 keys, bedrock: 6) are detected correctly.
 */
export function detectProviderSummary(): ProviderSummary[] {
  return getProviderRegistry().map((e) => ({
    ...e,
    configured: e.allEnvKeys.some((k) => !!process.env[k]),
  }));
}

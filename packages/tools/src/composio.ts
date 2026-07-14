/**
 * Composio integration client (Gap 11) — 250+ external integrations via 1 SDK.
 *
 * Config:
 *   COMPOSIO_API_KEY          — API key (absent → graceful no-op)
 *   COMPOSIO_ENABLED_TOOLKITS — comma-sep allowlist (e.g. "notion,linear,github")
 *
 * Source: GAP-IMPLEMENTATION-PLAN.md Gap 11; §7 tool model.
 */
import type { Tool, ToolResult, TurnContext } from "@my-agent/core";
import { ToolRegistry, ok, err, type ToolImpl } from "./registry.js";

const COMPOSIO_BASE = "https://backend.composio.dev/api/v1";

export interface ComposioConfig {
  apiKey: string;
  baseUrl?: string;
  enabledToolkits?: string[];
}

export interface ComposioTool {
  name: string;
  slug: string;
  description: string;
  parameters: Record<string, unknown>;
  toolkit?: string;
}

export interface ConnectedAccount {
  id: string;
  toolkit: string;
  status: "active" | "expired";
}

/** Composio API client — wraps REST calls, no SDK dependency. */
export class ComposioClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  readonly enabledToolkits?: string[];

  constructor(config: ComposioConfig | string) {
    if (typeof config === "string") {
      this.apiKey = config;
      this.baseUrl = COMPOSIO_BASE;
    } else {
      this.apiKey = config.apiKey;
      this.baseUrl = config.baseUrl ?? COMPOSIO_BASE;
      this.enabledToolkits = config.enabledToolkits;
    }
  }

  private headers(): Record<string, string> {
    return { "x-api-key": this.apiKey, "Content-Type": "application/json" };
  }

  /** List available tools, optionally filtered by toolkit. */
  async listTools(toolkit?: string): Promise<ComposioTool[]> {
    const params = toolkit ? `?toolkits=${encodeURIComponent(toolkit)}` : "";
    const res = await fetch(`${this.baseUrl}/tools${params}`, { headers: this.headers() });
    if (!res.ok) throw new Error(`composio listTools failed: ${res.status}`);
    const data = (await res.json()) as { items?: ComposioTool[] };
    return data.items ?? [];
  }

  /** Get the parameter schema for a single tool. */
  async getToolSchema(toolName: string): Promise<Record<string, unknown>> {
    const res = await fetch(`${this.baseUrl}/tools/${encodeURIComponent(toolName)}`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`composio getToolSchema failed: ${res.status}`);
    const data = (await res.json()) as ComposioTool;
    return data.parameters ?? {};
  }

  /** Execute a tool with the given parameters + connected account. */
  async executeTool(
    toolName: string,
    params: unknown,
    connectedAccountId: string,
  ): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}/tools/${encodeURIComponent(toolName)}/execute`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        arguments: params,
        connected_account_id: connectedAccountId,
      }),
    });
    if (!res.ok) throw new Error(`composio executeTool failed: ${res.status}`);
    return res.json();
  }

  /** Initiate OAuth flow → returns auth URL for the user to visit. */
  async initAuth(userId: string, toolkit: string): Promise<{ authUrl: string }> {
    const res = await fetch(`${this.baseUrl}/auth/initiate`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ user_id: userId, toolkit }),
    });
    if (!res.ok) throw new Error(`composio initAuth failed: ${res.status}`);
    return (await res.json()) as { authUrl: string };
  }

  /** Handle OAuth callback → returns the connected account. */
  async handleCallback(code: string): Promise<ConnectedAccount> {
    const res = await fetch(`${this.baseUrl}/auth/callback`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ code }),
    });
    if (!res.ok) throw new Error(`composio handleCallback failed: ${res.status}`);
    return (await res.json()) as ConnectedAccount;
  }
}

/**
 * Register Composio tools into the agent tool registry as `composio_<slug>`.
 * External API calls = trust boundary → requiredMode "Prompt".
 * Returns the number of tools registered.
 */
export async function registerComposioTools(
  registry: ToolRegistry,
  client: ComposioClient,
  connectedAccountId: string,
  opts: { toolkitFilter?: string[] } = {},
): Promise<number> {
  const tools = await client.listTools();
  const filter = opts.toolkitFilter ?? client.enabledToolkits;
  const filtered =
    filter && filter.length > 0
      ? tools.filter((t) => t.toolkit != null && filter.includes(t.toolkit))
      : tools;

  let count = 0;
  for (const tool of filtered) {
    const name = `composio_${tool.slug || tool.name}`;
    if (registry.get(name)) continue; // skip duplicates
    const meta: Tool = {
      name,
      args: (tool.parameters ?? { type: "object" }) as Tool["args"],
      requiredMode: "Prompt",
    };
    const impl: ToolImpl = {
      meta,
      async run(args: unknown, _ctx: TurnContext): Promise<ToolResult> {
        try {
          const result = await client.executeTool(tool.name, args, connectedAccountId);
          return ok(name, result);
        } catch (e) {
          return err(name, e instanceof Error ? e.message : String(e));
        }
      },
    };
    registry.register(impl);
    count++;
  }
  return count;
}

/** Create a ComposioClient from env, or null when unconfigured (graceful no-op). */
export function createComposioClient(): ComposioClient | null {
  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) return null;
  const enabledToolkits = process.env.COMPOSIO_ENABLED_TOOLKITS
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return new ComposioClient({ apiKey, enabledToolkits });
}

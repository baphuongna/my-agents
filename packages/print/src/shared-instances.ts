/**
 * Shared instances — created once, used across ALL modes.
 *
 * This module does NOT import pi → keeps the main bundle small.
 * pi-main.ts dynamically imports pi only when entering InteractiveMode.
 */
import { SecretStore, makeSecretRedactor } from "@my-agent/secrets";
import { AuditLog } from "@my-agent/audit";
import { HookRegistry, McpManager, ChannelRegistry, ChannelSessionRouter, registerBuiltinChannels } from "@my-agent/gateway";
import { SkillStore } from "@my-agent/skills";
import { CronScheduler } from "@my-agent/cron";
import {
  Brain,
  MemoryManagerImpl,
  MemoryContextSource,
  archivistDomain,
  treeDomain,
  diffDomain,
  goalsDomain,
  syncDomain,
  graphDomain,
  conversationsDomain,
  searchDomain,
  sourcesDomain,
  entitiesDomain,
  storeDomain,
  toolsDomain,
  queueDomain,
} from "@my-agent/memory";
import { Wallet } from "@my-agent/x402";
import { AcpBridge } from "@my-agent/acp";
import { SyncServer } from "@my-agent/sync";
import { CollabRelay } from "@my-agent/collab";
import { PackageHost } from "@my-agent/pkg";
import { CouncilProvider, type CouncilMember } from "@my-agent/council";
import { PiAiProviderBridge } from "@my-agent/ai";
import { createRequire } from "node:module";
import { autoConfigureChannels } from "@my-agent/gateway";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ToolHookSink } from "@my-agent/core";

// ── Shared instances (created once at module load) ──
export const secretStore = new SecretStore();
export const auditLog = new AuditLog((_kind, payload) => makeSecretRedactor(secretStore)(payload));
export const hooks = new HookRegistry();

/** ToolHookSink adapter: bridges HookRegistry events → agent dispatch hooks.
 * postTool fires the "post_tool" hook for audit/observability.
 * preTool is a no-op (HookRegistry is fire-and-forget, no override semantics).
 * This satisfies the ToolHookSink interface so dispatch.ts can call it safely. */
export const toolHooks: ToolHookSink = {
  preTool: async () => ({}),
  postTool: (call, result) => { void hooks.fire("post_tool" as never, { call, result } as never); },
};
export const skillStore = new SkillStore();
export const cron = new CronScheduler();
export const brain = new Brain();

// ── Memory Manager with all 13 domains (wired, not dead code) ──
const allDomains = [
  archivistDomain, treeDomain, diffDomain, goalsDomain, syncDomain,
  graphDomain, conversationsDomain, searchDomain, sourcesDomain,
  entitiesDomain, storeDomain, toolsDomain, queueDomain,
];

export const memory = MemoryManagerImpl.withBrain({
  brain,
  domains: allDomains,
});

// Wire previously-dead domains (sources + store + goals)
storeDomain.wireManager(memory);
sourcesDomain.wireSource(new MemoryContextSource(memory));
// Goals domain needs a store backend — use the one registered for "goals" role
for (const backend of memory.backends) {
  if (backend.role === "goals") { goalsDomain.wireStore(backend); break; }
}
export const wallet = new Wallet({ initial: { usdc: 1_000_000 } });
export const acp = new AcpBridge();
export const sync = new SyncServer();
export const collab = new CollabRelay();
export const packageHost = new PackageHost();
export const mcp = new McpManager();
export const channels = new ChannelRegistry();
registerBuiltinChannels(channels);
export const channelRouter = new ChannelSessionRouter();

// ── Council (multi-model when ≥2 provider keys set, else mock 1-member) ──

/** Known pi-ai provider configs for council multi-model support.
 * Each entry maps an env API key to a pi-ai provider module + default model. */
const COUNCIL_PROVIDERS = [
  { envKey: "ANTHROPIC_API_KEY", providerId: "anthropic", role: "Anthropic", defaultModel: "claude-sonnet-4-20250514" },
  { envKey: "OPENAI_API_KEY", providerId: "openai", role: "OpenAI", defaultModel: "gpt-4o" },
  { envKey: "GOOGLE_API_KEY", providerId: "google", role: "Google", defaultModel: "gemini-2.0-flash" },
  { envKey: "DEEPSEEK_API_KEY", providerId: "deepseek", role: "DeepSeek", defaultModel: "deepseek-chat" },
  { envKey: "GROQ_API_KEY", providerId: "groq", role: "Groq", defaultModel: "llama-3.3-70b-versatile" },
  { envKey: "MISTRAL_API_KEY", providerId: "mistral", role: "Mistral", defaultModel: "mistral-large-latest" },
  { envKey: "XAI_API_KEY", providerId: "xai", role: "xAI", defaultModel: "grok-3" },
  { envKey: "OPENROUTER_API_KEY", providerId: "openrouter", role: "OpenRouter", defaultModel: "anthropic/claude-3.5-sonnet" },
] as const;

/** Mock advisor profile — fallback when <2 real providers are configured. */
function mockAdvisorProfile(): import("@my-agent/core").ProviderProfile {
  return {
    id: "mock-advisor",
    model: "mock-advisor",
    health: () => "Healthy" as const,
    stream: async () => ({ events: [{ kind: "text" as const, text: "[council advisor not fully configured — add a second provider]" }] }),
  };
}

/** Detect real provider env keys and build CouncilMember profiles via
 * PiAiProviderBridge. Returns undefined when <2 providers are configured
 * (signals mock fallback per requirement #4). */
function detectCouncilMembers(): CouncilMember[] | undefined {
  let requireFn: NodeRequire;
  try { requireFn = createRequire(import.meta.url); }
  catch { return undefined; }

  const members: CouncilMember[] = [];
  for (const cfg of COUNCIL_PROVIDERS) {
    const apiKey = process.env[cfg.envKey];
    if (!apiKey) continue;
    try {
      const mod = requireFn(`../../../vendored/pi-ai/dist/providers/${cfg.providerId}.js`);
      const factory = mod.default ?? mod[Object.keys(mod).find((k) => k.toLowerCase().includes("provider")) ?? ""] ?? Object.values(mod)[0];
      if (typeof factory !== "function") continue;
      // pi-ai provider factories return a Provider object (envApiKeyAuth reads
      // the key from process.env internally); the apiKey arg is for the bridge.
      const provider = factory();
      const modelId = process.env[`${cfg.envKey.replace("_API_KEY", "_MODEL")}`] ?? cfg.defaultModel;
      const bridge = new PiAiProviderBridge({ provider, model: { id: modelId, api: "messages" }, apiKey, id: cfg.providerId });
      members.push({ profile: bridge, role: cfg.role });
    } catch { /* provider module not found or init failed — skip silently */ }
  }
  return members.length >= 2 ? members : undefined;
}

export const council: CouncilProvider | undefined = (() => {
  try {
    const realMembers = detectCouncilMembers();
    if (realMembers && realMembers.length >= 2) {
      // Multi-model council: fan out to all configured providers (attributed).
      return new CouncilProvider({
        id: "mya-council",
        members: realMembers,
        strategy: "attributed",
      });
    }
    // Fallback: mock 1-member (current behavior when <2 providers configured).
    return new CouncilProvider({
      id: "mya-council",
      members: [{ role: "advisor", profile: mockAdvisorProfile() }],
    });
  } catch { return undefined; }
})();

// ── Auto-discover skills + channels ──
void skillStore.discover(join(homedir(), ".mya", "skills")).catch(() => { /* optional */ });

// ── Auto-configure channels from env/config ──
let _mcpConfigs: import("@my-agent/gateway").McpServerConfig[] = [];
try {
  const { readFileSync } = await import("node:fs");
  const raw = readFileSync(join(homedir(), ".mya", "agent", "mcp.json"), "utf8");
  const parsed = JSON.parse(raw) as { servers?: import("@my-agent/gateway").McpServerConfig[] };
  _mcpConfigs = parsed.servers ?? [];
  for (const cfg of _mcpConfigs) mcp.register(cfg);
} catch { /* mcp.json optional */ }
export const mcpConfigs = _mcpConfigs;

// ── Auto-configure channels ──
autoConfigureChannels(channels);

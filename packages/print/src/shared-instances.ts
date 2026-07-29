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
import { loadRoles as loadRolesRegistry, type RoleRegistry } from "@my-agent/core";
import {
  Brain,
  SqliteBrainStore,
  createBrainFromConfig,
  migrateBrainJsonlToSqlite,
  MemoryManagerImpl,
  MemoryContextSource,
  RetrievalEngine,
  LifecycleManager,
  MemoryTree,
  FileBackend,
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
import type { ChannelsPackageConfig } from "@my-agent/gateway";
import { join } from "node:path";
import { homedir } from "node:os";
import { readFileSync, existsSync } from "node:fs";
import type { ToolHookSink } from "@my-agent/core";

// ── #5: Central config loader (R3-5 fix) ──
// Reads ~/.mya/agent/config.json once at module load. Falls back to env vars.
// This replaces the scattered 17-JSON-file pattern with a single optional config.
export interface MyaConfig {
  memoryBackend?: string; // "sqlite" | "brain" | "mem0" (D1)
  activeProfile?: string; // H1 profile system
  maxSpawnDepth?: number; // A2 subagent depth
  maxToolRounds?: number; // A1 iteration budget
  maxSubagentToolRounds?: number; // F2 per-subagent iteration cap (Hermes port)
  channels?: ChannelsPackageConfig; // Item 17: @my-agent/channels config
}
function loadConfig(): MyaConfig {
  const configPath = join(homedir(), ".mya", "agent", "config.json");
  let fileConfig: Partial<MyaConfig> = {};
  if (existsSync(configPath)) {
    try { fileConfig = JSON.parse(readFileSync(configPath, "utf8")) as Partial<MyaConfig>; }
    catch { /* corrupt config → ignore */ }
  }
  return {
    memoryBackend: fileConfig.memoryBackend ?? process.env["MYA_MEMORY_BACKEND"],
    activeProfile: fileConfig.activeProfile ?? process.env["MYA_PROFILE"] ?? "default",
    maxSpawnDepth: fileConfig.maxSpawnDepth ?? (process.env["MYA_MAX_SPAWN_DEPTH"] ? Number(process.env["MYA_MAX_SPAWN_DEPTH"]) : undefined),
    maxToolRounds: fileConfig.maxToolRounds ?? (process.env["MYA_MAX_TOOL_ROUNDS"] ? Number(process.env["MYA_MAX_TOOL_ROUNDS"]) : undefined),
    maxSubagentToolRounds: fileConfig.maxSubagentToolRounds ?? (process.env["MYA_MAX_SUBAGENT_TOOL_ROUNDS"] ? Number(process.env["MYA_MAX_SUBAGENT_TOOL_ROUNDS"]) : undefined),
    channels: fileConfig.channels,
  };
}
export const config = loadConfig();

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
// ── Dig 3 Phase D: config-gated Brain storage ──────────────────────────
// memoryBackend === "sqlite" → durable SqliteBrainStore (write-through WAL).
// Anything else (undefined, "brain", "mem0", …) → InMemory (DEFAULT, zero
// behavior change). config.memoryBackend is loaded from ~/.mya/agent/config.json
// or env MYA_MEMORY_BACKEND — this wiring makes the previously-dead field live.
const memoryDbPath = join(homedir(), ".mya", "memory", "memory.db");

const { brain, close: closeBrainStore } = createBrainFromConfig(config.memoryBackend, memoryDbPath);
export { brain };

// ── Memory Manager with all 13 domains (wired, not dead code) ──
const allDomains = [
  archivistDomain, treeDomain, diffDomain, goalsDomain, syncDomain,
  graphDomain, conversationsDomain, searchDomain, sourcesDomain,
  entitiesDomain, storeDomain, toolsDomain, queueDomain,
];

const memoryDir = join(homedir(), ".mya", "memory");

// ── Dig 3 Phase D: JSONL→SQLite migration (closes wiring-review Finding 2) ──
// When Brain is durable (sqlite configured), migrate any existing brain.jsonl
// facts to the SQLite brain_* tables. Idempotent — skips if brain already has data.
// This runs ONLY when durable; the default InMemory path is untouched.
if (brain.isDurable) {
  try {
    const result = await migrateBrainJsonlToSqlite(brain, memoryDir);
    if (result.migrated > 0) {
      process.stderr.write(`\n[mya] Migrated ${result.migrated} Brain facts from JSONL to SQLite\n`);
    }
  } catch { /* migration is best-effort */ }
}

export const memory = MemoryManagerImpl.withBrain({
  brain,
  domains: allDomains,
  roleBackends: [
    new FileBackend("archivist", memoryDir),
    new FileBackend("goals", memoryDir),
  ],
  persistenceDir: memoryDir,
});

// Wire previously-dead domains (sources + store + goals)
storeDomain.wireManager(memory);
sourcesDomain.wireSource(new MemoryContextSource(memory));
// Goals domain needs a store backend — use the one registered for "goals" role
for (const backend of memory.backends) {
  if (backend.role === "goals") { goalsDomain.wireStore(backend); break; }
}

// ── Tier-3 unified pipeline: RetrievalEngine + LifecycleManager ──
// These replace the fragmented domain fan-out with a single coherent pipeline.
export const memoryTree = new MemoryTree(brain);
export const retrievalEngine = new RetrievalEngine();
export const lifecycleManager = new LifecycleManager(brain, memoryTree);
// Wire BrainStore into lifecycleManager so Takes/Pages persist after tick().
// Dig 3 Phase D: skip when Brain is durable — F2 gating (manager.ts:304,
// lifecycle.ts:132) already handles the SqliteBrainStore path, so the JSONL
// BrainStore would be a wasted/leaked handle.
import { BrainStore } from "@my-agent/memory";
if (!brain.isDurable) {
  const brainStore = new BrainStore(memoryDir);
  lifecycleManager.wireBrainStore(brainStore);
}

// ── Phase 6: SQLite memory manager (mnemopi pattern) ──
// SQLite IS the store. This replaces Brain Maps + brain.jsonl + RetrievalEngine.
import { SqliteMemoryManager, migrateOldMemory } from "@my-agent/memory";
export const sqliteMemory = new SqliteMemoryManager({
  dbPath: memoryDbPath,
});
// Migrate old brain.jsonl + archivist.md → SQLite (idempotent).
// Dig 3 Phase D: skip when durable — we no longer write brain.jsonl, so there's
// nothing to migrate. (migrateOldMemory is a harmless no-op when brain.jsonl is
// absent, but skipping avoids a pointless filesystem scan.)
if (!brain.isDurable) {
  try {
    const result = migrateOldMemory(sqliteMemory.getDatabase(), join(homedir(), ".mya", "memory"));
    if (result.migrated > 0) {
      process.stderr.write(`\n[mya] Migrated ${result.migrated} memories to SQLite\n`);
    }
  } catch { /* migration is best-effort */ }
}
// Ensure sqliteMemory + brain store are closed on process exit (WAL checkpoint).
// closeBrainStore is undefined when InMemory → closeBrainStore?.() is a no-op.
process.on("exit", () => { try { closeBrainStore?.(); } catch {} try { sqliteMemory.close(); } catch {} });
process.on("SIGINT", () => { try { closeBrainStore?.(); } catch {} try { sqliteMemory.close(); } catch {} process.exit(0); });
process.on("SIGTERM", () => { try { closeBrainStore?.(); } catch {} try { sqliteMemory.close(); } catch {} process.exit(0); });

export const wallet = new Wallet({ initial: { usdc: 1_000_000 } });
export const acp = new AcpBridge();
export const sync = new SyncServer();
export const collab = new CollabRelay();
export const packageHost = new PackageHost();
export const mcp = new McpManager();
export const channels = new ChannelRegistry();
registerBuiltinChannels(channels);
export const channelRouter = new ChannelSessionRouter();

// ── J2: Achievement tracker (persisted, stat-driven unlock) ──
import { AchievementTracker } from "@my-agent/audit";
export const achievements = new AchievementTracker();

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

// ── Auto-discover skills from ~/.mya/agent/skills/ ONLY (single source of truth —
//    matches pi's --skill dir in pi-main.ts; never ~/.agents/ or external) ──
void skillStore.discover(join(homedir(), ".mya", "agent", "skills")).catch(() => { /* optional */ });

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

// ── Roles registry (load ~/.mya/roles/*.json) ──
export const roleRegistry: RoleRegistry = loadRolesRegistry();

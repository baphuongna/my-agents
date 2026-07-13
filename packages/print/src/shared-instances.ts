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
import { Brain } from "@my-agent/memory";
import { Wallet } from "@my-agent/x402";
import { AcpBridge } from "@my-agent/acp";
import { SyncServer } from "@my-agent/sync";
import { CollabRelay } from "@my-agent/collab";
import { PackageHost } from "@my-agent/pkg";
import { CouncilProvider } from "@my-agent/council";
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
export const wallet = new Wallet({ initial: { usdc: 1_000_000 } });
export const acp = new AcpBridge();
export const sync = new SyncServer();
export const collab = new CollabRelay();
export const packageHost = new PackageHost();
export const mcp = new McpManager();
export const channels = new ChannelRegistry();
registerBuiltinChannels(channels);
export const channelRouter = new ChannelSessionRouter();

// ── Council (mock 1-member) ──
export const council: CouncilProvider | undefined = (() => {
  try {
    return new CouncilProvider({
      id: "mya-council",
      members: [{
        role: "advisor",
        profile: {
          id: "mock-advisor",
          model: "mock-advisor",
          health: () => "Healthy" as const,
          stream: async () => ({ events: [{ kind: "text" as const, text: "[council advisor not fully configured — add a second provider]" }] }),
        },
      }],
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

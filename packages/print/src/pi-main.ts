/**
 * mya — pi InteractiveMode + mya bridge extension.
 *
 * The bridge injects mya packages (AuditLog, SecretStore, HookRegistry,
 * SkillStore, Brain, Wallet, AcpBridge, SyncServer, CollabRelay, PackageHost,
 * custom tools, slash commands) into pi's TUI so they are VISIBLE and ACTIVE
 * during interactive use — not just print/rpc/serve mode.
 */

// Import via package name — esbuild alias remaps to vendored/ at bundle time
import { main } from "@earendil-works/pi-coding-agent";
import { createMyaBridge } from "./mya-bridge.js";
import { SecretStore, makeSecretRedactor } from "@my-agent/secrets";
import { AuditLog } from "@my-agent/audit";
import { HookRegistry, McpManager } from "@my-agent/gateway";
import { SkillStore } from "@my-agent/skills";
import { CronScheduler } from "@my-agent/cron";
import { Brain } from "@my-agent/memory";
import { Wallet } from "@my-agent/x402";
import { AcpBridge } from "@my-agent/acp";
import { SyncServer } from "@my-agent/sync";
import { CollabRelay } from "@my-agent/collab";
import { PackageHost } from "@my-agent/pkg";
import { CouncilProvider } from "@my-agent/council";
import type {
  ComponentHealth,
  History,
  ProviderProfile,
  StreamEvent,
  SystemPrompt,
} from "@my-agent/core";
import { join } from "node:path";
import { homedir } from "node:os";

// Shared instances (created once, reused across all TUI sessions).
const secretStore = new SecretStore();
const auditLog = new AuditLog((_kind, payload) => makeSecretRedactor(secretStore)(payload));
const hooks = new HookRegistry();
const skillStore = new SkillStore();
const cron = new CronScheduler();
const brain = new Brain();
const wallet = new Wallet({ initial: { "usdc": 1_000_000 } }); // faucet stake (smallest unit)
const acp = new AcpBridge();
const sync = new SyncServer();
const collab = new CollabRelay();
const packageHost = new PackageHost();
const mcp = new McpManager();

// Council: a 1-member council backed by a canned-response mock profile. The
// single-provider build (MiniMax only) has no second live model to fan out to,
// so we wire a deterministic mock advisor. This makes /council report a
// configured council (not "not configured") while remaining network-free.
const councilAdvisor: ProviderProfile = {
  id: "mya-council-advisor",
  model: "mock-advisor",
  health: (): ComponentHealth => "Healthy",
  async stream(
    _prompt: SystemPrompt,
    _history: History,
  ): Promise<{ events: StreamEvent[] }> {
    return {
      events: [
        { kind: "text", text: "[mya council advisor] standing by — wire a second provider to enable real fan-out." },
        { kind: "done", usage: { input: 0, output: 0 } },
      ],
    };
  },
};
const council = new CouncilProvider({
  members: [{ profile: councilAdvisor, role: "Advisor" }],
  strategy: "attributed",
});

// Load MCP server configs from ~/.mya/agent/mcp.json (if present).
const mcpConfigPath = join(homedir(), ".mya", "agent", "mcp.json");
let mcpConfigs: import("@my-agent/gateway").McpServerConfig[] = [];
try {
  const raw = await import("node:fs").then((fs) => fs.readFileSync(mcpConfigPath, "utf8"));
  const parsed = JSON.parse(raw) as { servers?: import("@my-agent/gateway").McpServerConfig[] };
  mcpConfigs = parsed.servers ?? [];
  for (const cfg of mcpConfigs) mcp.register(cfg);
} catch { /* mcp.json optional */ }

// Eagerly discover skills (best-effort, non-fatal).
void skillStore.discover(join(homedir(), ".mya", "skills")).catch(() => { /* optional */ });

export async function runPiInteractive(): Promise<void> {
  // Skip version check (mya has its own version lifecycle)
  process.env.PI_SKIP_VERSION_CHECK = "1";

  // DAP debug tool: enabled when MYA_DAP_COMMAND is set (e.g. "node --inspect").
  const dapCommand = process.env["MYA_DAP_COMMAND"];
  const dapConnect = dapCommand
    ? { connect: { command: dapCommand.split(" ")[0] ?? "node", args: dapCommand.split(" ").slice(1) } }
    : undefined;

  // Create the mya bridge extension — this injects all mya packages into pi.
  const myaBridge = createMyaBridge({
    auditLog,
    secretStore,
    hooks,
    skillStore,
    cron,
    brain,
    wallet,
    dapConnect,
    acp,
    sync,
    collab,
    packageHost,
    council,
    mcp,
    mcpConfigs,
  });

  const args = ["--model", "MiniMax-M3", ...process.argv.slice(2)];
  // Pass the bridge as an inline extension — pi loads it into the agent session.
  await main(args, { extensionFactories: [{ name: "mya-bridge", factory: myaBridge }] });
}

// Re-export for use by main.ts (shared instances).
export { secretStore, auditLog, hooks, skillStore, cron, brain, wallet, acp, sync, collab, packageHost, council, mcp };

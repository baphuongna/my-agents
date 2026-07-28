/**
 * mya — pi InteractiveMode + mya bridge extension.
 *
 * pi is LAZY-LOADED via dynamic import() → keeps the main bundle small.
 * Only loaded when the user enters interactive TUI mode.
 *
 * The bridge injects mya packages into pi's TUI so they are visible during
 * interactive use.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { createMyaBridge } from "./mya-bridge.js";
import * as shared from "./shared-instances.js";

// Filter out mya-specific flags that pi doesn't understand.
const MYA_FLAGS = new Set(["--no-launcher", "--print", "--json", "--rpc", "--debug"]);
function filterMyaFlags(argv: string[]): string[] {
  return argv.filter((a, i, arr) => {
    if (MYA_FLAGS.has(a)) return false;
    if (i > 0 && MYA_FLAGS.has(arr[i - 1]!)) return false;
    return true;
  });
}

export async function runPiInteractive(): Promise<void> {
  process.env.PI_SKIP_VERSION_CHECK = "1";

  // LAZY LOAD pi — this is the expensive import (2s, 12MB)
  // Only happens when user enters interactive mode, NOT at launcher startup.
  const { main } = await import("@my-agent/coding-agent");

  const myaBridge = createMyaBridge({
    auditLog: shared.auditLog,
    secretStore: shared.secretStore,
    hooks: shared.hooks,
    skillStore: shared.skillStore,
    cron: shared.cron,
    brain: shared.brain,
    memory: shared.memory,
    retrievalEngine: shared.retrievalEngine,
    lifecycleManager: shared.lifecycleManager,
    sqliteMemory: shared.sqliteMemory,
    wallet: shared.wallet,
    acp: shared.acp,
    sync: shared.sync,
    collab: shared.collab,
    packageHost: shared.packageHost,
    council: shared.council,
    mcp: shared.mcp,
    mcpConfigs: shared.mcpConfigs,
    channels: shared.channels,
    roleRegistry: shared.roleRegistry,
    achievements: shared.achievements,
  });

  // Pass user args directly to pi — pi handles model selection, thinking level,
  // auth detection, and settings natively. No forced --model or --thinking.
  // mya scopes skills to ~/.mya/agent/skills/ ONLY: set MYA_SKILL_SOURCE so the
  // forked resource-loader (updateSkillsFromPaths gate) ignores pi's auto-discovered
  // skills (~/.agents/skills, project dirs, pi-packages) and loads only this dir.
  // No --no-skills flag (that hid skills from the loaded-resources panel);
  // extensions + themes still load normally.
  process.env.MYA_SKILL_SOURCE = join(homedir(), ".mya", "agent", "skills");
  const piArgs = filterMyaFlags(process.argv.slice(2));
  await main(piArgs, { extensionFactories: [{ name: "mya-bridge", factory: myaBridge }] });
}

// Re-export shared instances for main.ts (backward compat)
export {
  shared as default,
};
export const { secretStore, auditLog, hooks, skillStore, wallet, cron, sync, collab } = shared;

/**
 * mya — pi InteractiveMode + mya bridge extension.
 *
 * pi is LAZY-LOADED via dynamic import() → keeps the main bundle small.
 * Only loaded when the user enters interactive TUI mode.
 *
 * The bridge injects mya packages into pi's TUI so they are visible during
 * interactive use.
 */
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
  const { main } = await import("@earendil-works/pi-coding-agent");

  const myaBridge = createMyaBridge({
    auditLog: shared.auditLog,
    secretStore: shared.secretStore,
    hooks: shared.hooks,
    skillStore: shared.skillStore,
    cron: shared.cron,
    brain: shared.brain,
    wallet: shared.wallet,
    acp: shared.acp,
    sync: shared.sync,
    collab: shared.collab,
    packageHost: shared.packageHost,
    council: shared.council,
    mcp: shared.mcp,
    mcpConfigs: shared.mcpConfigs,
    channels: shared.channels,
  });

  const piArgs = filterMyaFlags(process.argv.slice(2));
  const args = ["--model", "MiniMax-M3", ...piArgs];
  await main(args, { extensionFactories: [{ name: "mya-bridge", factory: myaBridge }] });
}

// Re-export shared instances for main.ts (backward compat)
export {
  shared as default,
};
export const { secretStore, auditLog, hooks, skillStore, wallet, cron, sync, collab } = shared;

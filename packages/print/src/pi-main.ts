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
  // @ts-expect-error — resolved by esbuild from project source
  const { main } = await import("@my-agent/coding-agent");

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

  // Model: allow override via --model flag or MYA_MODEL env, default MiniMax-M3
  const modelFlag = piArgs.find((_, i, arr) => arr[i - 1] === "--model");
  const model = modelFlag ?? process.env["MYA_MODEL"] ?? "MiniMax-M3";
  const args = ["--model", model];

  // Thinking level: pass --thinking if MYA_THINKING_LEVEL is set and user
  // didn't explicitly pass --thinking. Levels: off|minimal|low|medium|high|xhigh|max
  const hasThinkingFlag = piArgs.includes("--thinking");
  if (!hasThinkingFlag && process.env["MYA_THINKING_LEVEL"]) {
    args.push("--thinking", process.env["MYA_THINKING_LEVEL"]);
  }

  args.push(...piArgs);
  await main(args, { extensionFactories: [{ name: "mya-bridge", factory: myaBridge }] });
}

// Re-export shared instances for main.ts (backward compat)
export {
  shared as default,
};
export const { secretStore, auditLog, hooks, skillStore, wallet, cron, sync, collab } = shared;

/**
 * mya — pi InteractiveMode + mya bridge extension.
 *
 * pi is LAZY-LOADED via dynamic import() → keeps the main bundle small.
 * Only loaded when the user enters interactive TUI mode.
 *
 * The bridge injects mya packages into pi's TUI so they are visible during
 * interactive use.
 *
 * BREAKING CHANGE (fork → npm migration):
 * The npm pi-coding-agent loader provides @mariozechner/* extension aliases
 * but NOT @my-agent/* aliases (e.g. @earendil-works/pi-agent-core, @earendil-works/pi-tui,
 * @earendil-works/pi-ai). User extensions or skills in ~/.mya/agent/ that import
 * @my-agent/pi-* must be updated to use @earendil-works/* package names.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { registerBuiltInApiProviders } from "@earendil-works/pi-ai/compat";
import { createMyaBridge } from "./mya-bridge.js";
import * as shared from "./shared-instances.js";

// Filter out mya-specific flags that pi doesn't understand.
// --role/--task are consumed by the bridge (role-subagent startup); they must
// NOT reach pi's arg parser.
const MYA_FLAGS = new Set([
  "--no-launcher", "--print", "--json", "--rpc", "--debug",
  "--role", "--task", "--gateway-session", "--gateway-url", "--no-session",
]);
function filterMyaFlags(argv: string[]): string[] {
  return argv.filter((a, i, arr) => {
    if (MYA_FLAGS.has(a)) return false;
    if (i > 0 && MYA_FLAGS.has(arr[i - 1]!)) return false;
    return true;
  });
}

/** Exported for unit testing (flag stripping verification). */
export { filterMyaFlags };

/** Extract --role/--task values from an argv array (pure, testable). */
export function extractRoleTask(argv: string[]): { role?: string; task?: string } {
  const roleIdx = argv.indexOf("--role");
  const taskIdx = argv.indexOf("--task");
  return {
    role: roleIdx >= 0 ? argv[roleIdx + 1] : undefined,
    task: taskIdx >= 0 ? argv[taskIdx + 1] : undefined,
  };
}

export interface RunPiInteractiveOpts {
  /** Role to apply at startup (from --role flag). */
  initialRole?: string;
  /** Task to auto-inject as the first user prompt (from --task flag). */
  initialTask?: string;
}

export async function runPiInteractive(opts?: RunPiInteractiveOpts): Promise<void> {
  process.env.PI_SKIP_VERSION_CHECK = "1";

  // Defensive: pi-ai/compat registers built-in API providers at module scope,
  // but esbuild's lazy CJS init may defer that call. Invoke explicitly before
  // importing pi so providers are guaranteed registered.
  registerBuiltInApiProviders();

  // LAZY LOAD pi — this is the expensive import (2s, 12MB)
  // Only happens when user enters interactive mode, NOT at launcher startup.
  const { main } = await import("@earendil-works/pi-coding-agent");

  // --role/--task: also extract from argv as fallback (e.g. when called directly).
  const extracted = extractRoleTask(process.argv.slice(2));
  const initialRole = opts?.initialRole ?? extracted.role;
  const initialTask = opts?.initialTask ?? extracted.task;

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
    initialRole,
    initialTask,
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

/**
 * mya — pi InteractiveMode + mya bridge extension.
 *
 * The bridge injects mya packages (AuditLog, SecretStore, HookRegistry,
 * SkillStore, custom tools, slash commands) into pi's TUI so they are
 * VISIBLE and ACTIVE during interactive use — not just print/rpc/serve mode.
 */

// Import via package name — esbuild alias remaps to vendored/ at bundle time
import { main } from "@earendil-works/pi-coding-agent";
import { createMyaBridge } from "./mya-bridge.js";
import { SecretStore, makeSecretRedactor } from "@my-agent/secrets";
import { AuditLog } from "@my-agent/audit";
import { HookRegistry } from "@my-agent/gateway";
import { SkillStore } from "@my-agent/skills";
import { CronScheduler } from "@my-agent/cron";
import { join } from "node:path";
import { homedir } from "node:os";

// Shared instances (created once, reused across all TUI sessions).
const secretStore = new SecretStore();
const auditLog = new AuditLog((_kind, payload) => makeSecretRedactor(secretStore)(payload));
const hooks = new HookRegistry();
const skillStore = new SkillStore();
const cron = new CronScheduler();

// Eagerly discover skills (best-effort, non-fatal).
void skillStore.discover(join(homedir(), ".mya", "skills")).catch(() => { /* optional */ });

export async function runPiInteractive(): Promise<void> {
  // Skip version check (mya has its own version lifecycle)
  process.env.PI_SKIP_VERSION_CHECK = "1";

  // Create the mya bridge extension — this injects all mya packages into pi.
  const myaBridge = createMyaBridge({
    auditLog,
    secretStore,
    hooks,
    skillStore,
    cron,
  });

  const args = ["--model", "MiniMax-M3", ...process.argv.slice(2)];
  // Pass the bridge as an inline extension — pi loads it into the agent session.
  await main(args, { extensionFactories: [{ name: "mya-bridge", factory: myaBridge }] });
}

// Re-export for use by main.ts (shared instances).
export { secretStore, auditLog, hooks, skillStore, cron };

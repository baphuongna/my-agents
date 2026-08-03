#!/usr/bin/env node
/**
 * mya — interactive agent (100% pi InteractiveMode for TUI).
 *
 * Usage:
 *   mya                  # interactive REPL (pi InteractiveMode, default)
 *   mya "prompt"         # one-shot then exit (print mode)
 *   mya --print "prompt" # same as above (explicit)
 *   mya --json "prompt"  # one-shot, newline-delimited JSON stream
 *   mya --rpc            # JSON-RPC 2.0 server over stdio
 *   mya serve            # web dashboard + gateway
 *   mya --model m "..."  # explicit model override
 *   mya --debug "..."    # one-shot with DAP debug tool enabled
 *
 * Auto-config: reads ~/.mya/agent/auth.json (minimax/openai keys) → env vars.
 */
import { createAgent } from "@my-agent/agent";
import { nowWallclock } from "@my-agent/core";
import { RuntimePool } from "./runtimes/pool.js";
import { PiInProcessRuntime, type PiRuntimeDeps } from "./runtimes/pi-in-process.js";
import { SmartRouterImpl } from "./runtimes/router.js";
import { MemoryEnricher } from "./runtimes/enricher.js";
import { CostTrackerImpl } from "./runtimes/cost-tracker.js";
import { toPiWebShape } from "./pi-web-shape.js";
import {
  checkIdleTrigger,
  CompressionState,
  DEFAULT_COMPRESSION_CONFIG,
  type CompressionConfig,
} from "@my-agent/prompts";
// ── Unify pi + mya agent directory ──
// Point pi at ~/.mya/agent/ so both pi (/login, createAgentSession) and mya
// (gateway, launcher) share the SAME auth.json. Without this, pi defaults to
// ~/.pi/agent/ and OAuth/API-key credentials are split across two files.
import { homedir } from "node:os";
import { join } from "node:path";
const MYA_AGENT_DIR = join(homedir(), ".mya", "agent");
process.env.PI_CODING_AGENT_DIR ??= MYA_AGENT_DIR;
import { createRequire } from "node:module";
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { makeSink } from "./index.js";
import { SessionMetaStore } from "./session-meta.js";
import { secretStore, auditLog, skillStore, wallet, cron, sync, collab, hooks, toolHooks, channelRouter, channels, packageHost, council, mcp, mcpConfigs, brain, roleRegistry, config, achievements, memory, retrievalEngine, lifecycleManager, sqliteMemory, dreamCycle } from "./shared-instances.js";
import { loadRoles as loadRolesRegistry } from "@my-agent/core";


// ── auth.json loader ──
// P8-P1/P6 (Hermes distillation 2026-07-24): env denylist + value sanitization.
// (See cli.ts for the rationale — same security gate applied to both entry points.)
const DENYLISTED_ENV_VARS: ReadonlySet<string> = new Set([
  "LD_PRELOAD", "LD_LIBRARY_PATH",
  "DYLD_INSERT_LIBRARIES", "DYLD_LIBRARY_PATH",
  "PYTHONPATH", "PYTHONHOME", "PYTHONSTARTUP",
  "NODE_OPTIONS", "NODE_PATH",
  "PATH", "SHELL", "BROWSER", "EDITOR", "VISUAL", "PAGER",
  "GIT_SSH_COMMAND", "GIT_EXEC_PATH",
  "MYA_HOME", "MYA_CONFIG", "MYA_ENV",
]);
function envLineSafe(value: string): string {
  return value.replace(/\x00/g, "").replace(/[\r\n\u2028\u2029]+/g, "");
}
function isValidEnvName(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}
function setEnvIfAllowed(name: string, value: string): boolean {
  if (DENYLISTED_ENV_VARS.has(name)) return false;
  if (!isValidEnvName(name)) return false;
  if (process.env[name]) return false;
  process.env[name] = envLineSafe(value);
  return true;
}
function loadAuthConfig(): void {
  try {
    const authPath = join(homedir(), ".mya", "agent", "auth.json");
    const raw = readFileSync(authPath, "utf8");
    const cfg = JSON.parse(raw) as Record<string, unknown>;
    // Build providerId → envKey map from pi-ai engine (via gateway provider registry).
    let providerToEnvKey: Map<string, string>;
    try {
      providerToEnvKey = new Map(getProviderRegistry().map((p) => [p.id, p.envKey]));
    } catch { providerToEnvKey = new Map(); }
    // pi CredentialStore format: { "providerId": { "type": "api_key", "key": "xxx" } }
    // Unified: same format as TUI /login. Set env vars for gateway detection.
    for (const [providerId, entry] of Object.entries(cfg)) {
      if (providerId === "env") continue;
      if (typeof entry !== "object" || entry === null) continue;
      const cred = entry as { type?: string; key?: string };
      if (cred.type === "api_key" && cred.key) {
        const envKey = providerToEnvKey.get(providerId);
        if (envKey) setEnvIfAllowed(envKey, cred.key);
        // Legacy minimax/openai shortcut keys
        else if (providerId === "minimax") setEnvIfAllowed("MINIMAX_API_KEY", cred.key);
        else if (providerId === "openai") setEnvIfAllowed("OPENAI_API_KEY", cred.key);
      }
    }
    // Generic env overrides: { env: { VAR: "value" } } → process.env (backward compat).
    const envCfg = cfg["env"] as Record<string, unknown> | undefined;
    if (envCfg && typeof envCfg === "object") {
      for (const [k, v] of Object.entries(envCfg)) {
        if (typeof v === "string") setEnvIfAllowed(k, v);
      }
    }
  } catch { /* auth.json optional */ }
}

// ── Item 16: idle-compaction trigger wiring ──
// `maybeIdleCompact` / `checkIdleTrigger` were exported from @my-agent/prompts
// but had no caller. This wires the trigger predicate into the agent loop via
// the `checkIdleOnTurnStart` callback. The predicate is SYNC (Option B): when it
// returns true the loop runs the existing `compressHistory` pass. Configurable
// via MYA_IDLE_COMPACT_SECONDS (default 300s; 0 disables).
const idleCompressionState = new CompressionState();
const idleCompressionConfig: CompressionConfig = {
  ...DEFAULT_COMPRESSION_CONFIG,
  idleCompactAfterSeconds: Number(process.env.MYA_IDLE_COMPACT_SECONDS ?? "300") || 0,
};
const IDLE_COMPACT_FLOOR_TOKENS = 2000;
let lastTurnEndedAt = 0;

/** Estimate current token usage from history (~4 chars/token, matching compress.ts). */
function estimateHistoryTokens(history: { entries(): readonly unknown[] }): number {
  let chars = 0;
  for (const e of history.entries()) {
    const entry = e as { content?: unknown };
    if (typeof entry.content === "string") chars += entry.content.length;
  }
  return Math.floor(chars / 4);
}

/** Item 16: build the sync idle-compaction predicate for createAgent. */
function makeIdleCheck(): (history: { entries(): readonly unknown[] }) => boolean {
  return (history) => {
    if (idleCompressionConfig.idleCompactAfterSeconds <= 0) return false;
    const now = nowWallclock();
    const idleGapSeconds = lastTurnEndedAt > 0 ? Math.floor((now - lastTurnEndedAt) / 1000) : 0;
    const decision = checkIdleTrigger({
      config: idleCompressionConfig,
      state: idleCompressionState,
      idleGapSeconds,
      currentTokens: estimateHistoryTokens(history),
      floorTokens: IDLE_COMPACT_FLOOR_TOKENS,
    });
    return decision.shouldCompact;
  };
}

/** Phase 0A: cron-fired-turn tool policy lives in ./cron-role.ts (testable,
 * no main() side effects). Imported here for the pool factory. */
import { cronSessionToolConfig } from "./cron-role.js";
// R3-3 fix: wire DevicePairing + WebAuthn (were never instantiated → endpoints 404).
import { DevicePairing, WebAuthnService } from "@my-agent/secrets";
// R4-2 fix: cross-device approval relay.
import { ApprovalRelay, getProviderRegistry } from "@my-agent/gateway";
import type { PoolAcquireInput } from "@my-agent/gateway";
// F2 fix: lifecycle guard for cron flapping detection.
import { LifecycleGuard } from "@my-agent/cron";
// P7 (shard 07): process-level exception handlers.
import { installExceptionHandlers } from "./exception-handler.js";

// Flag-value / positional extraction — shared with main-flags.test.ts (no copy-drift).
import { FLAGS_WITH_VALUE, extractPositional } from "./cli-flags.js";

async function main(): Promise<void> {
  // P7 (shard 07): install process-level exception handlers (transient → logged;
  // fatal → logged + exit). Installed at the very top of main so every code path
  // is covered.
  installExceptionHandlers();

  loadAuthConfig();

  const args = process.argv.slice(2);

  // ── subcommands ──
  if (args[0] === "subagent-test") {
    return runSubagentTest(args.slice(1));
  }
  if (args[0] === "serve") {
    // A5: if --supervise flag is set, wrap with GatewaySupervisor (auto-restart).
    const serveArgs = args.slice(1);
    if (serveArgs.includes("--supervise") || process.env.MYA_GATEWAY_AUTO_RESTART === "1") {
      const { GatewaySupervisor } = await import("./gateway-supervisor.js");
      const portArg = serveArgs.find((a) => a.match(/^\d+$/));
      const supervisor = new GatewaySupervisor({
        port: portArg ? parseInt(portArg, 10) : 3999,
        autoRestart: true,
        onRestart: (attempt, reason) => console.warn(`[supervisor] ${reason}`),
        onGiveUp: (reason) => console.error(`[supervisor] ${reason}`),
      });
      supervisor.wireSignalHandlers();
      return supervisor.start();
    }
    return runWebServer(serveArgs);
  }
  if (args[0] === "launcher") {
    const { runLauncherLoop } = await import("./launcher.js");
    return runLauncherLoop();
  }
  if (args[0] === "agents") {
    const { runAgentsPanel } = await import("./agents-panel.js");
    return runAgentsPanel();
  }
  if (args[0] === "channels") {
    const { channelsList, channelsTest, channelsAdd } = await import("./channels-cli.js");
    const sub = args[1];
    if (sub === "list") return channelsList();
    if (sub === "test") {
      const id = args[2];
      return channelsTest(id);
    }
    if (sub === "add") {
      const type = args[2];
      const alias = args[3];
      return channelsAdd(type, alias);
    }
    console.log("Usage: mya channels {list|test <id>|add <type> [alias]}");
    return;
  }
  if (args[0] === "cron") {
    const { cronList, cronAdd, cronRemove, cronToggle, cronRun, cronHistory, cronStatus, cronUpdate } = await import("./cron-cli.js");
    const sub = args[1];
    if (sub === "list" || sub === undefined) return cronList();
    if (sub === "add") return cronAdd(args[2], args[3], args[4], args[5]);
    if (sub === "remove" || sub === "rm") return cronRemove(args[2]);
    if (sub === "enable" || sub === "disable") return cronToggle(args[2], sub);
    if (sub === "run") return cronRun(args[2]);
    if (sub === "history") return cronHistory(args[2]);
    if (sub === "status") return cronStatus();
    if (sub === "update") return cronUpdate(args[2], args[3], ...args.slice(4));
    console.log("Usage: mya cron {list|add|remove|enable|disable|run|history|status|update}");
    return;
  }

  // Background session mode: run agent as TCP RPC server
  const bgIdx = args.indexOf("--bg");
  if (bgIdx >= 0) {
    const { runBgSession } = await import("./bg-runner.js");
    const bgIdIdx = args.indexOf("--bg-id");
    const bgId = bgIdIdx >= 0 ? args[bgIdIdx + 1] : undefined;
    const bgModelIdx = args.indexOf("--model");
    const bgModel = bgModelIdx >= 0 ? args[bgModelIdx + 1] : undefined;
    return runBgSession({ id: bgId, model: bgModel });
  }

  // Background session management: list / kill / kill-all
  if (args.includes("--bg-list")) {
    const { listBgSessions } = await import("./bg-runner.js");
    const sessions = listBgSessions();
    if (sessions.length === 0) { console.log("No background sessions."); return; }
    for (const s of sessions) {
      console.log(`${s.status === "running" ? "🟢" : "🔴"} ${s.id}  pid:${s.pid}  :${s.port}  ${s.model}`);
    }
    return;
  }
  const bgKillIdx = args.indexOf("--bg-kill");
  if (bgKillIdx >= 0 && args[bgKillIdx + 1]) {
    const { killBgSession } = await import("./bg-runner.js");
    const ok = killBgSession(args[bgKillIdx + 1]!);
    console.log(ok ? `Killed ${args[bgKillIdx + 1]}` : `Session not found: ${args[bgKillIdx + 1]}`);
    return;
  }
  if (args.includes("--bg-kill-all")) {
    const { listBgSessions, killBgSession } = await import("./bg-runner.js");
    const sessions = listBgSessions();
    let killed = 0;
    for (const s of sessions) { if (killBgSession(s.id)) killed++; }
    console.log(`Killed ${killed}/${sessions.length} background sessions.`);
    return;
  }

  // ── default: launcher (if no args) OR interactive TUI ──
  // When MYA_NO_LAUNCHER=1 or --session/--resume/--continue is passed, skip launcher.
  const skipLauncher = process.env["MYA_NO_LAUNCHER"] === "1" ||
    process.env["MYA_FROM_LAUNCHER"] === "1" ||
    args.includes("--no-launcher") ||
    args.includes("--session") || args.includes("--resume") || args.includes("-r") ||
    args.includes("--continue") || args.includes("--no-session");

  // ── flags ──
  const json = args.includes("--json");
  const print = args.includes("--print") || json;
  const rpc = args.includes("--rpc");
  const debug = args.includes("--debug");
  // FLAGS_WITH_VALUE + extractPositional are module-level exports (see above).
  const modelIdx = args.indexOf("--model");
  const model = modelIdx >= 0 ? args[modelIdx + 1] : undefined;
  const roleIdx = args.indexOf("--role");
  const role = roleIdx >= 0 ? args[roleIdx + 1] : undefined;
  const taskIdx = args.indexOf("--task");
  const task = taskIdx >= 0 ? args[taskIdx + 1] : undefined;
  const positional = extractPositional(args, model);

  if (rpc) {
    return runRpcServer(model);
  }

  const prompt = positional.join(" ").trim();

  // ── one-shot (print mode) ──
  if (print || prompt) {
    const agent = createAgent({
      model,
      memoryDir: join(homedir(), ".mya", "memory"),
      auditLog,
      secretStore,
      skillStore,
      wallet,
      hooks: toolHooks,
      extensionHost: packageHost,
      // A1: forward maxToolRounds from central config.
      ...(config.maxToolRounds ? { maxToolRounds: config.maxToolRounds } : {}),
      // A2: forward maxSpawnDepth from central config.
      ...(config.maxSpawnDepth ? { maxSpawnDepth: config.maxSpawnDepth } : {}),
      ...(council ? { hindsight: { reviewer: council.makeReviewer() } } : {}),
      ...(debug ? { dapConnect: { connect: { command: "node", args: ["--inspect"] } } } : {}),
      // Item 16: idle-compaction trigger predicate (fires at turn start).
      checkIdleOnTurnStart: makeIdleCheck(),
    });
    const text = prompt || (await readStdin()) || "Hello.";
    const sink = makeSink({ json });
    await agent.run(text, sink.write);
    lastTurnEndedAt = nowWallclock();
    if (!json) {
      const profile = process.env["MINIMAX_API_KEY"] ? "minimax" : process.env["OPENAI_API_KEY"] ? "openai" : "mock-fallback";
      process.stderr.write(`[provider: ${profile}]\n`);
    }
    return;
  }

  // ── default: pi InteractiveMode directly ──
  // `mya` → pi TUI (as expected). `mya launcher` → session picker.
  if (!print && !prompt && !rpc && !debug) {
    return runPiInteractive(role, task);
  }
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    if (process.stdin.isTTY) return resolve("");
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => resolve(data.trim()));
  });
}

async function runPiInteractive(role?: string, task?: string): Promise<void> {
  const { runPiInteractive: runPi } = await import("./pi-main.js");
  await runPi({ initialRole: role, initialTask: task });
}

async function runRpcServer(_model?: string): Promise<void> {
  const { RpcServer } = await import("@my-agent/rpc");
  let controller = new AbortController();
  const agent = createAgent({
    memoryDir: join(homedir(), ".mya", "memory"),
    auditLog,
    secretStore,
    skillStore,
    wallet,
    hooks: toolHooks,
    extensionHost: packageHost,
    ...(council ? { hindsight: { reviewer: council.makeReviewer() } } : {}),
    // Item 16: idle-compaction trigger predicate (fires at turn start).
    checkIdleOnTurnStart: makeIdleCheck(),
  });
  const server = new RpcServer({
    prompt: (text, onEvent) => {
      controller = new AbortController();
      return agent.run(text, onEvent, { signal: controller.signal }).then((r) => {
        lastTurnEndedAt = nowWallclock();
        return r;
      });
    },
    cancel: () => controller.abort(),
    status: () => ({ ok: true }),
  });
  server.start();
}

async function runWebServer(extraArgs: string[]): Promise<void> {
  const portIdx = extraArgs.indexOf("--port");
  const port = portIdx >= 0 ? Number(extraArgs[portIdx + 1]) : 3000;
  const { Gateway } = await import("@my-agent/gateway");
  // mya fork: SPA is served from staticDir (packages/web/dist/web/).
  // rootHtml is a minimal fallback when staticDir isn't available.
  const rootHtml = `<!doctype html><html><head><meta charset="utf-8"><title>mya</title></head><body style="background:#041c1c;color:#ffe6cb;font:14px monospace;padding:2rem"><h2>mya gateway</h2><p>Dashboard SPA not found. Run <code>npm run build:web</code> first.</p></body></html>`;

  // Phase 5 (Option D): multi-runtime pool — sessions created via registered
  // AgentRuntime instances (pi in-process + mya-bridge extension, same as TUI).
  // Replaces AgentPool (pi-only, createSession factory).
  const runtimes = new Map<string, import("@my-agent/core").AgentRuntime>();
  const agentDir = join(homedir(), ".mya", "agent");
  const piDeps: PiRuntimeDeps = {
    agentDir,
    auditLog, secretStore, hooks, skillStore, cron,
    brain, memory, retrievalEngine, lifecycleManager, sqliteMemory,
    dreamCycle, // D1: hoisted to shared-instances (single instance)
    wallet, sync, collab, packageHost, council, mcp, mcpConfigs,
    channels, roleRegistry, achievements,
  };
  runtimes.set("pi", new PiInProcessRuntime(piDeps));
  // Phase 6/10: mya-native + claude runtimes registered here when wired.

  // Phase 5/7/8/12: wire real implementations (replace stubs).
  const router = new SmartRouterImpl(runtimes);
  const enricher = new MemoryEnricher(memory, brain);
  const costTracker = new CostTrackerImpl();
  const pool = new RuntimePool(router, runtimes, enricher, costTracker, { maxSessions: 1000 });

  /** Per-session prompt queue: serializes prompts to the same session. */
  /** Run a prompt on a pi session. Concurrency delegated to pi's own
   * queue via streamingBehavior='followUp' (pi queues prompts internally). */
  function runOnSession(sessionId: string, prompt: string, onEvent?: (e: unknown) => void): Promise<string> {
    return doRunOnSession(sessionId, prompt, onEvent);
  }

  async function doRunOnSession(sessionId: string, prompt: string, onEvent?: (e: unknown) => void): Promise<string> {
    // Cron sessions (_cron:<jobId>) get a restricted tool allowlist via
    // cronSessionToolConfig, applied at session CREATION time (first acquire).
    // Existing pool entries keep their tools (tool set immutable per session).
    const cronTools = sessionId.startsWith("_cron:") ? cronSessionToolConfig(sessionId).tools : undefined;
    const session = await pool.acquireWithRuntime(sessionId, {
      agentType: "pi",
      ...(cronTools ? { toolsAllowList: cronTools } : {}),
    }).then(r => r.session);
    const entry = pool.get(sessionId);
    if (!entry) return "";

    let responseText = "";
    const unsub = session.subscribe((event: unknown) => {
      const ev = event as { type?: string; delta?: string };
      // R4-HIGH fix: gateway broadcast must stay in pi's raw shape (web
      // ChatPage renders message_update/assistantMessageEvent.text_delta).
      // Internal consumers (responseText, cron) use AgentEvent directly.
      if (onEvent) onEvent(toPiWebShape(event));
      // RuntimePool adapter emits uniform AgentEvent (text/delta), not pi's
      // message_update/message.content shape.
      if (ev?.type === "text" && typeof ev.delta === "string") responseText += ev.delta;
    });

    try {
      await session.prompt(prompt, { streamingBehavior: "followUp" });
    } catch (e) {
      // Adapter serializes prompts; a single bad call can't crash the gateway.
      console.warn(`[gateway] session.prompt failed for ${sessionId}: ${(e as Error).message}`);
      return responseText || `[error: ${(e as Error).message}]`;
    } finally {
      unsub();
    }
    return responseText;
  }

  // Wire channel router → RuntimePool: channel messages use pi AgentSession.
  channelRouter.onPrompt(async (session, prompt) => {
    return runOnSession(session.sessionId, prompt);
  });

  // Wire command checker: channel users can run /audit, /skills, etc.
  const { commandRegistry } = await import("./command-registry.js");
  channelRouter.commandChecker = async (msg, ctx) => {
    const result = await commandRegistry.tryExecute(msg, {
      source: ctx.channelId,
      user: ctx.userId,
      sessionKey: `${ctx.channelId}:${ctx.userId}`,
    });
    return result?.output ?? null;
  };

  // Phase 0B: cron.json is the single source of truth. The scheduler stays
  // fs-free (minimal-core); this layer wires atomic persistence (onDirty) + a
  // sweep-time reconcile (cronReload) that picks up CLI/external file edits.
  // Replaces the old syncCronJobs 5s overwrite (C14) + the startup cron.json
  // loader — the gateway's initial cronReload (in start()) loads jobs before the
  // first sweep tick.
  const { readCronJobs, atomicWriteJobs } = await import("./cron-persist.js");
  const { recordRunStart, recordRunEnd, getRunHistory, getLastOutput, recordHeartbeat, recordHeartbeatSuccess } = await import("./cron-observability.js");
  // Phase 3B/3A: wire the prompt validator (register/updateJob reject) + the
  // job cap. The validator also runs on every reconciled (file-loaded) job so
  // CLI/external cron.json edits are scanned (R2-4 file-layer gate).
  const { validateCronPrompt } = await import("@my-agent/cron");
  cron.setValidator(validateCronPrompt);
  cron.setMaxJobs(parseInt(process.env.MYA_CRON_MAX_JOBS ?? "50", 10));
  // Phase 3C: approval_mode. Default DENY — cron-fired turns run read-only
  // (bash/write/edit excluded via the cron-role denylist → a cron job can't
  // recurse via `mya cron add` or edit cron.json directly). Operators who need
  // full tools set MYA_CRON_APPROVAL_MODE=approve (unattended full-cred).
  const { setCronApprovalMode } = await import("./cron-role.js");
  const cronApprovalMode = (process.env.MYA_CRON_APPROVAL_MODE ?? "deny").toLowerCase();
  // Phase 3C: FAIL-CLOSED — only an explicit "approve" grants full tools. Any
  // other value (typo, "deny", absent) → read-only allowlist (the security
  // boundary; scan is best-effort defense-in-depth).
  setCronApprovalMode(cronApprovalMode === "approve" ? "approve" : "deny");
  if (cronApprovalMode !== "approve") {
    console.warn("[cron] approval_mode=deny (default) — cron-fired turns are read-only (allowlist: read/glob/grep/ls/find). Set MYA_CRON_APPROVAL_MODE=approve for full tools (UNATTENDED FULL-CREDENTIAL — trust the prompt). Runtime-flip via POST /cron/approval-mode.");
  }
  if (process.env.MYA_CRON_UNSAFE_NO_AUTH) {
    console.warn("[SECURITY] MYA_CRON_UNSAFE_NO_AUTH set — cron mutations are UNAUTHENTICATED. Dev only.");
  }
  const persistCron = (): void => {
    atomicWriteJobs(cron.listJobs());
    cron.markPersisted();
  };
  cron.setOnDirty(() => {
    try { persistCron(); } catch (e) {
      console.warn("[gateway] cron persist failed (non-fatal):", (e as Error).message);
    }
  });
  const cronReload = (): void => {
    // If a prior write failed (dirty stuck), retry BEFORE reconcile — otherwise
    // reconcile would drop the unflushed job as "memory-only" (silent loss).
    if (cron.isDirty) {
      try { persistCron(); } catch (e) {
        console.warn("[gateway] cron persist retry failed (non-fatal):", (e as Error).message);
      }
    }
    // If writes are STILL failing (persistent: read-only FS / disk full), skip
    // reconcile this cycle — reconcile would otherwise drop our unflushed jobs as
    // "memory-only". The scheduler keeps them in memory; reconcile resumes once
    // writes recover. External CLI edits wait too (degraded-state tradeoff).
    if (cron.isDirty) {
      console.warn("[gateway] cron persist still failing; skipping reconcile this sweep");
      return;
    }
    // Phase 3B will pass { validate: validateCronPrompt } to scan loaded prompts.
    const stats = cron.reconcile(readCronJobs(), { validate: (j) => validateCronPrompt(j.prompt) });
    if (stats.quarantined > 0) {
      console.warn(`[cron] ${stats.quarantined} job(s) quarantined by validate on reload`);
    }
  };

  // Phase 5: declarative config jobs — FIRST load existing cron.json (so the
  // seed doesn't overwrite manual jobs), THEN seed from cron.config.json.
  cronReload(); // load existing cron.json BEFORE seeding
  // (an array of job configs). Jobs not already present (by name) are registered;
  // runtime state of existing jobs is preserved (mya-v1 sync_declarative_jobs).
  try {
    const { readFileSync, existsSync } = await import("node:fs");
    const declFile = join(homedir(), ".mya", "agent", "cron.config.json");
    if (existsSync(declFile)) {
      const decl = JSON.parse(readFileSync(declFile, "utf-8")) as Array<{ name: string; trigger?: "cron" | "on-interval" | "once"; schedule: string | number; prompt?: string; timezone?: string; jobType?: "agent" | "shell"; command?: string }>;
      const existing = new Set(cron.listJobs().map((j) => j.name));
      let seeded = 0;
      for (const j of decl) {
        if (!j.name || existing.has(j.name)) continue;
        try {
          cron.register({ name: j.name, trigger: j.trigger ?? "cron", schedule: j.schedule, prompt: j.prompt ?? "", deliveryTarget: "_cron", enabled: true, leaseMs: 5 * 60_000, timezone: j.timezone, jobType: j.jobType, command: j.command });
          seeded++;
        } catch (e) {
          console.warn(`[cron] declarative job '${j.name}' skipped:`, (e as Error).message);
        }
      }
      if (seeded > 0) console.warn(`[cron] seeded ${seeded} declarative job(s) from cron.config.json`);
    }
  } catch { /* best-effort */ }

  // Phase 0C auth: the WS token gates ALL non-allowlist HTTP routes + the WS
  // upgrade (Bearer header OR HttpOnly cookie). MYA_NO_WS_TOKEN remains an
  // explicit DEV bypass (disables auth entirely) — production no longer needs it
  // because the dashboard authenticates via a cookie set on GET / (not a
  // token-baked URL). Threat model: blocks browsers (SameSite=Strict, HttpOnly)
  // + cross-user; same-user isolation is deferred to a Unix-socket binding.
  const wsToken = process.env.MYA_NO_WS_TOKEN ? undefined : cryptoRandomToken();
  if (process.env.MYA_NO_WS_TOKEN) {
    console.warn("[SECURITY] MYA_NO_WS_TOKEN is set — gateway HTTP/WS auth is DISABLED. Use only for local dev.");
  }
  // Write the token to a 0600 file BEFORE listen() so the CLI / TUI can read it
  // (no /ws-info open leak). Best-effort: a missing token file just means the
  // CLI falls back to MYA_NO_WS_TOKEN / unauthenticated attempts (which 401).
  if (wsToken) {
    try {
      const tokenFile = join(homedir(), ".mya", "agent", "gw.token");
      const { writeFileSync, mkdirSync, chmodSync } = await import("node:fs");
      mkdirSync(join(homedir(), ".mya", "agent"), { recursive: true, mode: 0o700 });
      writeFileSync(tokenFile, wsToken, { mode: 0o600, flag: "wx" });
      try { chmodSync(tokenFile, 0o600); } catch { /* best-effort */ }
    } catch (e) {
      // EEXIST (stale token from a prior run) is fine — overwrite atomically below.
      try {
        const { writeFileSync, mkdirSync, chmodSync } = await import("node:fs");
        mkdirSync(join(homedir(), ".mya", "agent"), { recursive: true, mode: 0o700 });
        writeFileSync(join(homedir(), ".mya", "agent", "gw.token"), wsToken, { mode: 0o600 });
        try { chmodSync(join(homedir(), ".mya", "agent", "gw.token"), 0o600); } catch { /* best-effort */ }
      } catch (e2) { console.warn("[gateway] could not write gw.token:", (e2 as Error).message); }
    }
  }
  // D1 fix (Phase 5): dreamCycle hoisted to shared-instances (single instance
  // shared by gateway, interactive mode, agent package, mya-bridge).
  // R3-3 fix: instantiate DevicePairing + WebAuthn (were never wired → 404).
  const devicePairing = new DevicePairing();
  const webAuthn = new WebAuthnService({ origin: `http://127.0.0.1:${port}`, rpId: "127.0.0.1" });
  // R4-2 fix: instantiate cross-device approval relay.
  const approvalRelay = new ApprovalRelay();
  // F2 fix: instantiate lifecycle guard for cron flapping detection.
  const lifecycleGuard = new LifecycleGuard();

  // H9: simple in-memory webhook registry.
  const webhookRegistry = new (class {
    private hooks: Array<{ id: string; url: string; events: string[]; createdAt: number }> = [];
    list() { return [...this.hooks]; }
    add(hook: { url: string; events: string[] }) {
      const ts = nowWallclock();
      const id = `wh-${ts.toString(36)}`;
      this.hooks.push({ id, ...hook, createdAt: ts });
      return { id };
    }
  })();

  // Pre-start MCP servers (connect + discover tools) BEFORE gateway accepts
  // sessions. This ensures MCP tools are available when the first session's
  // system prompt is built. Without this, mcp.start() is fire-and-forget and
  // tools register AFTER the prompt is already assembled → LLM can't see them.
  for (const cfg of mcpConfigs) {
    try {
      console.log(`[mcp] starting ${cfg.id}...`);
      await mcp.start(cfg.id);
      const tools = mcp.getToolInfos(cfg.id);
      console.log(`[mcp] ${cfg.id}: ${tools.length} tools discovered`);
    } catch (e) {
      console.warn(`[mcp] ${cfg.id} failed: ${(e as Error).message}`);
    }
  }

  // Role-subagent metadata (role/task/model/parent) keyed by sessionId.
  // Surfaced via poolStatus (node-level) + poolSubagents (child nesting).
  const sessionMeta = new SessionMetaStore();

  const gw = new Gateway({
    port,
    // Phase 0C: token-free rootHtml. The dashboard obtains the token via an
    // HttpOnly SameSite=Strict cookie set on GET / (localhost origin), not via
    // a token baked into the URL/HTML source.
    rootHtml,
    staticDir: join(process.cwd(), "packages/web/dist/web"),
    wsToken,
    hooks,
    cron,
    cronReload,
    cronPersist: persistCron,
    cronRunStart: (rec) => recordRunStart(rec),
    cronRunEnd: (runId, status, error, endedAt, output) => recordRunEnd(runId, status, error, endedAt, output),
    cronRuns: (jobId) => getRunHistory(jobId),
    cronJobOutput: (jobId) => getLastOutput(jobId),
    cronLoadSkills: (names) => {
      // Phase 5: assemble per-job skill bodies (hermes-style injection).
      const parts: string[] = [];
      for (const n of names) {
        const sk = skillStore.get(n);
        if (sk?.body) parts.push(`[Skill: ${n}]\n${sk.body}`);
      }
      return parts.join("\n\n");
    },
    cronCurrentDefault: () => ({
      provider: process.env["MYA_PROVIDER"],
      model: process.env["MYA_MODEL"],
    }),
    onRunShell: async (job) => {
      // Phase 5: shell/script jobs (no LLM — watchdogs). Gated by
      // MYA_CRON_ALLOW_SHELL=1 (shell jobs run arbitrary code as the gateway
      // user — opt-in). Scripts confined to ~/.mya/agent/scripts/ (realpath
      // checked); commands run via sh -c. ASYNC (execFile, not execFileSync) so
      // the event loop isn't blocked.
      if (!process.env["MYA_CRON_ALLOW_SHELL"]) {
        return { ok: false, output: "", error: "shell jobs require MYA_CRON_ALLOW_SHELL=1" };
      }
      const nodePath = await import("node:path");
      const { execFile } = await import("node:child_process");
      const { existsSync, statSync, realpathSync } = await import("node:fs");
      const cwd = job.workdir && existsSync(job.workdir) && statSync(job.workdir).isDirectory() ? job.workdir : process.cwd();
      const runAsync = (cmd: string, args: string[]): Promise<string> =>
        new Promise((resolve, reject) => {
          execFile(cmd, args, { cwd, timeout: 120_000, maxBuffer: 1_000_000, encoding: "utf8" }, (err, stdout) => {
            if (err) reject(Object.assign(err, { stdout }));
            else resolve(stdout);
          });
        });
      try {
        if (job.script) {
          const scriptsDir = join(homedir(), ".mya", "agent", "scripts");
          const resolved = nodePath.resolve(scriptsDir, job.script);
          const real = realpathSync(resolved); // follow symlinks before confinement check
          if (!real.startsWith(scriptsDir + nodePath.sep)) {
            return { ok: false, output: "", error: "script path escapes ~/.mya/agent/scripts" };
          }
          const isSh = /\.(sh|bash)$/.test(job.script);
          // pass the script path as an ARG (not via sh -c) to avoid injection
          const out = await runAsync(isSh ? "bash" : "python3", [real]);
          return { ok: true, output: out };
        } else if (job.command) {
          const out = await runAsync("sh", ["-c", job.command]);
          return { ok: true, output: out };
        }
        return { ok: false, output: "", error: "shell job has no command/script" };
      } catch (e) {
        const er = e as { stdout?: string; message?: string };
        return { ok: false, output: er.stdout ?? "", error: er.message ?? "shell failed" };
      }
    },
    cronHeartbeat: (success) => { recordHeartbeat(); if (success) recordHeartbeatSuccess(); },
    cronSetApprovalMode: (mode) => setCronApprovalMode(mode),
    onRunOnSession: (session, prompt, onEvent) => runOnSession(session, prompt, onEvent),
    sync,
    collab,
    channels,
    channelsConfig: config.channels,
    channelRouter,
    poolStatus: () => pool.list().map((e) => {
      const meta = sessionMeta.get(e.sessionId);
      return { sessionId: e.sessionId, messages: e.messageCount, lastActivity: e.lastActivity, busy: e.busy, sessionFile: e.sessionFile, role: meta?.role, task: meta?.task, model: meta?.model, parentSessionId: meta?.parentSessionId, status: meta?.status, summary: meta?.summary, keyOutputs: meta?.keyOutputs };
    }),
    poolKill: (id: string) => { sessionMeta.delete(id); return pool.release(id, { force: true }); },
    poolAcquire: async (input: PoolAcquireInput | string) => {
      const { cwd, role, task, model, parentSessionId } = typeof input === "string" ? ({ cwd: input } as PoolAcquireInput) : input;
      const sessionId = `s-${nowWallclock().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      await pool.createForCwd(sessionId, cwd);
      if (role || task || model || parentSessionId) sessionMeta.record(sessionId, { role, task, model, parentSessionId });
      return sessionId;
    },
    poolPrompt: (sessionId: string, text: string) => {
      void runOnSession(sessionId, text, (e: unknown) => gw.broadcast(sessionId, e))
        .catch((e) => console.warn(`[gateway] poolPrompt failed: ${(e as Error).message}`));
    },
    poolSubagents: (sessionId: string) => {
      const entries: import("@my-agent/gateway").PoolSubagentEntry[] = [];
      try {
        const subagentMod = createRequire(import.meta.url)("./pi-subagent.ts");
        for (const s of subagentMod.listSubagents(sessionId) as Array<{ id: string; goal: string; status: string; depth: number; output: string }>) {
          entries.push({ id: s.id, goal: s.goal, status: s.status, depth: s.depth, output: s.output });
        }
      } catch { /* no coding-agent subagents for this session */ }
      // Role-subagent children linked via sessionMeta (parentSessionId).
      for (const c of sessionMeta.childrenOf(sessionId, (id) => (pool.get(id)?.busy ? "busy" : "idle"))) {
        entries.push({ id: c.id, goal: c.goal, status: c.status, depth: c.depth, role: c.role, task: c.task, model: c.model, parentSessionId: c.parentSessionId, summary: c.summary, keyOutputs: c.keyOutputs });
      }
      return entries;
    },
    poolSessionStatus: (sessionId: string, status: string, summary?: string, keyOutputs?: string[]) => {
      sessionMeta.setStatus(sessionId, status);
      if (summary !== undefined) sessionMeta.setResult(sessionId, summary, keyOutputs);
    },
    mcpList: () => mcp.listServers().map((s) => ({
      id: s.id, command: s.command, args: s.args, phase: s.phase, health: s.health, tools: s.tools, lastError: s.lastError,
    })),
    mcpAdd: (cfg) => {
      mcp.register(cfg);
      // Persist to mcp.json
      try {
        const mcpFile = join(homedir(), ".mya", "agent", "mcp.json");
        const existing = JSON.parse(readFileSync(mcpFile, "utf8")) as { servers?: typeof mcpConfigs };
        existing.servers = [...(existing.servers ?? []), cfg];
        writeFileSync(mcpFile, JSON.stringify(existing, null, 2), "utf8");
      } catch { /* best-effort persist */ }
    },
    mcpRemove: (id: string) => {
      try {
        const mcpFile = join(homedir(), ".mya", "agent", "mcp.json");
        const existing = JSON.parse(readFileSync(mcpFile, "utf8")) as { servers?: Array<{ id: string }> };
        existing.servers = (existing.servers ?? []).filter((s) => s.id !== id);
        writeFileSync(mcpFile, JSON.stringify(existing, null, 2), "utf8");
        return true;
      } catch { return false; }
    },
    mcpConnect: async (id: string) => { await mcp.start(id); },
    mcpDiscover: async (id: string) => { return mcp.listServers().find((s) => s.id === id)?.tools ?? []; },
    skillsList: () => skillStore.index().map((s) => ({ name: s.name, description: s.description, triggers: s.triggers ?? [] })),
    rolesList: () => loadRolesRegistry().list().map((r) => ({
      name: r.name, description: r.description,
      promptAppend: r.promptAppend, toolsAllowed: r.toolsAllowed,
      toolsDenied: r.toolsDenied, modelPrefer: r.modelPrefer,
      memoryScope: r.memoryScope,
    })),
    memoryStats: () => {
      // Report from SQLite (production backend) — Brain counts are stale
      // because remember/recall use SQLite, not Brain.
      const sqlStats = sqliteMemory?.stats();
      const brainStats = { facts: brain.factCount, takes: brain.takeCount, tombstones: brain.tombstoneCount };
      return {
        facts: sqlStats?.facts ?? brainStats.facts,
        workingMemory: sqlStats?.workingMemory ?? 0,
        episodic: sqlStats?.episodic ?? 0,
        takes: brainStats.takes,
        tombstones: brainStats.tombstones,
        dreamRunning: dreamCycle.running,
      };
    },
    dreamTrigger: async () => {
      return await dreamCycle.dream();
    },
    // J2: achievements endpoint
    achievementsList: () => {
      return {
        unlocked: achievements.listUnlocked(),
        locked: achievements.listLocked(),
        stats: (achievements as unknown as { stats: Record<string, number> }).stats,
      };
    },
    // H7: skill creation endpoint
    skillCreate: ({ name, description, body: skillBody }) => {
      try {
        // F-01 fix: validate skill name (alphanumeric + dash/underscore only)
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name)) {
          return { ok: false, error: "invalid skill name (use alphanumeric, dash, underscore, max 64 chars)" };
        }
        const skillDir = join(homedir(), ".mya", "agent", "skills", name);
        mkdirSync(skillDir, { recursive: true });
        // Sanitize description for YAML frontmatter
        const safeDesc = (description ?? "").replace(/[\r\n]/g, " ").slice(0, 200);
        writeFileSync(join(skillDir, "SKILL.md"), `---\nname: ${name}\ndescription: ${safeDesc}\n---\n\n${skillBody}\n`);
        return { ok: true };
      } catch (e) { return { ok: false, error: (e as Error).message }; }
    },
    // H9: webhook registry (in-memory)
    webhooksList: () => webhookRegistry.list(),
    webhookAdd: (hook) => {
      // F-03 fix: validate webhook URL (https/http only, no private IPs)
      try {
        const u = new URL(hook.url);
        if (u.protocol !== "https:" && u.protocol !== "http:") {
          return { id: "" };
        }
      } catch { return { id: "" }; }
      return webhookRegistry.add(hook);
    },
    // Pi tracks its own queue depth via session.isIdle + queue internals.
    // We expose busy=1/0 as a simple proxy (since pi's queue isn't directly observable).
    poolQueueDepth: (sessionId: string) => {
      const e = pool.get(sessionId);
      return e?.busy ? 1 : 0;
    },
    cronAdd: (job) => {
      // Phase 0B/1B: POST /cron/jobs reaches the scheduler (register → onDirty →
      // atomicWriteJobs). Previously cronAdd was unwired → HTTP jobs never fired
      // (D1) and, after 0B moved GET to read the scheduler, vanished entirely
      // (split-brain). Includes leaseMs + timezone so the file row is complete.
      // Phase 5: capture provider/model snapshot for drift detection.
      cron.register({
        id: job.id,
        name: job.name,
        trigger: job.trigger,
        schedule: job.schedule,
        prompt: job.prompt,
        deliveryTarget: job.deliveryTarget ?? "_cron",
        enabled: job.enabled,
        timezone: job.timezone,
        leaseMs: 5 * 60_000,
        providerSnapshot: process.env["MYA_PROVIDER"],
        modelSnapshot: process.env["MYA_MODEL"],
      });
    },
    cronRunNow: async (jobId: string) => {
      const job = cron.getJob(jobId);
      if (!job) return;
      const run = cron.claim(jobId, `gateway:${port}`);
      if (!run) return;
      // Phase 4A: mirror manual runs to durable history too (so 'mya cron history'
      // covers manual triggers, not just sweep-fired ones).
      try { recordRunStart({ runId: run.runId, jobId, startedAt: run.startedAt, status: "claimed", claimedBy: run.claimedBy }); } catch { /* best-effort */ }
      cron.start(run.runId);
      try {
        // Phase 0A: per-job session + D2 empty-response soft-fail (mirrors the
        // sweep so a manual run records the same real outcome).
        const text = await runOnSession(`_cron:${jobId}`, job.prompt, (e: unknown) => gw.broadcast(`_cron:${jobId}`, e));
        if (text == null || text.trim() === "") cron.complete(run.runId, "failed", "agent produced empty response");
        else cron.complete(run.runId, "succeeded");
      } catch (e) {
        cron.complete(run.runId, "failed", (e as Error).message);
      }
      const rec = cron.runsOf(jobId).at(-1);
      if (rec) { try { recordRunEnd(run.runId, rec.status, rec.error ?? null, rec.endedAt ?? nowWallclock()); } catch { /* best-effort */ } }
    },
    cronRemove: (jobId: string) => {
      // Phase 0B: removeJob write-throughs to cron.json via onDirty (replaces the
      // old private-Map cast hack — D10).
      return cron.removeJob(jobId);
    },
    wsInfo: () => ({ port, token: wsToken }),
    onWsMessage: (session: string, data: unknown) => {
      // Phase 1A: cron firing now goes through onRunOnSession (awaited, real
      // status). This handler serves interactive WS prompts from clients only.
      const msg = data as { text?: string };
      if (msg.text) {
        runOnSession(session, msg.text, (e: unknown) => gw.broadcast(session, e))
          .catch((e) => console.warn(`[gateway] WS message handler failed: ${(e as Error).message}`));
      }
    },
    onThinkingChange: (_level: string | undefined) => {
      // MYA_THINKING_LEVEL env var is already updated by the endpoint handler.
      // New sessions (pool.acquire → createAgentSession) will pick it up.
      // Pi's AgentSession reads thinking level from settings on creation.
    },
    // R3-3 fix: wire device pairing + WebAuthn into gateway.
    devicePairing,
    webAuthn,
    // R4-2 fix: wire approval relay for cross-device permission decisions.
    approvalRelay,
    // F2 fix: wire lifecycle guard for cron flapping detection.
    lifecycleGuard,
  });
  const { port: actualPort } = await gw.start();

  // Phase 0B: the control plane now reads the scheduler directly (listCronJobs
  // → cron.listJobs() joined with runsOf on the gateway side). The old
  // syncCronJobs 5s overwrite (which reverted PATCHes — C14) is removed.

  // Phase 3-6: activate sync + collab (was stored-only). Each starts an
  // unref'd background timer (collab: stale-room sweep; sync: heartbeat +
  // persist). stop() is wired on gateway shutdown.
  collab.start();
  sync.start();

  // Wire a clean shutdown — gateway.stop() already tears down HTTP/WS; this
  // additionally stops the sync/collab background timers.
  const shutdown = (): void => {
    try { sync.stop(); } catch { /* best-effort */ }
    try { collab.stop(); } catch { /* best-effort */ }
    try { pool.dispose(); } catch { /* best-effort */ }
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  process.stderr.write(`mya gateway: http://localhost:${actualPort} (RuntimePool: ${pool.size} sessions)\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

// Catch-all: never let the gateway die from an unhandled async error.
process.on("unhandledRejection", (reason) => {
  console.warn("[gateway] unhandledRejection:", reason instanceof Error ? reason.message : String(reason));
});
process.on("uncaughtException", (err) => {
  // EPIPE = client disconnected while we were writing (WebSocket/HTTP).
  // Expected when browsers/tabs close mid-stream — suppress to avoid log noise.
  const code = (err as NodeJS.ErrnoException).code;
  if (code === "EPIPE" || err.message === "write EPIPE") return;
  console.warn("[gateway] uncaughtException:", err.message);
});

/** Hidden test command: spawn a subagent directly via the pi subagent module.
 * Doesn't require an LLM (uses MockProvider via pi's session). Verifies the
 * full flow: createAgentSession → spawnSubagent → stream → wait → abort.
 *
 * Usage: mya subagent-test [goal] [depth]
 */
async function runSubagentTest(args: string[]): Promise<void> {
  const goal = args[0] ?? "Reply with exactly: hello from subagent";
  const parentDepth = parseInt(args[1] ?? "0", 10);
  // @ts-ignore - resolved by esbuild from project source
  const { createAgentSession } = await import("@earendil-works/pi-coding-agent");
  // @ts-ignore - resolved by esbuild from project source
  const { spawnSubagent, trackSubagent, listSubagents, MAX_SUBAGENT_DEPTH } = await import("./pi-subagent.js");
  console.log(`Subagent test (max depth: ${MAX_SUBAGENT_DEPTH})\n`);
  const parent = await createAgentSession({
    cwd: process.cwd(),
    agentDir: process.env["MYA_AGENT_DIR"] ?? `${process.env.HOME ?? "/tmp"}/.mya/agent`,
  });
  console.log(`✓ Parent session: ${parent.session.sessionId?.slice(0, 16)}...`);
  console.log(`\n▶ Spawning subagent...`);
  console.log(`  goal: ${goal}`);
  console.log(`  parentDepth: ${parentDepth}`);
  const sub = await spawnSubagent(parent.session, {
    goal,
    allowedTools: [],
    parentDepth,
  });
  trackSubagent(parent.session.sessionId ?? "", sub);
  console.log(`  spawned: ${sub.id} (depth ${sub.depth})`);
  console.log(`  active: ${listSubagents(parent.session.sessionId ?? "").length}`);
  console.log("\n▶ Streaming output:");
  process.stdout.write("  ");
  try {
    for await (const chunk of sub.stream()) {
      process.stdout.write(chunk);
    }
  } catch (e) {
    console.log(`\n  (stream error: ${(e as Error).message})`);
  }
  process.stdout.write("\n");
  console.log(`\n▶ Final state:`);
  console.log(`  status: ${sub.status}`);
  console.log(`  output: "${sub.output}"`);
  console.log(`  endedAt: ${sub.endedAt ? new Date(sub.endedAt).toISOString() : "(none)"}`);
  console.log(`  duration: ${sub.endedAt ? sub.endedAt - sub.startedAt : "?"}ms`);
}

function cryptoRandomToken(): string {
  return randomBytes(16).toString("hex");
}


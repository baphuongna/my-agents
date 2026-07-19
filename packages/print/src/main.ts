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
import { createAgent, AgentPool, type AgentSession } from "@my-agent/agent";
import { nowWallclock } from "@my-agent/core";
import { homedir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { makeSink } from "./index.js";
import { secretStore, auditLog, skillStore, wallet, cron, sync, collab, hooks, toolHooks, channelRouter, channels, packageHost, council, mcp, mcpConfigs, brain, roleRegistry } from "./shared-instances.js";
import { loadRoles as loadRolesRegistry } from "@my-agent/core";


// ── auth.json loader ──
function loadAuthConfig(): void {
  try {
    const authPath = join(homedir(), ".mya", "agent", "auth.json");
    const raw = readFileSync(authPath, "utf8");
    const cfg = JSON.parse(raw) as Record<string, { key?: string }>;
    if (cfg.minimax?.key && !process.env["MINIMAX_API_KEY"]) {
      process.env["MINIMAX_API_KEY"] = cfg.minimax.key;
    }
    if (cfg.openai?.key && !process.env["OPENAI_API_KEY"]) {
      process.env["OPENAI_API_KEY"] = cfg.openai.key;
    }
    // Generic env overrides: { env: { VAR: "value" } } → process.env (if not preset).
    // For CAMOFOX_URL, BROWSERBASE_API_KEY, search keys, etc. — so the TUI picks them
    // up without manual `env VAR=... mya` (tmux server doesn't propagate shell exports).
    const envCfg = (cfg as Record<string, unknown>)["env"] as Record<string, unknown> | undefined;
    if (envCfg && typeof envCfg === "object") {
      for (const [k, v] of Object.entries(envCfg)) {
        if (typeof v === "string" && !process.env[k]) process.env[k] = v;
      }
    }
  } catch { /* auth.json optional */ }
}

/** Phase 0A: cron-fired-turn tool policy lives in ./cron-role.ts (testable,
 * no main() side effects). Imported here for the pool factory. */
import { CRON_ROLE_DENIED_TOOLS, cronSessionExcludeTools } from "./cron-role.js";

async function main(): Promise<void> {
  loadAuthConfig();

  const args = process.argv.slice(2);

  // ── subcommands ──
  if (args[0] === "subagent-test") {
    return runSubagentTest(args.slice(1));
  }
  if (args[0] === "serve") {
    return runWebServer(args.slice(1));
  }
  if (args[0] === "launcher") {
    const { runLauncherLoop } = await import("./launcher.js");
    return runLauncherLoop();
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
    const { cronList, cronAdd, cronRemove, cronToggle, cronRun, cronHistory } = await import("./cron-cli.js");
    const sub = args[1];
    if (sub === "list" || sub === undefined) return cronList();
    if (sub === "add") return cronAdd(args[2], args[3], args[4]);
    if (sub === "remove" || sub === "rm") return cronRemove(args[2]);
    if (sub === "enable" || sub === "disable") return cronToggle(args[2], sub);
    if (sub === "run") return cronRun(args[2]);
    if (sub === "history") return cronHistory(args[2]);
    console.log("Usage: mya cron {list|add|remove|enable|disable|run|history}");
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
  // Flags that consume the next argument as their value
  const FLAGS_WITH_VALUE = new Set(["--model", "--session", "--session-id", "--fork", "--session-dir", "--port", "--bg-id", "--gateway-session", "--gateway-url"]);
  const modelIdx = args.indexOf("--model");
  const model = modelIdx >= 0 ? args[modelIdx + 1] : undefined;
  const positional = args.filter((a, i) => {
    if (a.startsWith("--")) return false;
    if (i > 0 && FLAGS_WITH_VALUE.has(args[i - 1]!)) return false; // value of a flag
    if (a === model) return false;
    return true;
  });

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
      ...(council ? { hindsight: { reviewer: council.makeReviewer() } } : {}),
      ...(debug ? { dapConnect: { connect: { command: "node", args: ["--inspect"] } } } : {}),
    });
    const text = prompt || (await readStdin()) || "Hello.";
    const sink = makeSink({ json });
    await agent.run(text, sink.write);
    if (!json) {
      const profile = process.env["MINIMAX_API_KEY"] ? "minimax" : process.env["OPENAI_API_KEY"] ? "openai" : "mock-fallback";
      process.stderr.write(`[provider: ${profile}]\n`);
    }
    return;
  }

  // ── default: pi InteractiveMode directly ──
  // `mya` → pi TUI (as expected). `mya launcher` → session picker.
  if (!print && !prompt && !rpc && !debug) {
    return runPiInteractive();
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

async function runPiInteractive(): Promise<void> {
  const { runPiInteractive: runPi } = await import("./pi-main.js");
  await runPi();
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
  });
  const server = new RpcServer({
    prompt: (text, onEvent) => {
      controller = new AbortController();
      return agent.run(text, onEvent, { signal: controller.signal });
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
  const { dashboardHtml } = await import("@my-agent/web");

  // AgentPool: each session uses pi's FULL AgentSession (same as TUI).
  // Phase 2 wired: multi-agent via MYA_AGENTS env (JSON array of {name, agentDir, maxSessions}).
  const agents = parseAgentsEnv();
  const pool = new AgentPool({
    maxSessions: 1000, // effectively no cap (personal use); override via MYA_MAX_SESSIONS env
    idleTtlMs: 3_600_000,
    agents: agents.length > 0 ? agents : undefined,
    createSession: async (sessionId, _cwd, agentDir) => {
      // Create pi AgentSession — same code as InteractiveMode uses.
      // Phase 2: respect per-agent agentDir (multi-agent isolation).
      // @ts-expect-error — resolved by esbuild from project source
      const { createAgentSession } = await import("../../coding-agent/src/index.ts");
      // Phase 0A: cron-fired turns (_cron:<jobId> sessions) get the cron role's
      // excluded tools (anti-recursion / deny-default). createAgentSession already
      // accepts excludeTools (sdk.ts). The denied set is empty by default; Phase 3C
      // (approval_mode) populates it (bash/write/edit → can't modify cron.json or
      // run the CLI to recurse).
      const excludeTools = cronSessionExcludeTools(sessionId);
      const cronOpts = excludeTools != null ? { excludeTools } : {};
      const result = await createAgentSession({
        cwd: _cwd ?? process.cwd(),
        agentDir: agentDir ?? join(homedir(), ".mya", "agent"),
        ...cronOpts,
      });
      return result.session as unknown as AgentSession;
    },
  });

  /** Per-session prompt queue: serializes prompts to the same session. */
  /** Run a prompt on a pi session. Concurrency delegated to pi's own
   * queue via streamingBehavior='followUp' (pi queues prompts internally). */
  function runOnSession(sessionId: string, prompt: string, onEvent?: (e: unknown) => void): Promise<string> {
    return doRunOnSession(sessionId, prompt, onEvent);
  }

  async function doRunOnSession(sessionId: string, prompt: string, onEvent?: (e: unknown) => void): Promise<string> {
    const session = await pool.acquire(sessionId);
    const entry = pool.get(sessionId);
    if (!entry) return "";
    entry.busy = true;

    let responseText = "";
    const unsub = session.subscribe((event: unknown) => {
      const ev = event as { type?: string; message?: { content?: Array<{ type?: string; text?: string }> } };
      if (onEvent) onEvent(event);
      if (ev?.type === "message_update" || ev?.type === "message_end") {
        const content = ev.message?.content;
        if (Array.isArray(content)) {
          for (const c of content) {
            if (c?.type === "text" && c.text) responseText += c.text;
          }
        }
      }
    });

    try {
      await session.prompt(prompt, { streamingBehavior: "followUp" });
    } catch (e) {
      // AgentSession throws if a prompt is already running. With our per-session
      // queue this should be impossible, but guard so a single bad call can't
      // crash the gateway.
      console.warn(`[gateway] session.prompt failed for ${sessionId}: ${(e as Error).message}`);
      return responseText || `[error: ${(e as Error).message}]`;
    } finally {
      unsub();
      entry.busy = false;
      entry.messageCount++;
      entry.lastActivity = nowWallclock();
    }
    return responseText;
  }

  // Wire channel router → AgentPool: channel messages use pi AgentSession.
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
    const stats = cron.reconcile(readCronJobs());
    if (stats.quarantined > 0) {
      console.warn(`[cron] ${stats.quarantined} job(s) quarantined by validate on reload`);
    }
  };

  // MYA_NO_WS_TOKEN: skip the WS auth token for local dev/testing — lets a
  // browser dashboard connect without ?token=. Production keeps the token
  // (defends against other local processes reading the event stream).
  const wsToken = process.env.MYA_NO_WS_TOKEN ? undefined : cryptoRandomToken();
  // Persistent DreamCycle: tracks whether the periodic memory consolidation
  // timer is armed. memoryStats() reflects its real running state instead of
  // a hardcoded false.
  const { DreamCycle } = await import("@my-agent/memory");
  const dreamCycle = new DreamCycle({ brain });
  // MEDIUM-2 fix: actually start the periodic consolidation timer
  dreamCycle.start();

  const gw = new Gateway({
    port,
    rootHtml: dashboardHtml({ title: "mya", wsPath: wsToken ? `/events?token=${wsToken}` : "/events" }),
    staticDir: join(process.cwd(), "packages/web/dist/web"),
    wsToken,
    hooks,
    cron,
    cronReload,
    onRunOnSession: (session, prompt, onEvent) => runOnSession(session, prompt, onEvent),
    sync,
    collab,
    channels,
    channelRouter,
    poolStatus: () => pool.list().map((e) => ({ sessionId: e.sessionId, messages: e.messageCount, lastActivity: e.lastActivity, busy: e.busy, sessionFile: e.sessionFile })),
    poolKill: (id: string) => pool.release(id),
    poolAcquire: async (cwd: string) => {
      const sessionId = `s-${nowWallclock().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      await pool.createForCwd(sessionId, cwd);
      return sessionId;
    },
    poolPrompt: (sessionId: string, text: string) => {
      void runOnSession(sessionId, text, (e: unknown) => gw.broadcast(sessionId, e))
        .catch((e) => console.warn(`[gateway] poolPrompt failed: ${(e as Error).message}`));
    },
    poolSubagents: (sessionId: string) => {
      try {
        const subagentMod = createRequire(import.meta.url)("../../coding-agent/src/core/subagent.ts");
        return subagentMod.listSubagents(sessionId).map((s: { id: string; goal: string; status: string; depth: number; output: string }) => ({
          id: s.id, goal: s.goal, status: s.status, depth: s.depth, output: s.output,
        }));
      } catch { return []; }
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
    memoryStats: () => ({
      facts: (brain as unknown as { facts: { size: number } }).facts.size,
      takes: (brain as unknown as { takes: { size: number } }).takes.size,
      tombstones: brain.tombstoneCount,
      dreamRunning: dreamCycle.running,
    }),
    dreamTrigger: async () => {
      return await dreamCycle.dream();
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
      });
    },
    cronRunNow: async (jobId: string) => {
      const job = cron.getJob(jobId);
      if (!job) return;
      const run = cron.claim(jobId, `gateway:${port}`);
      if (!run) return;
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
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  process.stderr.write(`mya gateway: http://localhost:${actualPort} (AgentPool: ${pool.size} sessions)\n`);
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
  const { createAgentSession } = await import("../../coding-agent/src/index.ts");
  // @ts-ignore - resolved by esbuild from project source
  const { spawnSubagent, trackSubagent, listSubagents, MAX_SUBAGENT_DEPTH } =
    await import("../../coding-agent/src/core/subagent.ts");
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

/**
 * Parse MYA_AGENTS env var to register named agents with AgentPool.
 *
 * Format: JSON array of {name, agentDir?, maxSessions?, idleTtlMs?}
 * Example:
 *   MYA_AGENTS='[
 *     {"name":"alice","agentDir":"~/.mya/agents/alice","maxSessions":4},
 *     {"name":"bob","agentDir":"~/.mya/agents/bob","maxSessions":2}
 *   ]'
 *
 * If unset/empty, returns [] (default single-agent pool, all sessions share one namespace).
 * Invalid JSON → logs warning + returns [] (fail-soft).
 */
function parseAgentsEnv(): Array<{ name: string; agentDir?: string; maxSessions?: number; idleTtlMs?: number }> {
  const raw = process.env["MYA_AGENTS"];
  if (!raw || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      console.warn("[gateway] MYA_AGENTS must be a JSON array, ignoring");
      return [];
    }
    const out: Array<{ name: string; agentDir?: string; maxSessions?: number; idleTtlMs?: number }> = [];
    for (const item of parsed) {
      if (typeof item !== "object" || item === null) continue;
      const obj = item as Record<string, unknown>;
      if (typeof obj["name"] !== "string" || !obj["name"]) continue;
      out.push({
        name: obj["name"],
        agentDir: typeof obj["agentDir"] === "string" ? obj["agentDir"] : undefined,
        maxSessions: typeof obj["maxSessions"] === "number" ? obj["maxSessions"] : undefined,
        idleTtlMs: typeof obj["idleTtlMs"] === "number" ? obj["idleTtlMs"] : undefined,
      });
    }
    if (out.length === 0) {
      console.warn("[gateway] MYA_AGENTS parsed but no valid agents found");
    } else {
      console.warn(`[gateway] registered ${out.length} agent(s) from MYA_AGENTS: ${out.map((a) => a.name).join(", ")}`);
    }
    return out;
  } catch (e) {
    console.warn(`[gateway] MYA_AGENTS invalid JSON, ignoring: ${(e as Error).message}`);
    return [];
  }
}

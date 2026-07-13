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
import { createAgent, AgentPool, PiSessionPool, type PiAgentSession } from "@my-agent/agent";
import { nowWallclock } from "@my-agent/core";
import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { makeSink } from "./index.js";
import { secretStore, auditLog, skillStore, wallet, cron, sync, collab, hooks, channelRouter, channels } from "./shared-instances.js";

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
  } catch { /* auth.json optional */ }
}

async function main(): Promise<void> {
  loadAuthConfig();

  const args = process.argv.slice(2);

  // ── subcommands ──
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
      memoryDir: join(homedir(), ".my-agent", "memory"),
      auditLog,
      secretStore,
      skillStore,
      wallet,
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
    memoryDir: join(homedir(), ".my-agent", "memory"),
    auditLog,
    secretStore,
    skillStore,
    wallet,
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

  // PiSessionPool: each session uses pi's FULL AgentSession (same as TUI).
  // Background sessions have the same providers, tools, and features as interactive TUI.
  const pool = new PiSessionPool({
    maxSessions: 8,
    idleTtlMs: 3_600_000,
    createSession: async (sessionId) => {
      // Create pi AgentSession — same code as InteractiveMode uses.
      // @ts-expect-error — resolved by esbuild from project source
      const { createAgentSession } = await import("@my-agent/coding-agent");
      const result = await createAgentSession({
        cwd: process.cwd(),
        agentDir: join(homedir(), ".mya", "agent"),
      });
      return result.session as unknown as PiAgentSession;
    },
  });

  /** Run a prompt on a pi session, collect streaming text for response. */
  async function runOnSession(sessionId: string, prompt: string, onEvent?: (e: unknown) => void): Promise<string> {
    const session = await pool.acquire(sessionId);
    const entry = pool.get(sessionId);
    if (entry) entry.busy = true;

    let responseText = "";
    const unsub = session.subscribe((event: unknown) => {
      const ev = event as { type?: string; message?: { content?: Array<{ type?: string; text?: string }> } };
      // Forward to caller (WS broadcast)
      if (onEvent) onEvent(event);
      // Collect assistant text for channel response
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
      await session.prompt(prompt);
    } finally {
      unsub();
      if (entry) { entry.busy = false; entry.messageCount++; entry.lastActivity = nowWallclock(); }
    }
    return responseText;
  }

  // Wire channel router → PiSessionPool: channel messages use pi AgentSession.
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

  // Sync cron jobs from scheduler to control plane. Called after `gw` is created.
  function syncCronJobs() {
    for (const job of cron.listJobs()) {
      gw.control.registerCronJob({
        id: job.id,
        name: job.name,
        trigger: job.trigger,
        schedule: String(job.schedule),
        prompt: job.prompt,
        deliveryTarget: job.deliveryTarget,
        enabled: job.enabled,
      });
    }
  }

  // Load cron jobs from ~/.mya/agent/cron.json (if exists)
  try {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const os = await import("node:os");
    const cronFile = path.join(os.homedir(), ".mya", "agent", "cron.json");
    if (fs.existsSync(cronFile)) {
      const data = JSON.parse(fs.readFileSync(cronFile, "utf-8")) as Array<{ id: string; name: string; schedule: string | number; prompt: string; enabled?: boolean; deliveryTarget?: string; trigger?: "cron" | "on-interval" | "once"; timezone?: string }>;
      for (const j of data) {
        cron.register({
          id: j.id,
          name: j.name,
          trigger: j.trigger ?? "cron",
          schedule: j.schedule,
          prompt: j.prompt,
          enabled: j.enabled ?? true,
          deliveryTarget: j.deliveryTarget ?? "_cron",
          leaseMs: 5 * 60_000,
        });
      }
    }
  } catch { /* ignore */ }

  const wsToken = cryptoRandomToken();
  const gw = new Gateway({
    port,
    rootHtml: dashboardHtml({ title: "mya", wsPath: `/events?token=${wsToken}` }),
    wsToken,
    hooks,
    cron,
    sync,
    collab,
    channels,
    channelRouter,
    poolStatus: () => pool.list().map((e) => ({ sessionId: e.sessionId, messages: e.messageCount, lastActivity: e.lastActivity, busy: e.busy, sessionFile: e.sessionFile })),
    poolKill: (id: string) => pool.release(id),
    poolAcquire: async (cwd: string) => {
      const sessionId = `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      await pool.createForCwd(sessionId, cwd);
      return sessionId;
    },
    cronRunNow: async (jobId: string) => {
      const job = cron.getJob(jobId);
      if (!job) return;
      const run = cron.claim(jobId, `gateway:${port}`);
      if (!run) return;
      cron.start(run.runId);
      try {
        await runOnSession("_cron", job.prompt, (e: unknown) => gw.broadcast("_cron", e));
        cron.complete(run.runId, "succeeded");
      } catch (e) {
        cron.complete(run.runId, "failed", (e as Error).message);
      }
    },
    wsInfo: () => ({ port, token: wsToken }),
    onWsMessage: (session: string, data: unknown) => {
      const msg = data as { text?: string; kind?: string; prompt?: string };
      const prompt = msg.kind === "cron-fire" ? msg.prompt : msg.text;
      if (prompt) {
        // Route to pi AgentSession (same as TUI).
        void runOnSession(session, prompt, (e: unknown) => gw.broadcast(session, e));
      }
    },
  });
  const { port: actualPort } = await gw.start();

  // Now gw is created — sync cron jobs to control plane + start periodic sync.
  syncCronJobs();
  setInterval(syncCronJobs, 5000).unref?.();

  process.stderr.write(`mya gateway: http://localhost:${actualPort} (AgentPool: ${pool.size} sessions)\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

function cryptoRandomToken(): string {
  return randomBytes(16).toString("hex");
}

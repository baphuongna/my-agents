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
import { createAgent, AgentPool } from "@my-agent/agent";
import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { makeSink } from "./index.js";
import { secretStore, auditLog, skillStore, wallet, cron, sync, collab, hooks } from "./shared-instances.js";

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
  const modelIdx = args.indexOf("--model");
  const model = modelIdx >= 0 ? args[modelIdx + 1] : undefined;
  const positional = args.filter((a) => !a.startsWith("--") && a !== model);

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

  // ── launcher (default when no prompt/flags) ──
  if (!skipLauncher && !print && !prompt && !rpc && !debug) {
    const { runLauncherLoop } = await import("./launcher.js");
    return runLauncherLoop();
  }

  // ── interactive TUI (when launcher skipped) ──
  if (!print && !prompt && !rpc) {
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

  // AgentPool: each WS session gets its own agent (own history, own turnLock).
  // Sessions persist in the pool even when WS clients disconnect.
  const pool = new AgentPool({
    maxAgents: 16,
    idleTtlMs: 3_600_000,
    createConfig: () => ({
      memoryDir: join(homedir(), ".my-agent", "memory"),
      auditLog,
      secretStore,
      skillStore,
      wallet,
    }),
  });

  const wsToken = cryptoRandomToken();
  const gw = new Gateway({
    port,
    rootHtml: dashboardHtml({ title: "mya", wsPath: `/events?token=${wsToken}` }),
    wsToken,
    hooks,
    cron,
    sync,
    collab,
    poolStatus: () => pool.list().map((e) => ({ sessionId: e.sessionId, messages: e.messageCount, lastActivity: e.lastActivity, busy: e.busy })),
    onWsMessage: (session: string, data: unknown) => {
      const msg = data as { text?: string; kind?: string; prompt?: string };
      const prompt = msg.kind === "cron-fire" ? msg.prompt : msg.text;
      if (prompt) {
        // Route to this session's own agent (from pool).
        const agent = pool.acquire(session);
        const entry = pool.get(session);
        if (entry) entry.busy = true;
        void agent.run(prompt, (e: unknown) => {
          gw.broadcast(session, e);
        }).finally(() => {
          if (entry) { entry.busy = false; entry.messageCount++; entry.lastActivity = Date.now(); }
        });
      }
    },
  });
  const { port: actualPort } = await gw.start();
  process.stderr.write(`mya gateway: http://localhost:${actualPort} (AgentPool: ${pool.size} sessions)\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

function cryptoRandomToken(): string {
  return randomBytes(16).toString("hex");
}

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
import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { makeSink } from "./index.js";
import { secretStore, auditLog, hooks, skillStore } from "./pi-main.js";

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

  // ── interactive TUI — 100% pi InteractiveMode ──
  return runPiInteractive();
}

// ── shared instances (re-exported from pi-main.ts so TUI + print share) ──
// These are created in pi-main.ts and re-exported for consistency.
import { secretStore, auditLog, hooks, skillStore } from "./pi-main.js";

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
  const { CronScheduler } = await import("@my-agent/cron");
  const { SyncServer } = await import("@my-agent/sync");
  const { CollabRelay } = await import("@my-agent/collab");
  const agent = createAgent({
    memoryDir: join(homedir(), ".my-agent", "memory"),
    auditLog,
    secretStore,
    skillStore,
  });
  const wsToken = cryptoRandomToken();
  const cron = new CronScheduler();
  const sync = new SyncServer();
  const collab = new CollabRelay();
  const gw = new Gateway({
    port,
    rootHtml: dashboardHtml({ title: "mya", wsPath: `/events?token=${wsToken}` }),
    wsToken,
    hooks,
    cron,
    sync,
    collab,
    onWsMessage: (session: string, data: unknown) => {
      const msg = data as { text?: string; kind?: string; prompt?: string };
      if (msg.kind === "cron-fire" && msg.prompt) {
        void agent.run(msg.prompt, (e: unknown) => gw.broadcast(session, e));
      } else if (msg.text) {
        void agent.run(msg.text, (e: unknown) => gw.broadcast(session, e));
      }
    },
  });
  const { port: actualPort } = await gw.start();
  process.stderr.write(`mya web dashboard: http://localhost:${actualPort}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

function cryptoRandomToken(): string {
  return randomBytes(16).toString("hex");
}

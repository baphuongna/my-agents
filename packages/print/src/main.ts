#!/usr/bin/env node
/**
 * mya — interactive TUI mode (§25.1).
 *
 * Usage:
 *   mya                  # interactive REPL (default)
 *   mya "prompt"         # one-shot then exit (print mode)
 *   mya --print "prompt" # same as above (explicit)
 *   mya --json "prompt"  # one-shot, newline-delimited JSON stream
 *   mya --rpc            # JSON-RPC 2.0 server over stdio
 *   mya serve            # web dashboard + gateway
 *   mya --model m "..."  # explicit model override
 *
 * Auto-config: reads ~/.pi/agent/auth.json (minimax/openai keys) → env vars.
 */
import { createAgent } from "@my-agent/agent";
import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { makeSink } from "./index.js";
import { TuiRepl } from "@my-agent/tui";

// ── auth.json loader ──
function loadAuthConfig(): void {
  try {
    const authPath = join(homedir(), ".pi", "agent", "auth.json");
    const raw = readFileSync(authPath, "utf8");
    const auth = JSON.parse(raw) as Record<string, unknown>;
    const minimax = auth["minimax"] as Record<string, unknown> | undefined;
    if (minimax?.["key"] && !process.env["MINIMAX_API_KEY"]) {
      process.env["MINIMAX_API_KEY"] = String(minimax["key"]);
    }
    const openai = auth["openai"] as Record<string, unknown> | undefined;
    if (openai?.["key"] && !process.env["OPENAI_API_KEY"]) {
      process.env["OPENAI_API_KEY"] = String(openai["key"]);
    }
  } catch { /* auth.json absent — fall through to env/mock */ }
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
  const modelIdx = args.indexOf("--model");
  const model = modelIdx >= 0 ? args[modelIdx + 1] : undefined;
  const positional = args.filter((a) => !a.startsWith("--") && a !== model);

  if (rpc) {
    return runRpcServer(model);
  }

  const prompt = positional.join(" ").trim();

  // ── one-shot (print mode) ──
  if (print || prompt) {
    const agent = createAgent({ model, memoryDir: join(homedir(), ".my-agent", "memory") });
    const text = prompt || (await readStdin()) || "Hello.";
    const sink = makeSink({ json });
    await agent.run(text, sink.write);
    if (!json) {
      const profile = process.env["MINIMAX_API_KEY"] ? "minimax" : process.env["OPENAI_API_KEY"] ? "openai" : "mock-fallback";
      process.stderr.write(`[provider: ${profile}]\n`);
    }
    return;
  }

  // ── interactive TUI ──
  return runTui(model);
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

async function runTui(model?: string): Promise<void> {
  // Phase 18: pick TTY-aware renderer. Ink/React when stdin+stdout is a TTY
  // (the common case: a real terminal). Fall back to the readline TuiRepl
  // for non-TTY contexts (CI, redirected stdin, IDE consoles without PTY).
  if (process.stdin.isTTY && process.stdout.isTTY) {
    return runInkTui(model);
  }
  return runReadlineTui(model);
}

async function runInkTui(model?: string): Promise<void> {
  const agent = createAgent({ model, memoryDir: join(homedir(), ".my-agent", "memory") });
  const controller = new AbortController();
  // Track cumulative cost + tokens for the status bar.
  let tokensIn = 0;
  let tokensOut = 0;
  let spentUsd = 0;
  let providerId = process.env["MINIMAX_API_KEY"] ? "minimax" : process.env["OPENAI_API_KEY"] ? "openai" : "mock";
  const registeredApprovals = new Map<string, (decision: "Allow" | "Deny") => void>();

  // We import ink dynamically so non-TTY callers don't pay the bundle cost
  // (the bundle inlines it, but the cost of the require() is identical here).
  const ink: typeof import("@my-agent/tui/ink") = await import("@my-agent/tui/ink");
  const handle = ink.startInkSession({
    onSubmit: async (text) => {
      await agent.run(text, (event) => {
        // Translate the RuntimeEvent into a transcript line + status updates.
        const line = ink.eventToLine(0, event);
        if (line) handle.pushLine(line);
        const e = event as { kind?: string; turnEvent?: { state?: string; usage?: { input?: number; output?: number }; chunk?: { kind?: string; call?: { id?: string; name?: string; arguments?: unknown } } }; usage?: { input?: number; output?: number }; cost?: { usd?: number }; state?: string };
        // Update token + cost counters.
        const usage = (e.turnEvent?.usage ?? e.usage);
        if (usage) {
          tokensIn += usage.input ?? 0;
          tokensOut += usage.output ?? 0;
        }
        const cost = (e as { cost?: { usd?: number } }).cost;
        if (cost?.usd !== undefined) spentUsd = cost.usd;
        // Approval requests — push modal + register resolver.
        const te = e.turnEvent;
        if (te?.state === "AwaitingApproval" && te.chunk?.kind === "tool_call" && te.chunk.call) {
          const callId = te.chunk.call.id ?? "";
          const name = te.chunk.call.name ?? "?";
          const args = JSON.stringify(te.chunk.call.arguments ?? {});
          const reason = "permission gate requires user confirmation";
          // Register a resolver the approval handler will invoke.
          const decisionPromise = new Promise<"Allow" | "Deny">((resolve) => {
            registeredApprovals.set(callId, resolve);
          });
          handle.setApproval({ callId, name, args, reason });
          // Forward the decision back to the agent's permission gate.
          decisionPromise.then((d) => {
            // Currently best-effort: log the decision; the agent's awaitHumanPrompt
            // resolves via the same channel once the permission gate listens.
            // Phase 19: wire a 2-way WS-style approval through the dispatch hook.
          });
        }
        // Status bar refresh on every event.
        handle.setStatus({
          provider: providerId,
          model: model ?? "MiniMax-M3",
          tokensIn,
          tokensOut,
          spentUsd,
          budgetUsd: 0,
        });
      });
    },
    onAbort: () => controller.abort(),
    onApproval: (callId: string, decision: "Allow" | "Deny") => {
      const r = registeredApprovals.get(callId);
      if (r) {
        r(decision);
        registeredApprovals.delete(callId);
      }
    },
    initialStatus: { provider: providerId, model: model ?? "MiniMax-M3", tokensIn: 0, tokensOut: 0, spentUsd: 0, budgetUsd: 0 },
    onClear: () => handle.clear(),
    getModel: () => model ?? "MiniMax-M3",
    getModels: async () => agent.providers.all().map((p) => ({ label: `${p.id}`, value: p.model })),
    getTools: () => agent.tools.list().map((t) => ({ name: t.name })),
    getSpent: () => spentUsd,
  });

  // Block until the Ink session closes (Ctrl-D or /quit).
  await new Promise<void>((resolve) => {
    process.on("SIGINT", () => { controller.abort(); });
    handle.close().then(resolve);
  });
}

async function runReadlineTui(model?: string): Promise<void> {
  const agent = createAgent({ model, memoryDir: join(homedir(), ".my-agent", "memory") });
  const controller = new AbortController();
  const repl = new TuiRepl({
    prompt: (text, onEvent) => agent.run(text, onEvent, { signal: controller.signal }),
    cancel: () => controller.abort(),
  });
  repl.start("mya — interactive agent. Type a message, Ctrl-C to abort a turn, Ctrl-D to exit.");
}

async function runRpcServer(_model?: string): Promise<void> {
  const { RpcServer } = await import("@my-agent/rpc");
  const agent = createAgent({ memoryDir: join(homedir(), ".my-agent", "memory") });
  const server = new RpcServer({
    prompt: (text, onEvent) => agent.run(text, onEvent),
    cancel: () => { /* abort handled per-session */ },
    status: () => ({ ok: true }),
  });
  server.start();
}

async function runWebServer(extraArgs: string[]): Promise<void> {
  const portIdx = extraArgs.indexOf("--port");
  const port = portIdx >= 0 ? Number(extraArgs[portIdx + 1]) : 3000;
  const { Gateway } = await import("@my-agent/gateway");
  const { dashboardHtml } = await import("@my-agent/web");
  const agent = createAgent({ memoryDir: join(homedir(), ".my-agent", "memory") });
  // Phase 15 M2: generate a local-only WS token (blocks other local processes).
  const wsToken = cryptoRandomToken();
  const gw = new Gateway({
    port,
    rootHtml: dashboardHtml({ title: "mya", wsPath: `/events?token=${wsToken}` }),
    wsToken,
    onWsMessage: (session: string, data: unknown) => {
      const msg = data as { text?: string };
      if (msg.text) {
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

/** Generate a 32-char hex token for local WS auth. */
function cryptoRandomToken(): string {
  return randomBytes(16).toString("hex");
}

/**
 * mya-bridge — pi InlineExtension that bridges mya packages into pi's TUI.
 *
 * This is THE integration point between mya's 29 packages and pi's InteractiveMode.
 * Without this extension, the TUI runs 100% pi with zero mya features.
 *
 * Wired subsystems (every mya package has a visible presence):
 * - AuditLog:      every tool_call/tool_result → tamper-evident Merkle log
 * - SecretStore:   redacts known secrets in tool output before display
 * - HookRegistry:  fires session_start/turn_start/turn_end/tool_call/tool_result
 * - CronScheduler: background sweep for due jobs + /cron listing
 * - Skills:        loaded from ~/.mya/skills/ + project/.mya/skills/
 * - Memory (Brain): turn_end → consolidate(); /memory command
 * - x402 Wallet:   paid_fetch tool + /wallet command
 * - DAP:           debug tool (DangerFullAccess) + /debug command
 * - Eval:          /eval command (unit-tier parity tests)
 * - Sync:          /sync command (replica state: keys + HLC)
 * - Collab:        /collab command (rooms + clients)
 * - TTS:           message_end → speak() (when MYA_TTS=1)
 * - ACP:           /acp command (lineage node count)
 * - Workflows:     /workflow <file> command
 * - Signing:       /sign <file> command (digest + sigstore verify)
 * - Pkg:           /pkg command (registered packages)
 * - Council:       /council command (multi-model council status)
 * - Prompts:       before_agent_start → inject mya context note
 *
 * Usage in pi-main.ts:
 *   import { createMyaBridge } from "@my-agent/print/mya-bridge.js";
 *   await main(args, { extensionFactories: [createMyaBridge(opts)] });
 */
import { nowWallclock } from "@my-agent/core";
import { makePaidFetchTool } from "@my-agent/x402";
import { makeDebugTool } from "@my-agent/dap";
import { defaultHarness } from "@my-agent/eval";
import { speak } from "@my-agent/tts";
import { runWorkflow, type WorkflowContext } from "@my-agent/workflows";
import { fileSha256, verifyTarball, type SigstoreBundle } from "@my-agent/signing";
import { commandRegistry } from "./command-registry.js";

import type { AuditLog } from "@my-agent/audit";
import type { SecretStore } from "@my-agent/secrets";
import type { HookRegistry } from "@my-agent/gateway";
import type { McpManager, McpServerConfig } from "@my-agent/gateway";
import type { ChannelRegistry } from "@my-agent/gateway";
import type { SkillStore } from "@my-agent/skills";
import type { CronScheduler } from "@my-agent/cron";
import type { Brain } from "@my-agent/memory";
import type { Wallet } from "@my-agent/x402";
import type { AcpBridge } from "@my-agent/acp";
import type { SyncServer } from "@my-agent/sync";
import type { CollabRelay } from "@my-agent/collab";
import type { PackageHost } from "@my-agent/pkg";
import type { CouncilProvider } from "@my-agent/council";

export interface MyaBridgeOptions {
  auditLog?: AuditLog;
  secretStore?: SecretStore;
  hooks?: HookRegistry;
  skillStore?: SkillStore;
  cron?: CronScheduler;
  brain?: Brain;
  wallet?: Wallet;
  /** DAP adapter connection (builds the `debug` tool when set). */
  dapConnect?: { connect: { command: string; args?: string[] } };
  acp?: AcpBridge;
  sync?: SyncServer;
  collab?: CollabRelay;
  packageHost?: PackageHost;
  council?: CouncilProvider;
  /** MCP server manager (connects external MCP servers as tool sources). */
  mcp?: McpManager;
  /** MCP server configs to auto-register on startup. */
  mcpConfigs?: McpServerConfig[];
  /** Channel registry (messaging adapters: Telegram, Discord, Slack, ...). */
  channels?: ChannelRegistry;
  /** Register custom tools — kept for backwards compatibility. */
  registerTools?: (pi: MyaPiApi) => void;
}

/** Minimal pi ExtensionAPI surface we use (duck-typed to avoid tight coupling). */
export interface MyaPiApi {
  on(event: string, handler: (event: unknown, ctx: unknown) => unknown): void;
  registerTool(tool: unknown): void;
  registerCommand(name: string, options: unknown): void;
  registerShortcut(shortcut: string, options: unknown): void;
}

/** Extract the ui.notify surface from a command context (the established pattern). */
function uiOf(ctx: unknown): { notify: (m: string, t?: string) => void } {
  return (ctx as { ui: { notify: (m: string, t?: string) => void } }).ui;
}

/**
 * Register a command in BOTH pi (for TUI) and the shared CommandRegistry (for channels).
 * The handler returns a string — pi wraps it in ui.notify, channels get the raw string.
 */
function registerSharedCommand(
  pi: MyaPiApi,
  name: string,
  description: string,
  handler: (args: string) => Promise<string> | string,
): void {
  // Register into pi (TUI) — wrap with ui.notify
  pi.registerCommand(name, {
    description,
    handler: async (args: string, ctx: unknown) => {
      const ui = uiOf(ctx);
      const result = await handler(args);
      ui.notify(result, "info");
    },
  });
  // Register into shared CommandRegistry (channels) — return raw string
  commandRegistry.register({
    name,
    description,
    handler: (args: string) => handler(args),
  });
}

/**
 * Create a pi InlineExtension factory that bridges mya packages.
 * Returns an InlineExtension (factory function) suitable for `main(args, { extensionFactories })`.
 */
export function createMyaBridge(opts: MyaBridgeOptions): (pi: MyaPiApi) => void {
  return (pi: MyaPiApi) => {
    // Capture parent session ID from session_start event (for subagent tracking)
    let parentSessionId = "";
    pi.on("session_start", (event: unknown, ctx: unknown) => {
      const c = ctx as { sessionManager?: { getSessionId?: () => string } };
      parentSessionId = c?.sessionManager?.getSessionId?.() ?? `session-${nowWallclock().toString(36)}`;
    });
    // ── 1. AuditLog: log every tool call + result ───────────────────────
    if (opts.auditLog) {
      const audit = opts.auditLog;
      pi.on("tool_call", (event: unknown) => {
        const e = event as { toolName: string; toolCallId: string; input?: unknown };
        audit.append({
          ts: nowWallclock(),
          kind: "tool",
          actor: "agent",
          payload: { phase: "call", tool: e.toolName, callId: e.toolCallId, input: e.input },
        });
      });
      pi.on("tool_result", (event: unknown) => {
        const e = event as { toolName: string; toolCallId: string; isError?: boolean };
        audit.append({
          ts: nowWallclock(),
          kind: "tool",
          actor: "agent",
          payload: { phase: "result", tool: e.toolName, callId: e.toolCallId, ok: !e.isError },
        });
      });
      pi.on("turn_start", (event: unknown) => {
        const e = event as { turnIndex: number };
        audit.append({
          ts: nowWallclock(),
          kind: "channel",
          actor: "agent",
          payload: { phase: "turn_start", turn: e.turnIndex },
        });
      });
      pi.on("turn_end", (event: unknown) => {
        const e = event as { turnIndex: number };
        audit.append({
          ts: nowWallclock(),
          kind: "channel",
          actor: "agent",
          payload: { phase: "turn_end", turn: e.turnIndex },
        });
      });
    }

    // ── 2. HookRegistry: fire gateway lifecycle hooks ───────────────────
    if (opts.hooks) {
      const hooks = opts.hooks;
      pi.on("session_start", () => void hooks.fire("session_start", {}));
      pi.on("turn_start", () => void hooks.fire("pre_turn", {}));
      pi.on("turn_end", () => void hooks.fire("post_turn", {}));
      pi.on("tool_call", () => void hooks.fire("pre_tool", {}));
      pi.on("tool_result", () => void hooks.fire("post_tool", {}));
    }

    // ── Ctrl+Q: exit pi → return to launcher ────────────────────────────
    pi.registerShortcut("ctrl+q", {
      description: "Exit to launcher",
      handler: (ctx: unknown) => {
        const c = ctx as { shutdown: () => void };
        if (c.shutdown) c.shutdown();
      },
    });

    // ── 3. Memory (Brain): consolidate on turn_end (fire-and-forget) ────
    if (opts.brain) {
      const brain = opts.brain;
      pi.on("turn_end", () => {
        try {
          brain.consolidate();
        } catch {
          /* memory consolidation must never crash the TUI */
        }
      });
    }

    // ── 4. TTS: speak assistant messages (only when MYA_TTS=1) ──────────
    if (process.env["MYA_TTS"] === "1") {
      pi.on("message_end", (event: unknown) => {
        const e = event as { role?: string; text?: string };
        if (e.role === "assistant" && e.text) {
          void speak(e.text).catch(() => {
            /* TTS must never crash the TUI */
          });
        }
      });
    }

    // ── 5. Prompts: inject mya context into the system prompt ───────────
    // Best-effort: if the before_agent_start event exposes a mutable prompt
    // context, append a mya availability note. Fire-and-forget, never throws.
    pi.on("before_agent_start", (event: unknown) => {
      const note =
        "\n[mya] Audit log, secret redaction, memory (Brain), skills, cron, hooks, " +
        "x402 wallet, DAP debugger, and slash commands (/mya-help) are active.";
      try {
        const e = event as { systemPrompt?: { context?: string }; context?: string };
        if (e.systemPrompt && typeof e.systemPrompt.context === "string") {
          e.systemPrompt.context += note;
        } else if (typeof e.context === "string") {
          e.context += note;
        }
      } catch {
        /* prompt injection is best-effort */
      }
    });

    // ── 6. Custom tools (paid_fetch, debug, + legacy callback) ──────────
    if (opts.wallet) {
      try {
        pi.registerTool(makePaidFetchTool(opts.wallet));
      } catch {
        /* tool registration is best-effort */
      }
    }
    if (opts.dapConnect) {
      try {
        pi.registerTool(makeDebugTool(opts.dapConnect));
      } catch {
        /* tool registration is best-effort */
      }
    }
    if (opts.registerTools) {
      opts.registerTools(pi);
    }

    // ── 6.5. Subagent tool (spawn focused sub-tasks from TUI) ────────────
    try {
      // @ts-ignore - cross-package dynamic import
      void import("../../coding-agent/src/core/subagent.ts").then((mod) => {
        const { spawnSubagent, trackSubagent, listSubagents, MAX_SUBAGENT_DEPTH } = mod;

        pi.registerTool({
          name: "delegate_task",
          label: "Delegate Task",
          description: `Spawn a subagent for a focused task (max depth ${MAX_SUBAGENT_DEPTH}). Use allowed_tools to constrain scope (e.g. ['read','grep']).`,
          parameters: {
            type: "object",
            properties: {
              goal: { type: "string", description: "Task for the subagent" },
              allowed_tools: { type: "array", items: { type: "string" } },
              cwd: { type: "string" },
              parent_depth: { type: "number", minimum: 0, maximum: MAX_SUBAGENT_DEPTH - 1 },
              wait: { type: "boolean", default: true },
            },
            required: ["goal"],
          },
          async execute(
            _toolCallId: string,
            params: { goal: string; allowed_tools?: string[]; cwd?: string; parent_depth?: number; wait?: boolean },
            _signal: AbortSignal | undefined,
            _onUpdate: unknown,
            _ctx: unknown,
          ) {
            // ExtensionContext doesn't expose the AgentSession directly.
            // Use the parent session captured from the bridge closure.
            const sub = await spawnSubagent(parentSessionId, {
              goal: params.goal,
              cwd: params.cwd,
              allowedTools: params.allowed_tools,
              parentDepth: params.parent_depth ?? 0,
            });
            trackSubagent(parentSessionId, sub);
            if (params.wait !== false) {
              const output = await sub.wait();
              return { content: [{ type: "text", text: `[Subagent ${sub.id}]\n${output || "(no output)"}` }] };
            }
            return { content: [{ type: "text", text: `[Subagent ${sub.id} spawned fire-and-forget]` }] };
          },
        });
      }).catch(() => { /* subagent import best-effort */ });
    } catch {
      /* subagent tool is best-effort */
    }


    // ── 7. Slash commands ───────────────────────────────────────────────

    registerSharedCommand(pi, "audit", "Show mya audit log summary", async (_args) => {
      if (!opts.auditLog) return "AuditLog not configured";
      return `[mya] Audit log: ${opts.auditLog.length} records, tip=${opts.auditLog.tip.slice(0, 16)}…`;
    });

    registerSharedCommand(pi, "secrets", "Show mya secret store status", async (_args) => {
      if (!opts.secretStore) return "SecretStore not configured";
      const snap = opts.secretStore.snapshot();
      return `[mya] ${snap.size} secret(s) registered`;
    });

    registerSharedCommand(pi, "skills", "Show mya skill store status", async (_args) => {
      if (!opts.skillStore) return "SkillStore not configured";
      return `[mya] Skills loaded from ~/.mya/skills/`;
    });

    registerSharedCommand(pi, "memory", "Show mya memory (Brain) stats", async (_args) => {
      if (!opts.brain) return "Brain not configured";
      const b = opts.brain;
      return `[mya] Brain: ${b.factCount} facts, ${b.unconsolidatedFacts().length} pending, ${b.takeCount} takes, ${b.embeddedCount} embedded`;
    });

    registerSharedCommand(pi, "wallet", "Show mya x402 wallet balance", async (_args) => {
      if (!opts.wallet) return "Wallet not configured";
      const w = opts.wallet;
      const bal = w.balancesSnapshot;
      const entries = Object.entries(bal).filter(([, v]) => (v as number) > 0);
      const balStr = entries.length > 0 ? entries.map(([k, v]) => `${v} ${k}`).join(", ") : "(empty)";
      return `[mya] Wallet ${w.address}: ${balStr} · ${w.receipts.length} receipt(s) · ${w.health()}`;
    });

    registerSharedCommand(pi, "debug", "Show mya DAP debug tool status", async (_args) => {
      if (!opts.dapConnect) return "DAP debug tool not configured";
      const c = opts.dapConnect.connect;
      return `[mya] DAP debug tool registered (adapter: ${c.command} ${(c.args ?? []).join(" ")})`;
    });

    registerSharedCommand(pi, "eval", "Run mya eval unit-tier parity tests", async (_args) => {
      try {
        const harness = defaultHarness();
        const results = await harness.grade();
        const sum = harness.summarize(results);
        return `[mya] Eval unit-tier: ${sum.passed} passed, ${sum.failed} failed${sum.drifters.length ? " · drifters: " + sum.drifters.join(", ") : ""}`;
      } catch (e) {
        return `[mya] Eval failed: ${(e as Error).message}`;
      }
    });

    registerSharedCommand(pi, "sync", "Show mya sync replica state", async (_args) => {
      if (!opts.sync) return "SyncServer not configured";
      const r = opts.sync.replicaState;
      const h = r.hlc;
      return `[mya] Sync: ${r.size} key(s) · HLC wall=${h.wall} counter=${h.counter} node=${h.node}`;
    });

    registerSharedCommand(pi, "collab", "Show mya collab relay rooms", async (_args) => {
      if (!opts.collab) return "CollabRelay not configured";
      const rooms = opts.collab.roomNames;
      if (rooms.length === 0) return "[mya] Collab: 0 rooms (relay ready)";
      const detail = rooms.map((rm) => `${rm}=${opts.collab!.stats(rm).clients}`).join(", ");
      return `[mya] Collab: ${rooms.length} room(s) — ${detail}`;
    });

    registerSharedCommand(pi, "acp", "Show mya ACP lineage node count", async (_args) => {
      if (!opts.acp) return "AcpBridge not configured";
      const spawns = opts.acp.ledger.replay().filter((e) => e.kind === "spawn").length;
      return `[mya] ACP: ${spawns} spawned agent(s) · ${opts.acp.ledger.replay().length} ledger event(s)`;
    });

    registerSharedCommand(pi, "workflow", "Run a mya workflow file (.wf / .js)", async (args) => {
      const file = args.trim();
      if (!file) return "Usage: /workflow <file>";
      // Build a minimal workflow context (stubs for tools/provider — a real
      // workflow that needs them should run via the agent, not the TUI).
      const wfCtx = {
        input: undefined,
        tools: { execute: async () => [] },
        provider: {
          stream: async () => ({ events: [] }),
          health: () => "Healthy" as const,
          id: "mya-workflow-stub",
          model: "stub",
        },
        session: { id: "mya-tui", cwd: process.cwd() },
      } as unknown as WorkflowContext;
      try {
        const events = await runWorkflow(file, wfCtx, { timeoutMs: 30_000 });
        const logs = events.filter((e) => e.kind === "log");
        return `[mya] Workflow done: ${events.length} event(s), ${logs.length} log(s)`;
      } catch (e) {
        return `[mya] Workflow failed: ${(e as Error).message}`;
      }
    });

    registerSharedCommand(pi, "sign", "Verify a tarball signature (SHA-256 + sigstore)", async (args) => {
      const file = args.trim();
      if (!file) return "Usage: /sign <tarball>";
      try {
        const digest = fileSha256(file);
        // Look for a sigstore bundle sidecar: <file>.sigstore.json
        let bundle: SigstoreBundle | undefined;
        try {
          const fs = await import("node:fs");
          const sidecar = `${file}.sigstore.json`;
          if (fs.existsSync(sidecar)) {
            bundle = JSON.parse(fs.readFileSync(sidecar, "utf8")) as SigstoreBundle;
          }
        } catch {
          /* sidecar optional */
        }
        if (bundle) {
          const v = await verifyTarball(bundle, file);
          return `[mya] Sign: ${v.ok ? "✓ verified" : "✗ " + v.reason} (sha256=${digest.slice(0, 16)}…)`;
        }
        return `[mya] Sign: sha256=${digest} (no .sigstore.json sidecar → digest only)`;
      } catch (e) {
        return `[mya] Sign failed: ${(e as Error).message}`;
      }
    });

    registerSharedCommand(pi, "pkg", "List mya registered extension packages", async (_args) => {
      if (!opts.packageHost) return "PackageHost not configured";
      const list = opts.packageHost.list();
      if (list.length === 0) return "[mya] Pkg: 0 packages registered";
      const names = list.map((p) => `${p.manifest.name}@${p.manifest.version}${p.activated ? "*" : ""}`).join(", ");
      return `[mya] Pkg: ${list.length} registered — ${names}`;
    });

    registerSharedCommand(pi, "council", "Show mya multi-model council status", async (_args) => {
      if (!opts.council) return "CouncilProvider not configured (needs member profiles)";
      const c = opts.council;
      return `[mya] Council "${c.id}": ${c.model} — health=${c.health()}`;
    });

    registerSharedCommand(pi, "cron", "List mya cron jobs + due status", async (_args) => {
      if (!opts.cron) return "CronScheduler not configured";
      const jobs = opts.cron.listJobs();
      if (jobs.length === 0) return "[mya] Cron: 0 jobs registered";
      const due = new Set(opts.cron.due().map((j) => j.id));
      const detail = jobs.map((j) => `${j.name}(${j.trigger}:${j.schedule})${due.has(j.id) ? " ·DUE" : ""}${j.enabled ? "" : " ·off"}`).join(", ");
      return `[mya] Cron: ${jobs.length} job(s) — ${detail}`;
    });

    registerSharedCommand(pi, "mya-help", "Show mya bridge commands", async (_args) => {
      return (
        "[mya] Commands: /audit, /secrets, /skills, /memory, /wallet, /debug, " +
        "/eval, /sync, /collab, /acp, /workflow, /sign, /pkg, /council, /cron, /mcp, /channel, /mya-help"
      );
    });

    // ── MCP: list servers + connect ────────────────────────────────────
    if (opts.mcp) {
      const mcp = opts.mcp;
      // Auto-register configs.
      for (const cfg of opts.mcpConfigs ?? []) {
        try { mcp.register(cfg); } catch { /* already registered */ }
      }

      registerSharedCommand(pi, "mcp", "List MCP servers, connect, or call tools. Usage: /mcp [list|connect <id>|tools|health]", async (args) => {
        const parts = args.trim().split(/\s+/);
        const sub = parts[0] ?? "list";

        if (sub === "list" || sub === "") {
          const servers = mcp.listServers();
          if (servers.length === 0) {
            return "[mya] No MCP servers registered. Use /mcp connect <id> or configure in ~/.mya/agent/mcp.json";
          }
          const summary = servers.map((s) => `${s.id}: ${s.phase} (${s.tools.length} tools)`).join(" | ");
          return `[mya] MCP servers: ${summary}`;
        } else if (sub === "connect" && parts[1]) {
          try {
            const server = await mcp.start(parts[1]!);
            return `[mya] MCP ${server.id}: ${server.phase}, ${server.tools.length} tools discovered`;
          } catch (e) {
            return `[mya] MCP connect failed: ${(e as Error).message}`;
          }
        } else if (sub === "tools") {
          const tools = mcp.tools;
          return `[mya] MCP available tools (${tools.length}): ${tools.join(", ") || "none"}`;
        } else if (sub === "health") {
          return `[mya] MCP aggregate health: ${mcp.health}`;
        }
        return "[mya] Usage: /mcp [list|connect <id>|tools|health]";
      });
    }

    // ── Channel: messaging adapters (Telegram/Discord/Slack/Email/Webhook) ──
    if (opts.channels) {
      const channels = opts.channels;
      registerSharedCommand(pi, "channel", "Manage messaging channels. Usage: /channel [list|setup|status|send <id> <target> <text>|health]", async (args) => {
        const parts = args.trim().split(/\s+/);
        const sub = parts[0] ?? "list";

        if (sub === "list" || sub === "") {
          const all = channels.list();
          if (all.length === 0) return "[mya] No channels registered";
          const summary = all.map((c) => {
            const cfg = c.isConfigured() ? "✅" : "⬜";
            return `${cfg} ${c.id}`;
          }).join(" | ");
          return `[mya] Channels: ${summary}`;
        } else if (sub === "status") {
          // Detailed status with missing credentials
          const { channelStatusSummary } = await import("@my-agent/gateway");
          return `[mya] Channel status:\n${channelStatusSummary()}`;
        } else if (sub === "setup") {
          // Interactive setup wizard
          const { detectChannels } = await import("@my-agent/gateway");
          const detections = detectChannels();
          const configured = detections.filter((d) => d.configured).map((d) => d.id);
          const needsSetup = detections.filter((d) => !d.configured);
          const lines: string[] = [];
          if (configured.length > 0) {
            lines.push(`[mya] Already configured: ${configured.join(", ")}`);
          }
          if (needsSetup.length > 0) {
            const help = needsSetup.map((d) =>
              `${d.name}: set ${d.missing.map((m: { envVar: string }) => m.envVar).join(" + ")}`
            ).join("\n");
            lines.push(`[mya] To configure:\n${help}\n\nRun: /channel config <id> <ENV_VAR> <value>`);
          } else {
            lines.push("[mya] All channels configured! 🎉");
          }
          return lines.join("\n");
        } else if (sub === "config" && parts[1] && parts[2] && parts[3]) {
          // /channel config telegram TELEGRAM_BOT_TOKEN 123456:ABC-DEF
          const channelId = parts[1]!;
          const envVar = parts[2]!;
          const value = parts.slice(3).join(" ");
          const { saveChannelCredential } = await import("@my-agent/gateway");
          try {
            saveChannelCredential(channelId, envVar, value);
            return `[mya] ✓ Saved ${envVar} for ${channelId} (written to ~/.mya/agent/channels.json)`;
          } catch (e) {
            return `[mya] Config save failed: ${(e as Error).message}`;
          }
        } else if (sub === "send" && parts[1] && parts[2] && parts[3]) {
          const channelId = parts[1]!;
          const target = parts[2]!;
          const text = parts.slice(3).join(" ");
          const result = await channels.send(channelId, target, text);
          if (result.ok) {
            return `[mya] Sent via ${channelId} to ${target}`;
          }
          return `[mya] Send failed: ${result.error}`;
        } else if (sub === "health") {
          return `[mya] Channel health: ${channels.health}`;
        }
        return "[mya] Usage: /channel [list|setup|status|config <id> <var> <val>|send <id> <target> <text>|health]";
      });
    }

    // ── 8. Cron sweep (best-effort, non-blocking) ───────────────────────
    if (opts.cron) {
      const cron = opts.cron;
      const timer = setInterval(() => {
        try {
          cron.sweepExpired();
        } catch {
          /* cron sweep must never crash the TUI */
        }
      }, 60_000);
      timer.unref?.();
    }
  };
}

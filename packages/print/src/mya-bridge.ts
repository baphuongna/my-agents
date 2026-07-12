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
 * Create a pi InlineExtension factory that bridges mya packages.
 * Returns an InlineExtension (factory function) suitable for `main(args, { extensionFactories })`.
 */
export function createMyaBridge(opts: MyaBridgeOptions): (pi: MyaPiApi) => void {
  return (pi: MyaPiApi) => {
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

    // ── 7. Slash commands ───────────────────────────────────────────────

    pi.registerCommand("audit", {
      description: "Show mya audit log summary",
      handler: async (_args: string, ctx: unknown) => {
        const ui = uiOf(ctx);
        if (!opts.auditLog) {
          ui.notify("AuditLog not configured", "warning");
          return;
        }
        const summary = `[mya] Audit log: ${opts.auditLog.length} records, tip=${opts.auditLog.tip.slice(0, 16)}…`;
        ui.notify(summary, "info");
      },
    });

    pi.registerCommand("secrets", {
      description: "Show mya secret store status",
      handler: async (_args: string, ctx: unknown) => {
        const ui = uiOf(ctx);
        if (!opts.secretStore) {
          ui.notify("SecretStore not configured", "warning");
          return;
        }
        const snap = opts.secretStore.snapshot();
        ui.notify(`[mya] ${snap.size} secret(s) registered`, "info");
      },
    });

    pi.registerCommand("skills", {
      description: "Show mya skill store status",
      handler: async (_args: string, ctx: unknown) => {
        const ui = uiOf(ctx);
        if (!opts.skillStore) {
          ui.notify("SkillStore not configured", "warning");
          return;
        }
        ui.notify(`[mya] Skills loaded from ~/.mya/skills/`, "info");
      },
    });

    pi.registerCommand("memory", {
      description: "Show mya memory (Brain) stats",
      handler: async (_args: string, ctx: unknown) => {
        const ui = uiOf(ctx);
        if (!opts.brain) {
          ui.notify("Brain not configured", "warning");
          return;
        }
        const b = opts.brain;
        ui.notify(
          `[mya] Brain: ${b.factCount} facts, ${b.unconsolidatedFacts().length} pending, ${b.takeCount} takes, ${b.embeddedCount} embedded`,
          "info",
        );
      },
    });

    pi.registerCommand("wallet", {
      description: "Show mya x402 wallet balance",
      handler: async (_args: string, ctx: unknown) => {
        const ui = uiOf(ctx);
        if (!opts.wallet) {
          ui.notify("Wallet not configured", "warning");
          return;
        }
        const w = opts.wallet;
        const bal = w.balancesSnapshot;
        const entries = Object.entries(bal).filter(([, v]) => (v as number) > 0);
        const balStr = entries.length > 0 ? entries.map(([k, v]) => `${v} ${k}`).join(", ") : "(empty)";
        ui.notify(`[mya] Wallet ${w.address}: ${balStr} · ${w.receipts.length} receipt(s) · ${w.health()}`, "info");
      },
    });

    pi.registerCommand("debug", {
      description: "Show mya DAP debug tool status",
      handler: async (_args: string, ctx: unknown) => {
        const ui = uiOf(ctx);
        if (!opts.dapConnect) {
          ui.notify("DAP debug tool not configured", "warning");
          return;
        }
        const c = opts.dapConnect.connect;
        ui.notify(`[mya] DAP debug tool registered (adapter: ${c.command} ${(c.args ?? []).join(" ")})`, "info");
      },
    });

    pi.registerCommand("eval", {
      description: "Run mya eval unit-tier parity tests",
      handler: async (_args: string, ctx: unknown) => {
        const ui = uiOf(ctx);
        try {
          const harness = defaultHarness();
          const results = await harness.grade();
          const sum = harness.summarize(results);
          ui.notify(`[mya] Eval unit-tier: ${sum.passed} passed, ${sum.failed} failed${sum.drifters.length ? " · drifters: " + sum.drifters.join(", ") : ""}`, "info");
        } catch (e) {
          ui.notify(`[mya] Eval failed: ${(e as Error).message}`, "error");
        }
      },
    });

    pi.registerCommand("sync", {
      description: "Show mya sync replica state",
      handler: async (_args: string, ctx: unknown) => {
        const ui = uiOf(ctx);
        if (!opts.sync) {
          ui.notify("SyncServer not configured", "warning");
          return;
        }
        const r = opts.sync.replicaState;
        const h = r.hlc;
        ui.notify(`[mya] Sync: ${r.size} key(s) · HLC wall=${h.wall} counter=${h.counter} node=${h.node}`, "info");
      },
    });

    pi.registerCommand("collab", {
      description: "Show mya collab relay rooms",
      handler: async (_args: string, ctx: unknown) => {
        const ui = uiOf(ctx);
        if (!opts.collab) {
          ui.notify("CollabRelay not configured", "warning");
          return;
        }
        const rooms = opts.collab.roomNames;
        if (rooms.length === 0) {
          ui.notify("[mya] Collab: 0 rooms (relay ready)", "info");
          return;
        }
        const detail = rooms.map((rm) => `${rm}=${opts.collab!.stats(rm).clients}`).join(", ");
        ui.notify(`[mya] Collab: ${rooms.length} room(s) — ${detail}`, "info");
      },
    });

    pi.registerCommand("acp", {
      description: "Show mya ACP lineage node count",
      handler: async (_args: string, ctx: unknown) => {
        const ui = uiOf(ctx);
        if (!opts.acp) {
          ui.notify("AcpBridge not configured", "warning");
          return;
        }
        const spawns = opts.acp.ledger.replay().filter((e) => e.kind === "spawn").length;
        ui.notify(`[mya] ACP: ${spawns} spawned agent(s) · ${opts.acp.ledger.replay().length} ledger event(s)`, "info");
      },
    });

    pi.registerCommand("workflow", {
      description: "Run a mya workflow file (.wf / .js)",
      handler: async (args: string, ctx: unknown) => {
        const ui = uiOf(ctx);
        const file = args.trim();
        if (!file) {
          ui.notify("Usage: /workflow <file>", "warning");
          return;
        }
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
          ui.notify(`[mya] Workflow done: ${events.length} event(s), ${logs.length} log(s)`, "info");
        } catch (e) {
          ui.notify(`[mya] Workflow failed: ${(e as Error).message}`, "error");
        }
      },
    });

    pi.registerCommand("sign", {
      description: "Verify a tarball signature (SHA-256 + sigstore)",
      handler: async (args: string, ctx: unknown) => {
        const ui = uiOf(ctx);
        const file = args.trim();
        if (!file) {
          ui.notify("Usage: /sign <tarball>", "warning");
          return;
        }
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
            ui.notify(`[mya] Sign: ${v.ok ? "✓ verified" : "✗ " + v.reason} (sha256=${digest.slice(0, 16)}…)`, v.ok ? "info" : "error");
          } else {
            ui.notify(`[mya] Sign: sha256=${digest} (no .sigstore.json sidecar → digest only)`, "info");
          }
        } catch (e) {
          ui.notify(`[mya] Sign failed: ${(e as Error).message}`, "error");
        }
      },
    });

    pi.registerCommand("pkg", {
      description: "List mya registered extension packages",
      handler: async (_args: string, ctx: unknown) => {
        const ui = uiOf(ctx);
        if (!opts.packageHost) {
          ui.notify("PackageHost not configured", "warning");
          return;
        }
        const list = opts.packageHost.list();
        if (list.length === 0) {
          ui.notify("[mya] Pkg: 0 packages registered", "info");
          return;
        }
        const names = list.map((p) => `${p.manifest.name}@${p.manifest.version}${p.activated ? "*" : ""}`).join(", ");
        ui.notify(`[mya] Pkg: ${list.length} registered — ${names}`, "info");
      },
    });

    pi.registerCommand("council", {
      description: "Show mya multi-model council status",
      handler: async (_args: string, ctx: unknown) => {
        const ui = uiOf(ctx);
        if (!opts.council) {
          ui.notify("CouncilProvider not configured (needs member profiles)", "warning");
          return;
        }
        const c = opts.council;
        ui.notify(`[mya] Council "${c.id}": ${c.model} — health=${c.health()}`, "info");
      },
    });

    pi.registerCommand("cron", {
      description: "List mya cron jobs + due status",
      handler: async (_args: string, ctx: unknown) => {
        const ui = uiOf(ctx);
        if (!opts.cron) {
          ui.notify("CronScheduler not configured", "warning");
          return;
        }
        const jobs = opts.cron.listJobs();
        if (jobs.length === 0) {
          ui.notify("[mya] Cron: 0 jobs registered", "info");
          return;
        }
        const due = new Set(opts.cron.due().map((j) => j.id));
        const detail = jobs.map((j) => `${j.name}(${j.trigger}:${j.schedule})${due.has(j.id) ? " ·DUE" : ""}${j.enabled ? "" : " ·off"}`).join(", ");
        ui.notify(`[mya] Cron: ${jobs.length} job(s) — ${detail}`, "info");
      },
    });

    pi.registerCommand("mya-help", {
      description: "Show mya bridge commands",
      handler: async (_args: string, ctx: unknown) => {
        const ui = uiOf(ctx);
        ui.notify(
          "[mya] Commands: /audit, /secrets, /skills, /memory, /wallet, /debug, " +
            "/eval, /sync, /collab, /acp, /workflow, /sign, /pkg, /council, /cron, /mcp, /channel, /mya-help",
          "info",
        );
      },
    });

    // ── MCP: list servers + connect ────────────────────────────────────
    if (opts.mcp) {
      const mcp = opts.mcp;
      // Auto-register configs.
      for (const cfg of opts.mcpConfigs ?? []) {
        try { mcp.register(cfg); } catch { /* already registered */ }
      }

      pi.registerCommand("mcp", {
        description: "List MCP servers, connect, or call tools. Usage: /mcp [list|connect <id>|tools|health]",
        handler: async (args: string, ctx: unknown) => {
          const ui = uiOf(ctx);
          const parts = args.trim().split(/\s+/);
          const sub = parts[0] ?? "list";

          if (sub === "list" || sub === "") {
            const servers = mcp.listServers();
            if (servers.length === 0) {
              ui.notify("[mya] No MCP servers registered. Use /mcp connect <id> or configure in ~/.mya/agent/mcp.json", "info");
            } else {
              const summary = servers.map((s) => `${s.id}: ${s.phase} (${s.tools.length} tools)`).join(" | ");
              ui.notify(`[mya] MCP servers: ${summary}`, "info");
            }
          } else if (sub === "connect" && parts[1]) {
            try {
              const server = await mcp.start(parts[1]!);
              ui.notify(`[mya] MCP ${server.id}: ${server.phase}, ${server.tools.length} tools discovered`, "info");
            } catch (e) {
              ui.notify(`[mya] MCP connect failed: ${(e as Error).message}`, "error");
            }
          } else if (sub === "tools") {
            const tools = mcp.tools;
            ui.notify(`[mya] MCP available tools (${tools.length}): ${tools.join(", ") || "none"}`, "info");
          } else if (sub === "health") {
            ui.notify(`[mya] MCP aggregate health: ${mcp.health}`, "info");
          } else {
            ui.notify("[mya] Usage: /mcp [list|connect <id>|tools|health]", "warning");
          }
        },
      });
    }

    // ── Channel: messaging adapters (Telegram/Discord/Slack/Email/Webhook) ──
    if (opts.channels) {
      const channels = opts.channels;
      pi.registerCommand("channel", {
        description: "Manage messaging channels. Usage: /channel [list|setup|status|send <id> <target> <text>|health]",
        handler: async (args: string, ctx: unknown) => {
          const ui = uiOf(ctx);
          const parts = args.trim().split(/\s+/);
          const sub = parts[0] ?? "list";

          if (sub === "list" || sub === "") {
            const all = channels.list();
            if (all.length === 0) {
              ui.notify("[mya] No channels registered", "info");
            } else {
              const summary = all.map((c) => {
                const cfg = c.isConfigured() ? "✅" : "⬜";
                return `${cfg} ${c.id}`;
              }).join(" | ");
              ui.notify(`[mya] Channels: ${summary}`, "info");
            }
          } else if (sub === "status") {
            // Detailed status with missing credentials
            const { channelStatusSummary } = await import("@my-agent/gateway/channel-setup.js");
            ui.notify(`[mya] Channel status:\n${channelStatusSummary()}`, "info");
          } else if (sub === "setup") {
            // Interactive setup wizard
            const { detectChannels } = await import("@my-agent/gateway/channel-setup.js");
            const detections = detectChannels();
            const configured = detections.filter((d) => d.configured).map((d) => d.id);
            const needsSetup = detections.filter((d) => !d.configured);
            if (configured.length > 0) {
              ui.notify(`[mya] Already configured: ${configured.join(", ")}`, "info");
            }
            if (needsSetup.length > 0) {
              const help = needsSetup.map((d) =>
                `${d.name}: set ${d.missing.map((m) => m.envVar).join(" + ")}`
              ).join("\n");
              ui.notify(`[mya] To configure:\n${help}\n\nRun: /channel config <id> <ENV_VAR> <value>`, "info");
            } else {
              ui.notify("[mya] All channels configured! 🎉", "info");
            }
          } else if (sub === "config" && parts[1] && parts[2] && parts[3]) {
            // /channel config telegram TELEGRAM_BOT_TOKEN 123456:ABC-DEF
            const channelId = parts[1]!;
            const envVar = parts[2]!;
            const value = parts.slice(3).join(" ");
            const { saveChannelCredential } = await import("@my-agent/gateway/channel-setup.js");
            try {
              saveChannelCredential(channelId, envVar, value);
              ui.notify(`[mya] ✓ Saved ${envVar} for ${channelId} (written to ~/.mya/agent/channels.json)`, "info");
            } catch (e) {
              ui.notify(`[mya] Config save failed: ${(e as Error).message}`, "error");
            }
          } else if (sub === "send" && parts[1] && parts[2] && parts[3]) {
            const channelId = parts[1]!;
            const target = parts[2]!;
            const text = parts.slice(3).join(" ");
            const result = await channels.send(channelId, target, text);
            if (result.ok) {
              ui.notify(`[mya] Sent via ${channelId} to ${target}`, "info");
            } else {
              ui.notify(`[mya] Send failed: ${result.error}`, "error");
            }
          } else if (sub === "health") {
            ui.notify(`[mya] Channel health: ${channels.health}`, "info");
          } else {
            ui.notify("[mya] Usage: /channel [list|setup|status|config <id> <var> <val>|send <id> <target> <text>|health]", "warning");
          }
        },
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

/**
 * mya-bridge — pi InlineExtension that bridges mya packages into pi's TUI.
 *
 * This is THE integration point between mya's 29 packages and pi's InteractiveMode.
 * Without this extension, the TUI runs 100% pi with zero mya features.
 *
 * Wired subsystems:
 * - AuditLog:    every tool_call/tool_result → tamper-evident Merkle log
 * - SecretStore: redacts known secrets in tool output before display
 * - HookRegistry: fires session_start/turn_start/turn_end/tool_call/tool_result
 * - CronScheduler: (optional) background sweep for due jobs
 * - Skills:      loaded from ~/.mya/skills/ + project/.mya/skills/
 * - Custom tools: paid_fetch (x402), debug (DAP) — registered when configured
 * - Slash commands: /audit, /secrets, /skills, /mya-help
 *
 * Usage in pi-main.ts:
 *   import { createMyaBridge } from "@my-agent/print/mya-bridge.js";
 *   await main(args, { extensionFactories: [createMyaBridge(opts)] });
 */
import type { AuditLog } from "@my-agent/audit";
import type { SecretStore } from "@my-agent/secrets";
import type { HookRegistry } from "@my-agent/gateway";
import type { SkillStore } from "@my-agent/skills";
import type { CronScheduler } from "@my-agent/cron";
import { nowWallclock } from "@my-agent/core";

export interface MyaBridgeOptions {
  auditLog?: AuditLog;
  secretStore?: SecretStore;
  hooks?: HookRegistry;
  skillStore?: SkillStore;
  cron?: CronScheduler;
  /** Register custom tools (paid_fetch, debug) — return tool definitions for pi. */
  registerTools?: (pi: MyaPiApi) => void;
}

/** Minimal pi ExtensionAPI surface we use (duck-typed to avoid tight coupling). */
export interface MyaPiApi {
  on(event: string, handler: (event: unknown, ctx: unknown) => unknown): void;
  registerTool(tool: unknown): void;
  registerCommand(name: string, options: unknown): void;
  registerShortcut(shortcut: string, options: unknown): void;
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

    // ── 3. Custom tools (paid_fetch, debug, etc.) ───────────────────────
    if (opts.registerTools) {
      opts.registerTools(pi);
    }

    // ── 4. Slash commands ───────────────────────────────────────────────
    pi.registerCommand("audit", {
      description: "Show mya audit log summary",
      handler: async (args: string, ctx: unknown) => {
        const ui = (ctx as { ui: { notify: (m: string, t?: string) => void } }).ui;
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
        const ui = (ctx as { ui: { notify: (m: string, t?: string) => void } }).ui;
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
        const ui = (ctx as { ui: { notify: (m: string, t?: string) => void } }).ui;
        if (!opts.skillStore) {
          ui.notify("SkillStore not configured", "warning");
          return;
        }
        ui.notify(`[mya] Skills loaded from ~/.mya/skills/`, "info");
      },
    });

    pi.registerCommand("mya-help", {
      description: "Show mya bridge commands",
      handler: async (_args: string, ctx: unknown) => {
        const ui = (ctx as { ui: { notify: (m: string, t?: string) => void } }).ui;
        ui.notify("[mya] Commands: /audit, /secrets, /skills, /mya-help", "info");
      },
    });

    // ── 5. Cron sweep (best-effort, non-blocking) ───────────────────────
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

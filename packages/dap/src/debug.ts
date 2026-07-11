/**
 * `debug` tool (§11.2) — exposes the DapClient to the agent as a builtin.
 *
 * The agent drives a debug session: start (launch/attach) → setBreakpoints →
 * configurationDone → continue/step → inspect (threads/stackTrace/scopes/
 * variables/evaluate) → disconnect. One DapClient per tool instance (lazy
 * connect on first `start`); the factory injects the transport config so the
 * host picks the adapter (vscode-js-debug standalone, dap-server, etc.).
 *
 * DangerFullAccess: debugging grants arbitrary code execution + state mutation.
 */
import type { ToolImpl } from "@my-agent/tools";
import { ok, err, isRecord } from "@my-agent/tools";
import { DapClient, type DapClientOptions, type DapBreakpoint, type DapSource } from "./client.js";

export interface DebugToolOptions {
  /** How to build the DapClient (transport: stdio command or TCP host:port). */
  connect: DapClientOptions;
}

/** Build the `debug` tool bound to a specific adapter connection. */
export function makeDebugTool(opts: DebugToolOptions): ToolImpl {
  let client: DapClient | undefined;
  const getClient = (): DapClient => {
    if (!client) client = new DapClient(opts.connect);
    return client;
  };

  return {
    meta: {
      name: "debug",
      args: {
        type: "object",
        properties: {
          command: {
            type: "string",
            enum: ["initialize", "start", "setBreakpoints", "configurationDone", "continue", "next", "stepIn", "stepOut", "threads", "stackTrace", "scopes", "variables", "evaluate", "disconnect"],
          },
        },
        required: ["command"],
      },
      requiredMode: "DangerFullAccess",
      idempotent: false,
    },

    async run(args) {
      if (!isRecord(args) || typeof args.command !== "string") return err("debug", "command required");
      const c = getClient();
      try {
        switch (args.command) {
          case "initialize": {
            const r = await c.initialize();
            return ok("debug", r as Record<string, unknown>);
          }
          case "start": {
            // source + launch config
            const source = args.source as DapSource | undefined;
            const config = (args.config as Record<string, unknown> | undefined) ?? {};
            if (!source) return err("debug", "start requires {source:{path}, config}");
            await c.start(source, config);
            return ok("debug", { started: true });
          }
          case "setBreakpoints": {
            const path = args.path as string | undefined;
            const bps = (args.breakpoints as DapBreakpoint[] | undefined) ?? [];
            if (!path) return err("debug", "setBreakpoints requires {path, breakpoints}");
            const r = await c.setBreakpoints(path, bps);
            return ok("debug", r as unknown as Record<string, unknown>);
          }
          case "configurationDone": {
            await c.configurationDone();
            return ok("debug", { configured: true });
          }
          case "continue": {
            const r = await c.continue(args.threadId as number | undefined);
            return ok("debug", r as unknown as Record<string, unknown>);
          }
          case "next": { await c.next(args.threadId as number | undefined); return ok("debug", { stepped: "next" }); }
          case "stepIn": { await c.stepIn(args.threadId as number | undefined); return ok("debug", { stepped: "stepIn" }); }
          case "stepOut": { await c.stepOut(args.threadId as number | undefined); return ok("debug", { stepped: "stepOut" }); }
          case "threads": {
            const r = await c.threads();
            return ok("debug", r as unknown as Record<string, unknown>);
          }
          case "stackTrace": {
            const tid = args.threadId as number | undefined;
            if (tid === undefined) return err("debug", "stackTrace requires {threadId}");
            const r = await c.stackTrace(tid, (args.startFrame as number | undefined) ?? 0, (args.levels as number | undefined) ?? 20);
            return ok("debug", r as unknown as Record<string, unknown>);
          }
          case "scopes": {
            const fid = args.frameId as number | undefined;
            if (fid === undefined) return err("debug", "scopes requires {frameId}");
            const r = await c.scopes(fid);
            return ok("debug", r as unknown as Record<string, unknown>);
          }
          case "variables": {
            const ref = args.variablesReference as number | undefined;
            if (ref === undefined) return err("debug", "variables requires {variablesReference}");
            const r = await c.variables(ref);
            return ok("debug", r as unknown as Record<string, unknown>);
          }
          case "evaluate": {
            const expr = args.expression as string | undefined;
            if (!expr) return err("debug", "evaluate requires {expression}");
            const r = await c.evaluate(expr, args.frameId as number | undefined);
            return ok("debug", r as unknown as Record<string, unknown>);
          }
          case "disconnect": {
            await c.disconnect();
            client = undefined;
            return ok("debug", { disconnected: true });
          }
          default:
            return err("debug", `unknown debug command: ${args.command}`);
        }
      } catch (e) {
        return err("debug", e instanceof Error ? e.message : String(e));
      }
    },
  };
}

/**
 * Subagent Extension
 *
 * Adds `delegate_task` tool to spawn subagents from the main session.
 * Subagents run with restricted tools + isolated cwd + streaming output.
 *
 * Usage:
 *   1. Load this extension (via settings or pi.config.ts)
 *   2. Model can now call `delegate_task` to spawn sub-tasks
 *   3. Run `/subagents` to see active subagents
 *   4. Footer shows count: "2 sub"
 *
 * Example (model):
 *   "delegate_task: 'review the auth code' allowed=['read','grep']"
 *
 * Tree support:
 *   Subagent can call delegate_task with parentDepth > 0 to spawn sub-sub-agents.
 *   Max recursion depth: MAX_SUBAGENT_DEPTH (default 3).
 *
 * Lifecycle:
 *   - Subagents tracked in module-level Map (keyed by parent session id)
 *   - Auto-cleaned when subagent completes (interval check)
 *   - Killed on session exit
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  spawnSubagent,
  trackSubagent,
  listSubagents,
  killAllSubagents,
  MAX_SUBAGENT_DEPTH,
  type SubagentHandle,
} from "../../src/core/subagent.js";

const DELEGATE_PARAMS = Type.Object({
  goal: Type.String({ description: "Task description for the subagent" }),
  allowed_tools: Type.Optional(
    Type.Array(Type.String(), {
      description: `Tool names the subagent may use. Empty = no tools. Max ${MAX_SUBAGENT_DEPTH} levels deep.`,
    }),
  ),
  cwd: Type.Optional(Type.String({ description: "Working directory for the subagent" })),
  parent_depth: Type.Optional(
    Type.Number({
      description: "Depth in subagent tree (0 = top). Caller's depth; pass 0 if main agent.",
      minimum: 0,
      maximum: MAX_SUBAGENT_DEPTH,
    }),
  ),
  wait: Type.Optional(
    Type.Boolean({
      description: "If true, block until subagent finishes. Default true.",
      default: true,
    }),
  ),
});

export default function subagentExtension(pi: ExtensionAPI) {
  // Track all subagents for this session (keyed by session id)
  const sessionSubs = new Map<string, SubagentHandle[]>();
  let sessionId = "";

  // Register the delegate_task tool at session start
  pi.on("session_start", async (_event, ctx) => {
    sessionId = ctx.session.sessionId ?? "";
    pi.registerTool({
      name: "delegate_task",
      label: "Delegate Task",
      description:
        `Spawn a subagent for a focused task. Returns the subagent's output. ` +
        `Use sparingly — only when a task is genuinely independent and would benefit ` +
        `from a fresh context. Max recursion depth: ${MAX_SUBAGENT_DEPTH} levels.`,
      promptSnippet:
        `Use delegate_task when the user asks for code review, research, or any task ` +
        `that benefits from isolated context. Always specify allowed_tools to constrain scope.`,
      promptGuidelines: [
        "Specify allowed_tools to limit what the subagent can do (e.g. ['read', 'grep'] for read-only review).",
        "Set parent_depth explicitly if you are a subagent yourself.",
        "Don't use delegate_task for trivial tasks — only when context isolation helps.",
      ],
      parameters: DELEGATE_PARAMS,

      async execute(
        _toolCallId: string,
        params: { goal: string; allowed_tools?: string[]; cwd?: string; parent_depth?: number; wait?: boolean },
        _signal: AbortSignal | undefined,
        _onUpdate: unknown,
        ctx: { session: { sessionId?: string } },
      ) {
        const p = params as {
          goal: string;
          allowed_tools?: string[];
          cwd?: string;
          parent_depth?: number;
          wait?: boolean;
        };

        const startTime = Date.now();
        try {
          const sub = await spawnSubagent(ctx.session, {
            goal: p.goal,
            cwd: p.cwd,
            allowedTools: p.allowed_tools,
            parentDepth: p.parent_depth ?? 0,
          });

          // Track for /subagents + cleanup
          trackSubagent(sessionId, sub);
          let arr = sessionSubs.get(sessionId);
          if (!arr) { arr = []; sessionSubs.set(sessionId, arr); }
          arr.push(sub);

          if (p.wait !== false) {
            const output = await sub.wait();
            const durationMs = Date.now() - startTime;
            return {
              content: [
                {
                  type: "text",
                  text:
                    `[Subagent ${sub.id} completed in ${durationMs}ms]\n\n${output || "(no output)"}`,
                },
              ],
            };
          } else {
            // Fire-and-forget
            void sub.wait().then(() => {
              const arr = sessionSubs.get(sessionId);
              if (arr) {
                const idx = arr.indexOf(sub);
                if (idx >= 0) arr.splice(idx, 1);
              }
            });
            return {
              content: [
                {
                  type: "text",
                  text: `[Subagent ${sub.id} spawned (fire-and-forget). Use /subagents to track.]`,
                },
              ],
            };
          }
        } catch (e) {
          const err = e as Error;
          return {
            content: [{ type: "text", text: `[Subagent spawn failed: ${err.message}]` }],
            is_error: true,
          };
        }
      },
    });
  });

  // Cleanup: kill all subagents when session ends
  pi.on("session_shutdown", async () => {
    const arr = sessionSubs.get(sessionId);
    if (arr) {
      for (const sub of arr) {
        if (sub.status === "running") sub.abort();
      }
      sessionSubs.delete(sessionId);
    }
    killAllSubagents(sessionId);
  });

  // Slash command: /subagents — list active subagents
  pi.registerCommand?.({
    name: "subagents",
    description: "List active subagents",
    handler: async () => {
      const subs = listSubagents(sessionId);
      const running = subs.filter((s) => s.status === "running").length;
      const done = subs.filter((s) => s.status === "done").length;
      const failed = subs.filter((s) => s.status === "failed").length;
      const aborted = subs.filter((s) => s.status === "aborted").length;
      let out = `Subagents (${subs.length})\n\n`;
      out += `Running: ${running}  Done: ${done}  Failed: ${failed}  Aborted: ${aborted}\n\n`;
      if (subs.length === 0) {
        out += "(no subagents)\n";
      } else {
        for (const s of subs) {
          const statusColor =
            s.status === "running" ? "yellow" :
            s.status === "done" ? "green" :
            s.status === "failed" ? "red" : "dim";
          out += `● ${s.id} (${s.status}, depth ${s.depth})\n`;
          out += `   Goal: ${s.goal.slice(0, 60)}${s.goal.length > 60 ? "..." : ""}\n`;
          if (s.allowedTools?.length) out += `   Tools: ${s.allowedTools.join(", ")}\n`;
          if (s.output) out += `   Output: ${s.output.slice(0, 80).replace(/\n/g, " ")}${s.output.length > 80 ? "..." : ""}\n`;
          if (s.error) out += `   Error: ${s.error}\n`;
          out += "\n";
        }
      }
      return out;
    },
  });
}
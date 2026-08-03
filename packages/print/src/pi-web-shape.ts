// packages/print/src/pi-web-shape.ts
//
// R4-HIGH fix: the web dashboard (ChatPage) consumes pi's raw event shape
// (message_update/assistantMessageEvent.text_delta, tool_call/name), but the
// RuntimePool emits uniform AgentEvent (text/delta). This boundary adapter
// re-maps AgentEvent → pi-shape ONLY for gateway broadcast so the SPA keeps
// working without a web-layer rewrite. Internal consumers (cron responseText,
// pool bookkeeping) keep using AgentEvent directly.

import type { AgentEvent } from "@my-agent/core";

/**
 * Re-map a uniform AgentEvent to the pi-shape the web dashboard expects.
 * Events the SPA doesn't render are passed through unchanged (they're
 * harmless) or mapped to the closest pi equivalent.
 */
export function toPiWebShape(event: unknown): unknown {
  const e = event as AgentEvent | { type: string };
  switch (e?.type) {
    case "text":
      return {
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: (e as { delta?: string }).delta ?? "" },
      };
    case "thinking":
      return {
        type: "message_update",
        assistantMessageEvent: { type: "thinking_delta", delta: (e as { delta?: string }).delta ?? "" },
      };
    case "tool_call": {
      const tc = e as { toolCallId?: string; name?: string; args?: unknown };
      return { type: "tool_execution_start", toolCallId: tc.toolCallId ?? "", toolName: tc.name ?? "", args: tc.args ?? {} };
    }
    case "tool_result": {
      const tr = e as { toolCallId?: string; output?: unknown; error?: boolean };
      return { type: "tool_execution_end", toolCallId: tr.toolCallId ?? "", result: tr.output ?? "", isError: tr.error ?? false };
    }
    case "model_changed":
      return { type: "model_select", model: { id: (e as { model?: string }).model ?? "unknown" } };
    case "thinking_changed":
      return { type: "thinking_level_select", level: (e as { level?: string }).level ?? "medium" };
    case "compaction":
      return { type: "compaction_end", result: (e as { result?: unknown }).result ?? {} };
    // turn_start/turn_end/error pass through — ChatPage understands these.
    default:
      return e;
  }
}

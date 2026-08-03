// packages/print/src/runtimes/pi-event-normalizer.ts
import type { AgentEvent } from "@my-agent/core";

// R9-1 fix: normalizer is PURE — no nowWallclock needed

interface PiSessionLike {
  readonly model?: { id: string };
  readonly thinkingLevel?: string;
}

interface AccumulatedUsage {
  tokensIn: number;
  tokensOut: number;
}

/**
 * Map pi events to uniform AgentEvent.
 * Verified against @earendil-works/pi-coding-agent@0.83.0 (see pi-event-map.md).
 */
export class PiEventNormalizer {
  static toAgentEvent(
    rawEvent: unknown,
    usage: AccumulatedUsage,
  ): AgentEvent | null {
    const e = rawEvent as { type: string; [key: string]: unknown };

    switch (e.type) {
      case "agent_start":
        return null;

      case "agent_settled":
        return {
          type: "turn_end",
          tokensIn: usage.tokensIn,
          tokensOut: usage.tokensOut,
        };

      case "message_start":
        return null;

      case "message_update": {
        // Phase 3 spike: delta is in assistantMessageEvent, not directly on event
        const rawDelta = (e as any).assistantMessageEvent?.delta ?? (e as any).delta;
        // R9-5 fix: coerce to string (may be object from pi)
        const delta = typeof rawDelta === "string" ? rawDelta : (rawDelta?.text ?? rawDelta?.thinking ?? "");
        if (!delta) return null;

        const eventType = (e as any).assistantMessageEvent?.type;
        if (eventType === "thinking") {
          return { type: "thinking", delta };
        }
        return { type: "text", delta };
      }

      case "message_end":
        return null;

      // Phase 3 spike: field names verified from source
      case "tool_execution_start":
        return {
          type: "tool_call",
          toolCallId: (e as any).toolCallId ?? "",
          name: (e as any).toolName ?? "",  // NOT 'name' — pi uses 'toolName'
          args: (e as any).args ?? {},
        };

      case "tool_execution_update":
        return null; // partial results not mapped

      case "tool_execution_end":
        return {
          type: "tool_result",
          toolCallId: (e as any).toolCallId ?? "",
          // Phase 3 spike: pi uses 'result' + 'isError', not 'output' + 'error'
          output: typeof (e as any).result === "string"
            ? (e as any).result
            : JSON.stringify((e as any).result ?? ""),
          error: (e as any).isError ?? false,
        };

      case "compaction_start":
        return null;

      case "compaction_end":
        return {
          type: "compaction",
          result: {
            tokensBefore: (e as any).result?.tokensBefore ?? 0,
            tokensAfter: (e as any).result?.estimatedTokensAfter ?? 0,
            strategy: "native",
          },
        };

      // Phase 3 spike: model is a Model object, use .id
      case "model_select":
        return { type: "model_changed", model: (e as any).model?.id ?? "unknown" };

      // Phase 3 spike: event is 'thinking_level_select', NOT 'thinking_level_changed'
      case "thinking_level_select":
        return { type: "thinking_changed", level: String((e as any).level ?? "") };

      case "error":
        return {
          type: "error",
          message: (e as any).message ?? String(e),
          recoverable: (e as any).recoverable ?? false,
        };

      case "bash_execution_update":
        return null;

      default:
        return null;
    }
  }
}

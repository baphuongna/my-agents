import { describe, it, expect } from "vitest";
import { PiEventNormalizer } from "./pi-event-normalizer.js";

describe("[unit] PiEventNormalizer", () => {
  const usage = { tokensIn: 100, tokensOut: 50 };
  const session = { model: { id: "claude-4" }, thinkingLevel: "medium" };

  it("agent_settled → turn_end with usage", () => {
    const result = PiEventNormalizer.toAgentEvent({ type: "agent_settled" }, session, usage);
    expect(result).toEqual({ type: "turn_end", tokensIn: 100, tokensOut: 50 });
  });

  it("agent_start → null", () => {
    expect(PiEventNormalizer.toAgentEvent({ type: "agent_start" }, session, usage)).toBeNull();
  });

  it("message_update with text delta", () => {
    const event = { type: "message_update", assistantMessageEvent: { delta: "hello", type: "text" } };
    const result = PiEventNormalizer.toAgentEvent(event, session, usage);
    expect(result).toEqual({ type: "text", delta: "hello" });
  });

  it("message_update with thinking delta", () => {
    const event = { type: "message_update", assistantMessageEvent: { delta: "thinking...", type: "thinking" } };
    const result = PiEventNormalizer.toAgentEvent(event, session, usage);
    expect(result).toEqual({ type: "thinking", delta: "thinking..." });
  });

  it("message_update with object delta coerced to string", () => {
    const event = { type: "message_update", assistantMessageEvent: { delta: { text: "coerced" } } };
    const result = PiEventNormalizer.toAgentEvent(event, session, usage);
    expect(result).toEqual({ type: "text", delta: "coerced" });
  });

  it("tool_execution_start uses toolName (NOT name)", () => {
    const event = { type: "tool_execution_start", toolCallId: "tc1", toolName: "bash", args: { cmd: "ls" } };
    const result = PiEventNormalizer.toAgentEvent(event, session, usage);
    expect(result).toEqual({ type: "tool_call", toolCallId: "tc1", name: "bash", args: { cmd: "ls" } });
  });

  it("tool_execution_end uses result/isError (NOT output/error)", () => {
    const event = { type: "tool_execution_end", toolCallId: "tc1", toolName: "bash", result: "done", isError: false };
    const result = PiEventNormalizer.toAgentEvent(event, session, usage);
    expect(result).toEqual({ type: "tool_result", toolCallId: "tc1", output: "done", error: false });
  });

  it("tool_execution_end with error", () => {
    const event = { type: "tool_execution_end", toolCallId: "tc1", toolName: "bash", result: { err: "fail" }, isError: true };
    const result = PiEventNormalizer.toAgentEvent(event, session, usage);
    expect(result?.type).toBe("tool_result");
    expect((result as any).error).toBe(true);
  });

  it("model_select extracts .id from Model object", () => {
    const event = { type: "model_select", model: { id: "claude-sonnet-4" }, previousModel: undefined, source: "set" };
    const result = PiEventNormalizer.toAgentEvent(event, session, usage);
    expect(result).toEqual({ type: "model_changed", model: "claude-sonnet-4" });
  });

  it("thinking_level_select (NOT thinking_level_changed)", () => {
    const event = { type: "thinking_level_select", level: "high", previousLevel: "medium" };
    const result = PiEventNormalizer.toAgentEvent(event, session, usage);
    expect(result).toEqual({ type: "thinking_changed", level: "high" });
  });

  it("compaction_end maps to compaction event", () => {
    const event = { type: "compaction_end", reason: "threshold", result: { tokensBefore: 1000, estimatedTokensAfter: 500 }, aborted: false, willRetry: false };
    const result = PiEventNormalizer.toAgentEvent(event, session, usage);
    expect(result).toEqual({ type: "compaction", result: { tokensBefore: 1000, tokensAfter: 500, strategy: "native" } });
  });

  it("compaction_end with undefined result", () => {
    const event = { type: "compaction_end", reason: "threshold", result: undefined, aborted: true, willRetry: false };
    const result = PiEventNormalizer.toAgentEvent(event, session, usage);
    expect(result).toEqual({ type: "compaction", result: { tokensBefore: 0, tokensAfter: 0, strategy: "native" } });
  });

  it("error event maps correctly", () => {
    const event = { type: "error", message: "something broke", recoverable: true };
    const result = PiEventNormalizer.toAgentEvent(event, session, usage);
    expect(result).toEqual({ type: "error", message: "something broke", recoverable: true });
  });

  it("unknown event → null", () => {
    expect(PiEventNormalizer.toAgentEvent({ type: "unknown_event" }, session, usage)).toBeNull();
  });

  it("message_update with no delta → null", () => {
    const event = { type: "message_update", assistantMessageEvent: {} };
    expect(PiEventNormalizer.toAgentEvent(event, session, usage)).toBeNull();
  });
});

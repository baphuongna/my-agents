// [unit] toPiWebShape — AgentEvent → pi raw shape for web dashboard broadcast.
import { describe, it, expect } from "vitest";
import { toPiWebShape } from "./pi-web-shape.js";

describe("[unit] toPiWebShape", () => {
  it("maps text → message_update assistantMessageEvent.text_delta", () => {
    const out = toPiWebShape({ type: "text", delta: "hello" }) as any;
    expect(out.type).toBe("message_update");
    expect(out.assistantMessageEvent).toEqual({ type: "text_delta", delta: "hello" });
  });

  it("maps thinking → message_update thinking_delta", () => {
    const out = toPiWebShape({ type: "thinking", delta: "hmm" }) as any;
    expect(out.type).toBe("message_update");
    expect(out.assistantMessageEvent).toEqual({ type: "thinking_delta", delta: "hmm" });
  });

  it("passes tool_call through unchanged (R5 fix — ChatPage native)", () => {
    const ev = { type: "tool_call", toolCallId: "t1", name: "bash", args: { cmd: "ls" } };
    expect(toPiWebShape(ev)).toEqual(ev);
  });

  it("passes tool_result through unchanged (R5 fix)", () => {
    const ev = { type: "tool_result", toolCallId: "t1", output: "ok", error: false };
    expect(toPiWebShape(ev)).toEqual(ev);
  });

  it("maps model_changed → model_select with model object", () => {
    const out = toPiWebShape({ type: "model_changed", model: "gpt-4o" }) as any;
    expect(out.type).toBe("model_select");
    expect(out.model.id).toBe("gpt-4o");
  });

  it("maps thinking_changed → thinking_level_select", () => {
    const out = toPiWebShape({ type: "thinking_changed", level: "high" }) as any;
    expect(out.type).toBe("thinking_level_select");
    expect(out.level).toBe("high");
  });

  it("maps compaction → compaction_end", () => {
    const out = toPiWebShape({ type: "compaction", result: { tokensBefore: 10, tokensAfter: 5 } }) as any;
    expect(out.type).toBe("compaction_end");
    expect(out.result.tokensBefore).toBe(10);
  });

  it("passes turn_start/turn_end/error through unchanged", () => {
    expect(toPiWebShape({ type: "turn_start", model: "m" })).toEqual({ type: "turn_start", model: "m" });
    expect(toPiWebShape({ type: "turn_end", tokensIn: 1, tokensOut: 2 })).toEqual({ type: "turn_end", tokensIn: 1, tokensOut: 2 });
    expect(toPiWebShape({ type: "error", message: "x", recoverable: false })).toEqual({ type: "error", message: "x", recoverable: false });
  });

  it("passes unknown events through unchanged", () => {
    const ev = { type: "unknown_thing", foo: 1 };
    expect(toPiWebShape(ev)).toEqual(ev);
  });

  it("handles null/undefined safely", () => {
    expect(toPiWebShape(null)).toBeNull();
    expect(toPiWebShape(undefined)).toBeUndefined();
  });
});

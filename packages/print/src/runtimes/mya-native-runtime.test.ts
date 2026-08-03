import { describe, it, expect } from "vitest";
import { mapMyaEvent, MyaNativeRuntime } from "./mya-native.js";

describe("[unit] mapMyaEvent", () => {
  const state = { tokensIn: 10, tokensOut: 5 };

  it("turn completed → turn_end", () => {
    expect(mapMyaEvent({ kind: "turn", state: "completed" } as any, state))
      .toEqual({ type: "turn_end", tokensIn: 10, tokensOut: 5 });
  });

  it("turn failed → turn_end", () => {
    expect(mapMyaEvent({ kind: "turn", state: "failed" } as any, state))
      .toEqual({ type: "turn_end", tokensIn: 10, tokensOut: 5 });
  });

  it("tool started → tool_call", () => {
    const e = { kind: "tool", state: "started", id: "tc1", name: "bash", args: { cmd: "ls" } };
    expect(mapMyaEvent(e as any, state))
      .toEqual({ type: "tool_call", toolCallId: "tc1", name: "bash", args: { cmd: "ls" } });
  });

  it("tool completed → tool_result", () => {
    const e = { kind: "tool", state: "completed", id: "tc1", result: "output" };
    expect(mapMyaEvent(e as any, state))
      .toEqual({ type: "tool_result", toolCallId: "tc1", output: "output", error: false });
  });

  it("streaming text → text delta", () => {
    const e = { kind: "streaming", chunk: { kind: "text", text: "hello" } };
    expect(mapMyaEvent(e as any, state)).toEqual({ type: "text", delta: "hello" });
  });

  it("streaming thinking → thinking delta", () => {
    const e = { kind: "streaming", chunk: { kind: "thinking", text: "hmm" } };
    expect(mapMyaEvent(e as any, state)).toEqual({ type: "thinking", delta: "hmm" });
  });

  it("unknown kind → null", () => {
    expect(mapMyaEvent({ kind: "health" } as any, state)).toBeNull();
  });
});

describe("[unit] MyaNativeRuntime", () => {
  it("capabilities correct", () => {
    const rt = new MyaNativeRuntime();
    const caps = rt.capabilities();
    expect(caps.execution).toBe("in-process");
    expect(caps.supportsCompaction).toBe(false);
  });

  it("costPerMTokens", () => {
    const rt = new MyaNativeRuntime();
    expect(rt.costPerMTokens()).toEqual({ input: 0.15, output: 0.6 });
  });

  it("listModels returns default", async () => {
    const rt = new MyaNativeRuntime();
    const models = await rt.listModels();
    expect(models).toHaveLength(1);
    expect(models[0]!.id).toBe("mya-default");
  });
});

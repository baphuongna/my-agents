import { describe, it, expect } from "vitest";
import { mapMyaEvent, MyaNativeRuntime } from "./mya-native.js";
import type { RuntimeEvent } from "@my-agent/core";

describe("[unit] mapMyaEvent", () => {
  const state = { tokensIn: 0, tokensOut: 0 };

  it("turn start → null", () => {
    const e: RuntimeEvent = { kind: "turn", stage: "start" };
    expect(mapMyaEvent(e, state)).toBeNull();
  });

  it("turn end with Completed → null (tokens accumulated)", () => {
    const s = { tokensIn: 0, tokensOut: 0 };
    const e: RuntimeEvent = { kind: "turn", stage: "end", turnEvent: { state: "Completed", usage: { input: 100, output: 50 } as any, cost: 0.01 } } as any;
    expect(mapMyaEvent(e, s)).toBeNull();
    expect(s.tokensIn).toBe(100);
    expect(s.tokensOut).toBe(50);
  });

  it("turn end with Failed → error", () => {
    const e: RuntimeEvent = { kind: "turn", stage: "end", turnEvent: { state: "Failed", error: { message: "crashed" } as any } } as any;
    expect(mapMyaEvent(e, state)).toEqual({ type: "error", message: "crashed", recoverable: false });
  });

  it("streaming text → text delta", () => {
    const e: RuntimeEvent = { kind: "turn", stage: "event", turnEvent: { state: "Streaming", chunk: { kind: "text", text: "hello" } } } as any;
    expect(mapMyaEvent(e, state)).toEqual({ type: "text", delta: "hello" });
  });

  it("streaming error → error event", () => {
    const e: RuntimeEvent = { kind: "turn", stage: "event", turnEvent: { state: "Streaming", chunk: { kind: "error", error: { message: "stream broke" } as any } } } as any;
    expect(mapMyaEvent(e, state)).toEqual({ type: "error", message: "stream broke", recoverable: false });
  });

  it("tool request → tool_call", () => {
    const e: RuntimeEvent = { kind: "tool", stage: "request", call: { id: "tc1", name: "bash", args: { cmd: "ls" } } } as any;
    expect(mapMyaEvent(e, state)).toEqual({ type: "tool_call", toolCallId: "tc1", name: "bash", args: { cmd: "ls" } });
  });

  it("tool result → tool_result", () => {
    const e: RuntimeEvent = { kind: "tool", stage: "result", result: { callId: "tc1", ok: true, output: "done" } } as any;
    expect(mapMyaEvent(e, state)).toEqual({ type: "tool_result", toolCallId: "tc1", output: "done", error: false });
  });

  it("tool result with error", () => {
    const e: RuntimeEvent = { kind: "tool", stage: "result", result: { callId: "tc1", ok: false, output: "fail", error: "broken" } } as any;
    const result = mapMyaEvent(e, state);
    expect(result?.type).toBe("tool_result");
    expect((result as any).error).toBe(true);
  });

  it("health event → null", () => {
    const e: RuntimeEvent = { kind: "health", component: "provider", status: "ok" } as any;
    expect(mapMyaEvent(e, state)).toBeNull();
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

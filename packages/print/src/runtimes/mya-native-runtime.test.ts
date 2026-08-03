import { describe, it, expect } from "vitest";
import { mapMyaEvent, MyaNativeRuntime } from "./mya-native.js";
import type { RuntimeEvent } from "@my-agent/core";

// These shapes match the ACTUAL event emission from packages/core/src/loop.ts:
// - emitTurn(te) → { kind: "turn", stage: "event", turnEvent: te }
// - emit({ kind: "turn", stage: "start" }) — bare envelope
// - emit({ kind: "turn", stage: "end" }) — bare envelope (no turnEvent)

describe("[unit] mapMyaEvent", () => {
  it("turn start (bare envelope) → null", () => {
    const e = { kind: "turn", stage: "start" };
    expect(mapMyaEvent(e as any, { tokensIn: 0, tokensOut: 0 })).toBeNull();
  });

  it("turn end (bare envelope, no turnEvent) → null", () => {
    const e = { kind: "turn", stage: "end" };
    expect(mapMyaEvent(e as any, { tokensIn: 0, tokensOut: 0 })).toBeNull();
  });

  it("Streaming text → text delta", () => {
    const e = { kind: "turn", stage: "event", turnEvent: { state: "Streaming", chunk: { kind: "text", text: "hello" } } };
    expect(mapMyaEvent(e as any, { tokensIn: 0, tokensOut: 0 })).toEqual({ type: "text", delta: "hello" });
  });

  it("Streaming error → error event with context.reason", () => {
    const e = { kind: "turn", stage: "event", turnEvent: { state: "Streaming", chunk: { kind: "error", error: { context: { reason: "provider timeout" }, recoverable: true } } } };
    expect(mapMyaEvent(e as any, { tokensIn: 0, tokensOut: 0 })).toEqual({ type: "error", message: "provider timeout", recoverable: true });
  });

  it("Completed → accumulates tokens, returns null", () => {
    const state = { tokensIn: 0, tokensOut: 0 };
    const e = { kind: "turn", stage: "event", turnEvent: { state: "Completed", usage: { input: 100, output: 50 }, cost: 0.01 } };
    expect(mapMyaEvent(e as any, state)).toBeNull();
    expect(state.tokensIn).toBe(100);
    expect(state.tokensOut).toBe(50);
  });

  it("Failed → error with context.reason", () => {
    const e = { kind: "turn", stage: "event", turnEvent: { state: "Failed", error: { context: { reason: "budget exhausted" }, recoverable: false } } };
    expect(mapMyaEvent(e as any, { tokensIn: 0, tokensOut: 0 })).toEqual({ type: "error", message: "budget exhausted", recoverable: false });
  });

  it("Recoverable → error with recoverable: true", () => {
    const e = { kind: "turn", stage: "event", turnEvent: { state: "Recoverable", error: { context: { reason: "rate limited" }, recoverable: true } } };
    expect(mapMyaEvent(e as any, { tokensIn: 0, tokensOut: 0 })).toEqual({ type: "error", message: "rate limited", recoverable: true });
  });

  it("Cancelled → error with reason", () => {
    const e = { kind: "turn", stage: "event", turnEvent: { state: "Cancelled", reason: "user aborted" } };
    expect(mapMyaEvent(e as any, { tokensIn: 0, tokensOut: 0 })).toEqual({ type: "error", message: "user aborted", recoverable: false });
  });

  it("ToolCalls → tool_call event", () => {
    const e = { kind: "turn", stage: "event", turnEvent: { state: "ToolCalls", calls: [{ id: "tc1", name: "bash", args: { cmd: "ls" } }] } };
    expect(mapMyaEvent(e as any, { tokensIn: 0, tokensOut: 0 })).toEqual({ type: "tool_call", toolCallId: "tc1", name: "bash", args: { cmd: "ls" } });
  });

  it("ToolExec → tool_result event", () => {
    const e = { kind: "turn", stage: "event", turnEvent: { state: "ToolExec", result: [{ callId: "tc1", ok: true, output: "done" }] } };
    expect(mapMyaEvent(e as any, { tokensIn: 0, tokensOut: 0 })).toEqual({ type: "tool_result", toolCallId: "tc1", output: "done", error: false });
  });

  it("ToolExec with failed result", () => {
    const e = { kind: "turn", stage: "event", turnEvent: { state: "ToolExec", result: [{ callId: "tc1", ok: false, output: "error" }] } };
    const result = mapMyaEvent(e as any, { tokensIn: 0, tokensOut: 0 });
    expect(result?.type).toBe("tool_result");
    expect((result as any).error).toBe(true);
  });

  it("health event → null", () => {
    const e = { kind: "health", component: "provider", status: "ok" };
    expect(mapMyaEvent(e as any, { tokensIn: 0, tokensOut: 0 })).toBeNull();
  });

  it("budget event → null", () => {
    const e = { kind: "budget", spentUsd: 0.5, remainingUsd: 9.5, exhausted: false };
    expect(mapMyaEvent(e as any, { tokensIn: 0, tokensOut: 0 })).toBeNull();
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

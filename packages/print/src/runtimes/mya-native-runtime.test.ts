import { describe, it, expect } from "vitest";
import { mapMyaEvent, MyaNativeRuntime } from "./mya-native.js";
import type { RuntimeEvent } from "@my-agent/core";

// These shapes match the ACTUAL event emission from packages/core/src/loop.ts

describe("[unit] mapMyaEvent", () => {
  const mkState = () => ({ tokensIn: 0, tokensOut: 0, costUsd: 0 });

  it("turn start (bare envelope) → empty array", () => {
    expect(mapMyaEvent({ kind: "turn", stage: "start" } as any, mkState())).toEqual([]);
  });

  it("turn end (bare envelope, no turnEvent) → empty array", () => {
    expect(mapMyaEvent({ kind: "turn", stage: "end" } as any, mkState())).toEqual([]);
  });

  it("Streaming text → [text delta]", () => {
    const e = { kind: "turn", stage: "event", turnEvent: { state: "Streaming", chunk: { kind: "text", text: "hello" } } };
    expect(mapMyaEvent(e as any, mkState())).toEqual([{ type: "text", delta: "hello" }]);
  });

  it("Streaming error → [error with context.reason]", () => {
    const e = { kind: "turn", stage: "event", turnEvent: { state: "Streaming", chunk: { kind: "error", error: { context: { reason: "provider timeout" }, recoverable: true } } } };
    expect(mapMyaEvent(e as any, mkState())).toEqual([{ type: "error", message: "provider timeout", recoverable: true }]);
  });

  it("Completed → accumulates tokens AND cost, returns empty", () => {
    const state = mkState();
    const e = { kind: "turn", stage: "event", turnEvent: { state: "Completed", usage: { input: 100, output: 50 }, cost: { usd: 0.02 } } };
    expect(mapMyaEvent(e as any, state)).toEqual([]);
    expect(state.tokensIn).toBe(100);
    expect(state.tokensOut).toBe(50);
    expect(state.costUsd).toBe(0.02);
  });

  it("Completed with no cost → cost stays 0", () => {
    const state = mkState();
    const e = { kind: "turn", stage: "event", turnEvent: { state: "Completed", usage: { input: 10, output: 5 } } };
    mapMyaEvent(e as any, state);
    expect(state.costUsd).toBe(0);
  });

  it("Failed → [error with context.reason]", () => {
    const e = { kind: "turn", stage: "event", turnEvent: { state: "Failed", error: { context: { reason: "budget exhausted" }, recoverable: false } } };
    expect(mapMyaEvent(e as any, mkState())).toEqual([{ type: "error", message: "budget exhausted", recoverable: false }]);
  });

  it("Recoverable → [error with recoverable: true]", () => {
    const e = { kind: "turn", stage: "event", turnEvent: { state: "Recoverable", error: { context: { reason: "rate limited" }, recoverable: true } } };
    expect(mapMyaEvent(e as any, mkState())).toEqual([{ type: "error", message: "rate limited", recoverable: true }]);
  });

  it("Cancelled → [error with reason]", () => {
    const e = { kind: "turn", stage: "event", turnEvent: { state: "Cancelled", reason: "user aborted" } };
    expect(mapMyaEvent(e as any, mkState())).toEqual([{ type: "error", message: "user aborted", recoverable: false }]);
  });

  it("ToolCalls with single call → [tool_call]", () => {
    const e = { kind: "turn", stage: "event", turnEvent: { state: "ToolCalls", calls: [{ id: "tc1", name: "bash", args: { cmd: "ls" } }] } };
    expect(mapMyaEvent(e as any, mkState())).toEqual([{ type: "tool_call", toolCallId: "tc1", name: "bash", args: { cmd: "ls" } }]);
  });

  it("ToolCalls with MULTIPLE calls → multiple tool_call events", () => {
    const e = { kind: "turn", stage: "event", turnEvent: { state: "ToolCalls", calls: [
      { id: "tc1", name: "bash", args: { cmd: "ls" } },
      { id: "tc2", name: "read", args: { path: "/tmp" } },
    ] } };
    const result = mapMyaEvent(e as any, mkState());
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ type: "tool_call", toolCallId: "tc1", name: "bash", args: { cmd: "ls" } });
    expect(result[1]).toEqual({ type: "tool_call", toolCallId: "tc2", name: "read", args: { path: "/tmp" } });
  });

  it("ToolExec with single result → [tool_result]", () => {
    const e = { kind: "turn", stage: "event", turnEvent: { state: "ToolExec", result: [{ callId: "tc1", ok: true, output: "done" }] } };
    expect(mapMyaEvent(e as any, mkState())).toEqual([{ type: "tool_result", toolCallId: "tc1", output: "done", error: false }]);
  });

  it("ToolExec with MULTIPLE results → multiple tool_result events", () => {
    const e = { kind: "turn", stage: "event", turnEvent: { state: "ToolExec", result: [
      { callId: "tc1", ok: true, output: "done" },
      { callId: "tc2", ok: false, output: "error" },
    ] } };
    const result = mapMyaEvent(e as any, mkState());
    expect(result).toHaveLength(2);
    expect(result[1]).toEqual({ type: "tool_result", toolCallId: "tc2", output: "error", error: true });
  });

  it("ToolExec with DegradedResult → maps .results array", () => {
    const e = { kind: "turn", stage: "event", turnEvent: { state: "ToolExec", result: { results: [{ callId: "tc1", ok: true, output: "ok" }] } } };
    expect(mapMyaEvent(e as any, mkState())).toEqual([{ type: "tool_result", toolCallId: "tc1", output: "ok", error: false }]);
  });

  it("AwaitingApproval → [tool_call]", () => {
    const e = { kind: "turn", stage: "event", turnEvent: { state: "AwaitingApproval", call: { id: "tc1", name: "dangerous_op", args: {} } } };
    expect(mapMyaEvent(e as any, mkState())).toEqual([{ type: "tool_call", toolCallId: "tc1", name: "dangerous_op", args: {} }]);
  });

  it("health event → empty array", () => {
    expect(mapMyaEvent({ kind: "health", component: "provider", status: "ok" } as any, mkState())).toEqual([]);
  });

  it("budget event → empty array", () => {
    expect(mapMyaEvent({ kind: "budget", spentUsd: 0.5, remainingUsd: 9.5, exhausted: false } as any, mkState())).toEqual([]);
  });

  it("log event → empty array", () => {
    expect(mapMyaEvent({ kind: "log", level: "info", message: "test" } as any, mkState())).toEqual([]);
  });

  it("lane event → empty array", () => {
    expect(mapMyaEvent({ kind: "lane", taskId: "t1", freshness: "Healthy", heartbeat: {} } as any, mkState())).toEqual([]);
  });

  it("approval event → empty array", () => {
    expect(mapMyaEvent({ kind: "approval", stage: "requested", call: {} } as any, mkState())).toEqual([]);
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

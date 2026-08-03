import { describe, it, expect } from "vitest";
import { createStubRouter, stubEnricher, stubCostTracker } from "./stubs.js";
import type { AgentRuntime } from "@my-agent/core";

function makeRuntime(name: string): AgentRuntime {
  return { runtimeType: name, displayName: name, isAvailable: () => true, async start() { return {} as any; }, async listModels() { return []; }, capabilities() { return {} as any; } };
}

describe("[unit] stubs", () => {
  it("createStubRouter returns pi by default", async () => {
    const runtimes = new Map([["pi", makeRuntime("pi")]]);
    const router = createStubRouter(runtimes);
    const { runtime, reason } = await router.select({ prompt: "hello" });
    expect(runtime.runtimeType).toBe("pi");
    expect(reason).toContain("stub");
  });

  it("createStubRouter respects agentOverride", async () => {
    const runtimes = new Map([["pi", makeRuntime("pi")], ["claude", makeRuntime("claude")]]);
    const router = createStubRouter(runtimes);
    const { runtime } = await router.select({ prompt: "", agentOverride: "claude" });
    expect(runtime.runtimeType).toBe("claude");
  });

  it("createStubRouter throws for unknown runtime", async () => {
    const router = createStubRouter(new Map());
    await expect(router.select({ prompt: "", agentOverride: "nonexistent" })).rejects.toThrow();
  });

  it("stubEnricher returns prompt unchanged", async () => {
    expect(await stubEnricher.enrich("hello", { sessionId: "s1", runtimeType: "pi", executionModel: "in-process" })).toBe("hello");
  });

  it("stubEnricher capture is no-op", async () => {
    await expect(stubEnricher.capture("text", { sessionId: "s1", runtimeType: "pi", executionModel: "in-process" })).resolves.toBeUndefined();
  });

  it("stubCostTracker record is no-op", () => {
    expect(() => stubCostTracker.record("s1", { type: "error", message: "test", recoverable: false })).not.toThrow();
  });

  it("stubCostTracker getSessionCost returns undefined", () => {
    expect(stubCostTracker.getSessionCost("s1")).toBeUndefined();
  });
});

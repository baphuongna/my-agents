import { describe, it, expect } from "vitest";
import { SmartRouterImpl } from "./router.js";
import type { AgentRuntime } from "@my-agent/core";

function makeRuntime(name: string, cost?: { input: number; output: number }): AgentRuntime {
  return {
    runtimeType: name, displayName: name, isAvailable: () => true,
    async start() { return {} as any; }, async listModels() { return []; },
    capabilities() { return {} as any; },
    ...(cost ? { costPerMTokens: () => cost } : {}),
  };
}

describe("[unit] SmartRouterImpl", () => {
  it("explicit override returns matching runtime", async () => {
    const runtimes = new Map([["pi", makeRuntime("pi")], ["claude", makeRuntime("claude")]]);
    const router = new SmartRouterImpl(runtimes);
    const { runtime, reason } = await router.select({ prompt: "hello", agentOverride: "claude" });
    expect(runtime.runtimeType).toBe("claude");
    expect(reason).toContain("override");
  });

  it("keyword match selects matching runtime", async () => {
    const runtimes = new Map([["pi", makeRuntime("pi")], ["claude", makeRuntime("claude")]]);
    const router = new SmartRouterImpl(runtimes);
    const { runtime } = await router.select({ prompt: "Use claude to analyze" });
    expect(runtime.runtimeType).toBe("claude");
  });

  it("no keyword match returns default runtime", async () => {
    const runtimes = new Map([["pi", makeRuntime("pi")], ["claude", makeRuntime("claude")]]);
    const router = new SmartRouterImpl(runtimes);
    const { runtime, reason } = await router.select({ prompt: "hello world" });
    expect(runtime.runtimeType).toBe("pi");
    expect(reason).toContain("default");
  });

  it("keyword uses word boundaries", async () => {
    const runtimes = new Map([["pi", makeRuntime("pi")], ["claude", makeRuntime("claude")]]);
    const router = new SmartRouterImpl(runtimes);
    // "claudia" should NOT match "claude" keyword
    const { runtime } = await router.select({ prompt: "Ask claudia about the project" });
    expect(runtime.runtimeType).toBe("pi"); // falls back to default
  });

  it("unavailable runtime is skipped", async () => {
    const runtimes = new Map([["pi", makeRuntime("pi")], ["claude", { ...makeRuntime("claude"), isAvailable: () => false }]]);
    const router = new SmartRouterImpl(runtimes);
    const { runtime } = await router.select({ prompt: "Use claude" });
    expect(runtime.runtimeType).toBe("pi");
  });

  it("throws when no runtime available", async () => {
    const router = new SmartRouterImpl(new Map());
    await expect(router.select({ prompt: "test" })).rejects.toThrow("No runtime");
  });

  it("custom keywords work", async () => {
    const runtimes = new Map([["pi", makeRuntime("pi")], ["custom", makeRuntime("custom")]]);
    const router = new SmartRouterImpl(runtimes, { customKeywords: new Map([["custom", ["special", "unique"]]]) });
    const { runtime } = await router.select({ prompt: "Do something special" });
    expect(runtime.runtimeType).toBe("custom");
  });
});

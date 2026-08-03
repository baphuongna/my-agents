// packages/print/src/runtimes/stubs.ts

import type {
  AgentRuntime, SmartRouter, PromptEnricher, CostTracker,
} from "@my-agent/core";

export function createStubRouter(runtimes: Map<string, AgentRuntime>): SmartRouter {
  return {
    async select(input) {
      const rt = runtimes.get(input.agentOverride ?? "pi");
      if (!rt) throw new Error(`No runtime available for "${input.agentOverride ?? "pi"}"`);
      return { runtime: rt, reason: "stub default" };
    },
  };
}

export const stubEnricher: PromptEnricher = {
  async enrich(prompt: string) { return prompt; },
  async capture() {},
};

export const stubCostTracker: CostTracker = {
  record() {},
  getSessionCost() { return undefined; },
};

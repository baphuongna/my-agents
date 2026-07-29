/**
 * F2 — per-subagent maxToolRounds (Hermes delegation.max_iterations port).
 *
 * Tier 1: a subagent gets a DISTINCT iteration cap (maxSubagentToolRounds) that
 * defaults to maxToolRounds when unset (default-identical). Verified behaviorally:
 * a looping provider (always requests a tool call) forces the subagent to run
 * until the cap is exhausted → runTurn fails "exceeded maxToolRounds (N)".
 */
import { describe, it, expect } from "vitest";
import { createAgent } from "./index.js";
import type { ProviderProfile, StreamEvent } from "@my-agent/core";
import type { ToolImpl } from "@my-agent/tools";

/** Provider that ALWAYS requests an "echo" tool call — forces the loop to run
 *  until maxToolRounds is exhausted. Unique call ids avoid idempotency dedup. */
function loopingProvider(): ProviderProfile {
  let n = 0;
  return {
    id: "loop",
    model: "loop-1",
    async stream(): Promise<{ events: StreamEvent[] }> {
      n++;
      return {
        events: [
          { kind: "tool_calls", calls: [{ id: `c${n}`, name: "echo", args: {} }] },
          { kind: "done", usage: { input: 1, output: 1 }, finish: "tool" },
        ],
      };
    },
    health(): "Healthy" { return "Healthy"; },
  };
}

const echoTool: ToolImpl = {
  meta: { name: "echo", args: { type: "object" as const, properties: {}, required: [] }, requiredMode: "ReadOnly" },
  async run() {
    return { callId: "echo", ok: true, output: "ok" };
  },
};

describe("F2 — per-subagent maxToolRounds (Hermes delegation.max_iterations port)", () => {
  it("subagent respects maxSubagentToolRounds override (not parent maxToolRounds)", async () => {
    const agent = createAgent({
      providers: [loopingProvider()],
      tools: [echoTool],
      maxToolRounds: 5,
      maxSubagentToolRounds: 2,
    });
    const sub = agent.spawnSubagent("loop forever");
    await sub.wait();
    expect(sub.status).toBe("failed");
    expect(sub.error).toContain("maxToolRounds");
    expect(sub.error).toContain("(2)"); // subagent cap, not parent's 5
  });

  it("subagent falls back to maxToolRounds when maxSubagentToolRounds unset (default-identical)", async () => {
    const agent = createAgent({
      providers: [loopingProvider()],
      tools: [echoTool],
      maxToolRounds: 3,
      // maxSubagentToolRounds unset → uses maxToolRounds (identical to pre-F2)
    });
    const sub = agent.spawnSubagent("loop forever");
    await sub.wait();
    expect(sub.status).toBe("failed");
    expect(sub.error).toContain("(3)");
  });
});

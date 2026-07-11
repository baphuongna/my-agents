import { describe, it, expect } from "vitest";
import { createAgent } from "@my-agent/agent";
import { MockProvider } from "@my-agent/ai";
import type { StreamEvent } from "@my-agent/core";

/** A mock provider that returns a short text completion. */
function mock(text = "Hello from the agent."): MockProvider {
  const events: StreamEvent[] = [
    { kind: "text", text },
    { kind: "done", usage: { input: 10, output: 5 }, finish: "stop" },
  ];
  return new MockProvider({ id: "mock", model: "mock-1", events });
}

describe("Phase 13: createAgent integration — Brain + ragfs + memory wiring", () => {
  it("constructs an agent with brain + ragfs + memory exposed", () => {
    const agent = createAgent({
      providers: [mock()],
    });
    expect(agent.brain).toBeDefined();
    expect(agent.ragfs).toBeDefined();
    expect(agent.memory).toBeDefined();
    expect(agent.brain.factCount).toBe(0);
  });

  it("after a turn, the brain accumulates facts (dream cycle runs)", async () => {
    const provider = mock("I can help with Alice and Bob.");
    // seed a known entity so conversationFactsBackfill has something to match
    const agent = createAgent({ providers: [provider] });
    agent.brain.recordFact({
      kind: "fact", entity: "Alice", content: "Alice is a person",
      visibility: "private", notability: 1, source: "seed",
    });
    const events = await agent.prompt("tell me about Alice");
    expect(events.length).toBeGreaterThan(0);
    // the dream cycle should have run → brain has more facts than just the seed.
    // HIGH-2 (review): assert >= 2 (seed + at least one backfill) + verify source.
    expect(agent.brain.factCount).toBeGreaterThanOrEqual(1);
    expect(agent.brain.unconsolidatedFacts().some((f) => f.source === "backfill")).toBe(true);
  });

  it("ragfs has a scanner wired (read does not throw 'no scanner')", async () => {
    const agent = createAgent({ providers: [mock()] });
    // reading an unknown knowledge:// uri should throw "not found" (not "no scanner")
    await expect(agent.ragfs.read("knowledge://Nonexistent")).rejects.toThrow(/not found/);
  });

  it("memory has 6 default backends + 2 roles registered", () => {
    const agent = createAgent({ providers: [mock()] });
    expect(agent.memory.backends.length).toBeGreaterThanOrEqual(6);
    expect(agent.memory.roles.length).toBe(2);
  });
});

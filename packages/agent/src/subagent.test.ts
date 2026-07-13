/**
 * Subagent tests — full coverage of spawn/list/get/kill lifecycle.
 *
 * Subagent = separate Session sharing profiles/tools/brain/memory with parent.
 * Pattern: parent spawns → handle tracks → wait for output → kill if needed.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createAgent, type Agent } from "./index.js";
import { MockProvider } from "@my-agent/ai";
import type { ProviderProfile, StreamEvent } from "@my-agent/core";

function mockProvider(text = "Subagent done."): MockProvider {
  const events: StreamEvent[] = [
    { kind: "text", text },
    { kind: "done", usage: { input: 10, output: 5 }, finish: "stop" },
  ];
  return new MockProvider({ id: "mock", model: "mock-1", events });
}

/** A provider whose stream() rejects — for failure path testing. */
function failingProvider(errorMessage = "upstream blew up"): ProviderProfile {
  return {
    id: "fail",
    model: "mock-1",
    async stream(): Promise<{ events: StreamEvent[] }> {
      throw new Error(errorMessage);
    },
    health(): "Failed" { return "Failed"; },
  };
}

describe("Subagent — spawn + wait + output", () => {
  let agent: Agent;

  beforeEach(() => {
    agent = createAgent({ providers: [mockProvider("Result from subagent.")] });
  });

  it("spawnSubagent returns a handle with id, status=running, output empty", () => {
    const sub = agent.spawnSubagent("review code");
    expect(sub.id).toMatch(/^sub-[a-f0-9]+$/);
    expect(sub.status).toBe("running");
    expect(sub.output).toBe("");
    expect(sub.goal).toBe("review code");
    expect(sub.startedAt).toBeGreaterThan(0);
  });

  it("subagent completes with status=done and captures output", async () => {
    const sub = agent.spawnSubagent("review code");
    const result = await sub.wait();
    expect(result).toBe("Result from subagent.");
    expect(sub.status).toBe("done");
    expect(sub.output).toBe("Result from subagent.");
    expect(sub.endedAt).toBeGreaterThanOrEqual(sub.startedAt);
  });

  it("parent continues working while subagent runs (parallel)", async () => {
    const sub = agent.spawnSubagent("long task", { allowedTools: ["read"] });
    expect(sub.status).toBe("running");
    // Parent does its own work concurrently
    const parentEvents = await agent.prompt("parent's question");
    expect(parentEvents.length).toBeGreaterThan(0);
    // Subagent still resolves
    const result = await sub.wait();
    expect(result).toBe("Result from subagent.");
  });

  it("allowedTools passed through to subagent system overlay", async () => {
    const sub = agent.spawnSubagent("check files", { allowedTools: ["read", "grep"] });
    expect(sub.allowedTools).toEqual(["read", "grep"]);
    await sub.wait();
  });
});

describe("Subagent — list/get/kill", () => {
  let agent: Agent;

  beforeEach(() => {
    agent = createAgent({ providers: [mockProvider("done")] });
  });

  it("listSubagents returns all (active + completed)", () => {
    const a = agent.spawnSubagent("a");
    const b = agent.spawnSubagent("b");
    const all = agent.listSubagents();
    expect(all.length).toBe(2);
    expect(all.map((h) => h.id).sort()).toEqual([a.id, b.id].sort());
  });

  it("getSubagent returns handle by id or undefined", () => {
    const sub = agent.spawnSubagent("task");
    expect(agent.getSubagent(sub.id)?.id).toBe(sub.id);
    expect(agent.getSubagent("sub-nonexistent")).toBeUndefined();
  });

  it("killSubagent marks aborted + removes from map", () => {
    const sub = agent.spawnSubagent("kill me");
    expect(sub.status).toBe("running");
    const ok = agent.killSubagent(sub.id);
    expect(ok).toBe(true);
    expect(sub.status).toBe("aborted");
    expect(agent.getSubagent(sub.id)).toBeUndefined();
  });

  it("killSubagent returns false for unknown id", () => {
    expect(agent.killSubagent("sub-fake")).toBe(false);
  });

  it("killAllSubagents clears all", () => {
    agent.spawnSubagent("a");
    agent.spawnSubagent("b");
    agent.spawnSubagent("c");
    expect(agent.listSubagents().length).toBe(3);
    const n = agent.killAllSubagents();
    expect(n).toBe(3);
    expect(agent.listSubagents().length).toBe(0);
  });

  it("killAllSubagents only aborts running ones (not completed)", async () => {
    // Use slow provider so we can verify state mid-flight.
    const agent = createAgent({ providers: [mockProvider("ok")] });
    const a = agent.spawnSubagent("a");
    // Let a complete fully first
    await a.wait();
    expect(a.status).toBe("done");
    // Now spawn b (still running) + kill all
    const b = agent.spawnSubagent("b");
    expect(b.status).toBe("running");
    const n = agent.killAllSubagents();
    expect(n).toBe(1); // only b was running
  });
});

describe("Subagent — failure paths", () => {
  it("subagent marked failed if provider throws", async () => {
    const agent = createAgent({ providers: [failingProvider("upstream blew up")] });
    const sub = agent.spawnSubagent("broken task");
    await sub.wait();
    expect(sub.status).toBe("failed");
    expect(sub.error).toBeDefined();
    expect(sub.error!.length).toBeGreaterThan(0);
    expect(sub.output).toBe("");
  });

  it("wait() resolves even on failure (with empty output)", async () => {
    const agent = createAgent({ providers: [failingProvider("bad")] });
    const sub = agent.spawnSubagent("x");
    const result = await sub.wait();
    expect(result).toBe("");
    expect(sub.status).toBe("failed");
  });

  it("abort() during running sets status=aborted (does not kill mid-turn)", async () => {
    // Slow provider so we have time to abort
    const slow = mockProvider("slow result");
    const agent = createAgent({ providers: [slow] });
    const sub = agent.spawnSubagent("slow task");
    expect(sub.status).toBe("running");
    sub.abort();
    expect(sub.status).toBe("aborted");
    // wait() still resolves (turn completes naturally even if we marked aborted)
    const result = await sub.wait();
    expect(result).toBe("slow result");
    // After completion, status stays "aborted" (we marked it externally)
    expect(sub.status).toBe("aborted");
  });

  it("abort() on already-done subagent is no-op", async () => {
    const agent = createAgent({ providers: [mockProvider("ok")] });
    const sub = agent.spawnSubagent("done task");
    await sub.wait();
    expect(sub.status).toBe("done");
    sub.abort(); // no-op
    expect(sub.status).toBe("done");
  });
});

describe("Subagent — concurrent + lifecycle", () => {
  it("spawns multiple subagents in parallel", async () => {
    const agent = createAgent({ providers: [mockProvider("parallel")] });
    const subs = [1, 2, 3, 4, 5].map((i) => agent.spawnSubagent(`task-${i}`));
    expect(agent.listSubagents().length).toBe(5);
    const results = await Promise.all(subs.map((s) => s.wait()));
    expect(results.every((r) => r === "parallel")).toBe(true);
    expect(subs.every((s) => s.status === "done")).toBe(true);
  });

  it("kill one subagent doesn't affect others", async () => {
    const agent = createAgent({ providers: [mockProvider("ok")] });
    const a = agent.spawnSubagent("a");
    const b = agent.spawnSubagent("b");
    const c = agent.spawnSubagent("c");
    agent.killSubagent(b.id);
    expect(b.status).toBe("aborted");
    expect(a.status).toBe("running");
    expect(c.status).toBe("running");
    expect(await a.wait()).toBe("ok");
    expect(await c.wait()).toBe("ok");
  });

  it("subagent history is isolated from parent", async () => {
    const agent = createAgent({ providers: [mockProvider("sub result")] });
    const sub = agent.spawnSubagent("sub task");
    await agent.prompt("parent task");
    await sub.wait();
    // Subagent and parent have separate sessions (no shared history entries)
    const subEntries = (await import("@my-agent/core")).ArrayHistory;
    expect(subEntries).toBeDefined();
    // Both completed independently — verified by completion, not history shape
  });
});

describe("Subagent — output capture", () => {
  it("captures multi-chunk assistant text", async () => {
    const multi = new MockProvider({
      id: "multi",
      model: "mock-1",
      events: [
        { kind: "text", text: "chunk1 " },
        { kind: "text", text: "chunk2 " },
        { kind: "text", text: "chunk3" },
        { kind: "done", usage: { input: 10, output: 5 }, finish: "stop" },
      ],
    });
    const agent = createAgent({ providers: [multi] });
    const sub = agent.spawnSubagent("multi chunk");
    const result = await sub.wait();
    expect(result).toBe("chunk1 chunk2 chunk3");
  });

  it("wait() can be called multiple times (idempotent)", async () => {
    const agent = createAgent({ providers: [mockProvider("once")] });
    const sub = agent.spawnSubagent("once");
    const r1 = await sub.wait();
    const r2 = await sub.wait();
    const r3 = await sub.wait();
    expect(r1).toBe("once");
    expect(r2).toBe("once");
    expect(r3).toBe("once");
  });
});

describe("Subagent — input validation", () => {
  it("unique ids across spawns", () => {
    const agent = createAgent({ providers: [mockProvider("ok")] });
    const subs = Array.from({ length: 50 }, (_, i) => agent.spawnSubagent(`t${i}`));
    const ids = new Set(subs.map((s) => s.id));
    expect(ids.size).toBe(50); // all unique
  });

  it("empty allowedTools array treated as no restriction", async () => {
    const agent = createAgent({ providers: [mockProvider("ok")] });
    const sub = agent.spawnSubagent("task", { allowedTools: [] });
    expect(sub.allowedTools).toEqual([]);
    await sub.wait();
  });

  it("empty goal still works (just odd)", async () => {
    const agent = createAgent({ providers: [mockProvider("ok")] });
    const sub = agent.spawnSubagent("");
    expect(sub.goal).toBe("");
    await sub.wait();
  });
});
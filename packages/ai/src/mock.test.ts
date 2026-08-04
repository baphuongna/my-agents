import { describe, it, expect } from "vitest";
import { MockProvider, textMock, type MockTrace } from "./mock.js";
import type { StreamEvent } from "@my-agent/core";

describe("[unit] ai MockProvider", () => {
  it("stream replays events from trace (deterministic)", async () => {
    const trace: MockTrace = {
      id: "test",
      model: "mock-model",
      events: [{ kind: "text", text: "hello" }, { kind: "done", usage: { input: 5, output: 3 } }],
    };
    const p = new MockProvider(trace);
    const { events } = await p.stream({} as never, [] as never);
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ kind: "text", text: "hello" });
    // Identical input → identical output (copies, not same ref)
    const { events: e2 } = await p.stream({} as never, [] as never);
    expect(e2).toEqual(events);
    expect(e2).not.toBe(events);
  });

  it("id + model from trace", () => {
    const p = new MockProvider({ id: "my-id", model: "my-model", events: [] });
    expect(p.id).toBe("my-id");
    expect(p.model).toBe("my-model");
  });

  it("health() returns Healthy", () => {
    expect(new MockProvider({ id: "x", model: "y", events: [] }).health()).toBe("Healthy");
  });

  it("textMock convenience: single text + done", async () => {
    const p = textMock("pong", "test-model");
    expect(p.model).toBe("test-model");
    const { events } = await p.stream({} as never, [] as never);
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ kind: "text", text: "pong" });
    expect(events[1]?.kind).toBe("done");
    expect((events[1] as Extract<StreamEvent, { kind: "done" }>).usage).toEqual({ input: 1, output: 1 });
  });

  it("textMock default usage {input:1, output:1}", async () => {
    const p = textMock("x");
    const { events } = await p.stream({} as never, [] as never);
    const done = events.find(e => e.kind === "done") as Extract<StreamEvent, { kind: "done" }>;
    expect(done.usage).toEqual({ input: 1, output: 1 });
  });

  it("textMock custom usage", async () => {
    const p = textMock("x", "m", { input: 100, output: 200 });
    const { events } = await p.stream({} as never, [] as never);
    const done = events.find(e => e.kind === "done") as Extract<StreamEvent, { kind: "done" }>;
    expect(done.usage).toEqual({ input: 100, output: 200 });
  });
});

import { describe, it, expect } from "vitest";
import { runTurn, createBudget, freeBudget } from "@my-agent/core";
import type { StreamEvent, ToolExecutor, ToolCall, ToolResult, Session, LifecycleError } from "@my-agent/core";

/** Build a minimal session with a scripted stream. */
function makeSession(stream: (round: number) => Promise<{ events: StreamEvent[] } | { error: LifecycleError }>): {
  session: Session;
  streamFn: Parameters<typeof runTurn>[0]["stream"];
  round: { value: number };
} {
  const round = { value: 0 };
  const history: unknown[] = [];
  const session: Session = {
    profiles: [],
    stableTier: "stable",
    ctxFiles: [],
    memory: { snapshot: () => ({ entries: [], generatedDay: 0 }), query: async () => [] } as never,
    userMd: "volatile",
    history: { append: (e: unknown) => void history.push(e) } as never,
    skillSetDirty: false,
  } as unknown as Session;
  const streamFn = async () => {
    round.value += 1;
    return stream(round.value);
  };
  return { session, streamFn, round };
}

const doneWith = (usage = { input: 10, output: 5 }): StreamEvent[] => [{ kind: "done", usage, finish: "stop" }];

describe("runTurn FSM — bounded retry + length→compress + Recoverable (§4)", () => {
  it("completes a no-tool turn with cost spent", async () => {
    const { session, streamFn } = makeSession(async () => ({ events: [...doneWith({ input: 1000, output: 500 })] }));
    const budget = createBudget({ total: 100 });
    const h = runTurn({ session, budget, stream: streamFn, model: "gpt-4o-mini" });
    const terminal = await h.done;
    expect(terminal.state).toBe("Completed");
    if (terminal.state === "Completed") {
      expect(terminal.cost.usd).toBeGreaterThan(0); // real cost, not zero
      expect(terminal.cost.usd).toBeLessThan(100);
    }
  });

  it("retries a recoverable stream error, then succeeds (bounded retry)", async () => {
    let calls = 0;
    const { session, streamFn } = makeSession(async () => {
      calls++;
      if (calls < 3) {
        return { error: { phase: "stream", recoverable: true, retries: calls, context: {} } };
      }
      return { events: doneWith() };
    });
    const h = runTurn({ session, budget: freeBudget(), stream: streamFn });
    const t = await h.done;
    expect(t.state).toBe("Completed");
    expect(calls).toBe(3); // 2 recoverable failures retried, 3rd succeeded
  });

  it("escalates to Failed at the retry cap (MAX_ATTEMPTS=3)", async () => {
    const { session, streamFn } = makeSession(async () => ({
      error: { phase: "stream", recoverable: true, retries: 0, context: {} },
    }));
    const h = runTurn({ session, budget: freeBudget(), stream: streamFn });
    const t = await h.done;
    expect(t.state).toBe("Failed");
    if (t.state === "Failed") expect(t.error.retries).toBe(2); // cap = MAX_ATTEMPTS-1
  });

  it("non-recoverable error → immediate Failed (no retry)", async () => {
    let calls = 0;
    const { session, streamFn } = makeSession(async () => {
      calls++;
      return { error: { phase: "auth", recoverable: false, retries: 0, context: {} } };
    });
    const h = runTurn({ session, budget: freeBudget(), stream: streamFn });
    const t = await h.done;
    expect(t.state).toBe("Failed");
    expect(calls).toBe(1);
  });

  it("finish:\"length\" triggers compressHistory then retries", async () => {
    let calls = 0;
    const { session, streamFn } = makeSession(async () => {
      calls++;
      if (calls === 1) return { events: [{ kind: "done", usage: { input: 10, output: 5 }, finish: "length" }] };
      return { events: doneWith() };
    });
    let compressed = 0;
    const h = runTurn({
      session, budget: freeBudget(), stream: streamFn,
      compressHistory: () => { compressed++; },
    });
    const t = await h.done;
    expect(t.state).toBe("Completed");
    expect(compressed).toBe(1); // compression ran on the length-stop
    expect(calls).toBe(2);
  });

  it("compressHistory ResourceExhausted → Recoverable{phase:resource}", async () => {
    const { session, streamFn } = makeSession(async () => ({
      events: [{ kind: "done", usage: { input: 10, output: 5 }, finish: "length" }],
    }));
    const events: string[] = [];
    const h = runTurn({
      session, budget: freeBudget(), stream: streamFn,
      compressHistory: () => { throw new Error("disk full"); },
    });
    h.on((e) => { if (e.kind === "turn" && e.stage === "event" && e.turnEvent) events.push(e.turnEvent.state); });
    const t = await h.done;
    expect(t.state).toBe("Failed");
    if (t.state === "Failed") expect(t.error.phase).toBe("resource");
    expect(events).toContain("Recoverable");
  });

  it("tool calls execute via the injected executor + loop back", async () => {
    let calls = 0;
    const { session, streamFn } = makeSession(async () => {
      calls++;
      if (calls === 1) return { events: [{ kind: "tool_calls", calls: [{ id: "t1", name: "read", args: {} }] }, ...doneWith({ input: 5, output: 5 })] };
      return { events: doneWith() };
    });
    const executor: ToolExecutor = {
      async execute(cs: ToolCall[]): Promise<ToolResult[]> {
        return cs.map((c) => ({ callId: c.id, ok: true, output: "ok" }));
      },
    };
    const h = runTurn({ session, budget: freeBudget(), stream: streamFn, tools: executor });
    const t = await h.done;
    expect(t.state).toBe("Completed");
    expect(calls).toBe(2); // tool round + final round
  });

  it("idempotency: a re-emitted tool id is NOT re-executed", async () => {
    let execCount = 0;
    let calls = 0;
    const { session, streamFn } = makeSession(async () => {
      calls++;
      // round 1 + round 2 both emit the SAME tool id; round 3 completes
      if (calls <= 2) return { events: [{ kind: "tool_calls", calls: [{ id: "same-id", name: "read", args: {} }] }, ...doneWith({ input: 1, output: 1 })] };
      return { events: doneWith() };
    });
    const executor: ToolExecutor = {
      async execute(cs: ToolCall[]) { execCount += cs.length; return cs.map((c) => ({ callId: c.id, ok: true, output: null })); },
    };
    const h = runTurn({ session, budget: freeBudget(), stream: streamFn, tools: executor });
    await h.done;
    expect(execCount).toBe(1); // "same-id" executed once, deduped on round 2
  });

  it("budget gate aborts before stream when exhausted", async () => {
    const { session, streamFn } = makeSession(async () => ({ events: doneWith() }));
    const budget = createBudget({ total: 1, abortThreshold: 1 });
    budget.spend({ usd: 1 }); // exhaust
    const h = runTurn({ session, budget, stream: streamFn });
    const t = await h.done;
    expect(t.state).toBe("Failed");
  });
});

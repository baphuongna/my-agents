/**
 * Item 16 — checkIdleOnTurnStart idle-compaction hook tests.
 *
 * These import `runTurn` via a RELATIVE source path (`./loop.js`) so they
 * always exercise the in-tree source, independent of whether the package's
 * `dist` build is fresh (the `@my-agent/core` bare specifier may resolve to a
 * stale `dist`). This keeps the new-behavior coverage stable.
 */
import { describe, it, expect } from "vitest";
// Relative imports → resolved against in-tree source (./loop.ts, ./budget.ts).
import { runTurn } from "./loop.js";
import { createBudget, freeBudget } from "./budget.js";
import type {
  StreamEvent,
  Session,
  LifecycleError,
  TurnContext,
} from "./types.js";

/** Minimal session with a scripted stream + a real history array. */
function makeSession(
  stream: (round: number) => Promise<{ events: StreamEvent[] } | { error: LifecycleError }>,
): {
  session: Session;
  streamFn: NonNullable<Parameters<typeof runTurn>[0]["stream"]>;
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
  const streamFn: NonNullable<Parameters<typeof runTurn>[0]["stream"]> = async () => {
    round.value += 1;
    return stream(round.value);
  };
  return { session, streamFn, round };
}

const doneWith = (usage = { input: 10, output: 5 }): StreamEvent[] => [
  { kind: "done", usage, finish: "stop" },
];

describe("runTurn — checkIdleOnTurnStart idle-compaction hook (Item 16)", () => {
  it("default agent (no checkIdleOnTurnStart) runs no idle compression and completes", async () => {
    const { session, streamFn } = makeSession(async () => ({ events: doneWith() }));
    let compressed = 0;
    const h = runTurn({
      session, budget: freeBudget(), stream: streamFn,
      compressHistory: () => { compressed++; },
    });
    const t = await h.done;
    expect(t.state).toBe("Completed");
    expect(compressed).toBe(0); // no length-stop + no idle trigger → never called
  });

  it("checkIdleOnTurnStart returning true runs compressHistory once at turn start", async () => {
    const { session, streamFn } = makeSession(async () => ({ events: doneWith() }));
    const calls: number[] = [];
    const h = runTurn({
      session, budget: freeBudget(), stream: streamFn,
      checkIdleOnTurnStart: () => true,
      compressHistory: () => { calls.push(1); },
    });
    const t = await h.done;
    expect(t.state).toBe("Completed");
    expect(calls.length).toBe(1); // idle compression fired exactly once at turn start
  });

  it("checkIdleOnTurnStart returning false is a no-op (no compression)", async () => {
    const { session, streamFn } = makeSession(async () => ({ events: doneWith() }));
    let compressed = 0;
    const h = runTurn({
      session, budget: freeBudget(), stream: streamFn,
      checkIdleOnTurnStart: () => false,
      compressHistory: () => { compressed++; },
    });
    const t = await h.done;
    expect(t.state).toBe("Completed");
    expect(compressed).toBe(0); // predicate false → compression never runs
  });

  it("callback receives the session history + a TurnContext with expected fields", async () => {
    const { session, streamFn } = makeSession(async () => ({ events: doneWith() }));
    let receivedHistory: unknown = null;
    let receivedCtx: TurnContext | null = null;
    const h = runTurn({
      session, budget: freeBudget(), stream: streamFn,
      checkIdleOnTurnStart: (history, ctx) => {
        receivedHistory = history;
        receivedCtx = ctx;
        return false;
      },
    });
    await h.done;
    expect(receivedHistory).toBe(session.history); // the session's history object
    expect(receivedCtx).not.toBeNull();
    const ctx = receivedCtx!;
    expect(ctx.session).toBe(session);
    expect(ctx.history).toBe(session.history);
    expect(typeof ctx.emit).toBe("function");
    expect(ctx.budget).toBeDefined();
  });

  it("compressHistory throwing inside the idle path → Recoverable{resource}", async () => {
    const { session, streamFn } = makeSession(async () => ({ events: doneWith() }));
    const states: string[] = [];
    const h = runTurn({
      session, budget: freeBudget(), stream: streamFn,
      checkIdleOnTurnStart: () => true,
      compressHistory: () => { throw new Error("idle summary failed"); },
    });
    h.on((e) => {
      if (e.kind === "turn" && e.stage === "event" && e.turnEvent) states.push(e.turnEvent.state);
    });
    const t = await h.done;
    expect(t.state).toBe("Failed");
    if (t.state === "Failed") expect(t.error.phase).toBe("resource");
    expect(states).toContain("Recoverable");
  });

  it("idle compaction + a subsequent length-stop both run compressHistory", async () => {
    // Round 1: idle fires at start (compress #1), then stream returns length-stop
    // → compress #2 (CC1), then round-2 stream completes.
    let streamCalls = 0;
    const { session, streamFn } = makeSession(async () => {
      streamCalls++;
      if (streamCalls === 1) {
        return { events: [{ kind: "done", usage: { input: 10, output: 5 }, finish: "length" }] };
      }
      return { events: doneWith() };
    });
    const calls: number[] = [];
    const h = runTurn({
      session, budget: freeBudget(), stream: streamFn,
      checkIdleOnTurnStart: () => true,
      compressHistory: () => { calls.push(1); },
    });
    const t = await h.done;
    expect(t.state).toBe("Completed");
    expect(calls.length).toBe(2); // 1 idle (turn start) + 1 length-stop
  });
});

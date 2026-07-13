import { describe, it, expect } from "vitest";
import { SessionPromptQueue } from "./session-queue.js";

/**
 * Regression tests for the gateway per-session prompt queue.
 *
 * Background (commit 83757b7 — 2026-07-13): two concurrent prompts on the
 * same session caused session.prompt() to throw "Agent is already
 * processing a prompt" → unhandled rejection → gateway process died.
 *
 * These tests pin the contract of SessionPromptQueue that prevents that.
 */
describe("SessionPromptQueue — per-key serialization", () => {
  it("runs calls for the same key sequentially, not in parallel", async () => {
    const q = new SessionPromptQueue();
    const order: string[] = [];
    let active = 0;
    let maxActive = 0;

    const make = (tag: string, ms: number) => async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      order.push(`${tag}:start`);
      await new Promise((r) => setTimeout(r, ms));
      order.push(`${tag}:end`);
      active--;
      return tag;
    };

    // Fire two for "s1" back-to-back; second must wait for first.
    const p1 = q.run("s1", make("A", 30));
    const p2 = q.run("s1", make("B", 5));

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe("A");
    expect(r2).toBe("B");
    expect(maxActive).toBe(1); // critical: never >1 for same key
    expect(order).toEqual(["A:start", "A:end", "B:start", "B:end"]);
    expect(q.size()).toBe(0); // cleaned up
  });

  it("runs calls for different keys in parallel", async () => {
    const q = new SessionPromptQueue();
    let active = 0;
    let maxActive = 0;
    const work = async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 20));
      active--;
    };

    await Promise.all([q.run("a", work), q.run("b", work), q.run("c", work)]);
    expect(maxActive).toBe(3); // all 3 ran concurrently
    expect(q.size()).toBe(0);
  });

  it("preserves submission order within a key", async () => {
    const q = new SessionPromptQueue();
    const seen: number[] = [];
    // Even though call #2 is faster, it must run after #1.
    await Promise.all([
      q.run("k", async () => { await new Promise((r) => setTimeout(r, 30)); seen.push(1); }),
      q.run("k", async () => { seen.push(2); }),
      q.run("k", async () => { seen.push(3); }),
    ]);
    expect(seen).toEqual([1, 2, 3]);
  });

  it("clears the chain entry after completion so next call is independent", async () => {
    const q = new SessionPromptQueue();
    await q.run("k", async () => "first");
    expect(q.has("k")).toBe(false);
    const r = await q.run("k", async () => "second");
    expect(r).toBe("second");
  });

  it("clears the chain entry even after a failure", async () => {
    const q = new SessionPromptQueue();
    await expect(q.run("k", async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(q.has("k")).toBe(false);
    // Next call must work — the failure must not poison the chain.
    const r = await q.run("k", async () => "recovered");
    expect(r).toBe("recovered");
  });

  it("propagates errors to the caller while letting subsequent calls proceed", async () => {
    const q = new SessionPromptQueue();
    const results = await Promise.allSettled([
      q.run("k", async () => { throw new Error("first fails"); }),
      q.run("k", async () => "second ok"),
      q.run("k", async () => "third ok"),
    ]);
    expect(results[0]).toMatchObject({ status: "rejected", reason: { message: "first fails" } });
    expect(results[1]).toMatchObject({ status: "fulfilled", value: "second ok" });
    expect(results[2]).toMatchObject({ status: "fulfilled", value: "third ok" });
  });

  it("self-cleans even when caller never awaits", async () => {
    // Fire-and-forget callers (e.g. WS broadcast) MUST attach their own .catch.
    // The queue's contract is serialization, not unhandled-rejection guarding
    // (that's the defense-in-depth handler in main.ts). This test just verifies
    // the queue still self-cleans when nobody awaits.
    const q = new SessionPromptQueue();
    void q.run("k", async () => "no-await");
    await new Promise((r) => setTimeout(r, 0));
    expect(q.has("k")).toBe(false);
  });
});

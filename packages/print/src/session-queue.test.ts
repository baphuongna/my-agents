/**
 * SessionPromptQueue tests — Phase 1 backpressure.
 */
import { describe, it, expect } from "vitest";
import { SessionPromptQueue, QueueFullError, QueueTimeoutError } from "./session-queue.js";

describe("SessionPromptQueue — basic serialization", () => {
  it("serializes same session", async () => {
    const q = new SessionPromptQueue();
    const order: string[] = [];
    const p1 = q.run("s1", async () => { order.push("a-start"); await sleep(50); order.push("a-end"); return "a"; });
    const p2 = q.run("s1", async () => { order.push("b-start"); await sleep(10); order.push("b-end"); return "b"; });
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe("a");
    expect(r2).toBe("b");
    expect(order).toEqual(["a-start", "a-end", "b-start", "b-end"]);
  });

  it("parallel different sessions", async () => {
    const q = new SessionPromptQueue();
    const start = Date.now();
    await Promise.all([
      q.run("s1", async () => { await sleep(30); }),
      q.run("s2", async () => { await sleep(30); }),
    ]);
    const elapsed = Date.now() - start;
    // Allow up to 100ms total (would be ~60ms if parallel, ~120ms if serialized)
    expect(elapsed).toBeLessThan(100);
  });
});

describe("SessionPromptQueue — depth tracking", () => {
  it("depth tracks pending+active", async () => {
    const q = new SessionPromptQueue({ maxQueueDepth: 4 });
    expect(q.depth("s1")).toBe(0);
    const blocker = q.run("s1", async () => { await sleep(30); });
    expect(q.depth("s1")).toBe(1);  // active
    q.run("s1", async () => { await sleep(10); });
    expect(q.depth("s1")).toBe(2);  // active + queued
    await blocker;
  });

  it("depth=0 when no pending", () => {
    const q = new SessionPromptQueue();
    expect(q.depth("nonexistent")).toBe(0);
  });
});

describe("SessionPromptQueue — backpressure (maxQueueDepth)", () => {
  it("rejects when depth >= maxQueueDepth", async () => {
    const q = new SessionPromptQueue({ maxQueueDepth: 2 });
    const p1 = q.run("s1", async () => { await sleep(50); });
    const p2 = q.run("s1", async () => { await sleep(50); });
    await expect(q.run("s1", async () => "x")).rejects.toThrow(QueueFullError);
    await Promise.all([p1, p2]);
  });

  it("QueueFullError has metadata", async () => {
    const q = new SessionPromptQueue({ maxQueueDepth: 1 });
    const blocker = q.run("s1", async () => { await sleep(20); });
    try {
      await q.run("s1", async () => "x");
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(QueueFullError);
      const err = e as QueueFullError;
      expect(err.sessionId).toBe("s1");
      expect(err.maxDepth).toBe(1);
      expect(err.depth).toBeGreaterThanOrEqual(1);
    }
    await blocker;
  });

  it("different sessions have independent depths", async () => {
    const q = new SessionPromptQueue({ maxQueueDepth: 1 });
    const p1 = q.run("s1", async () => { await sleep(20); });
    const p2 = q.run("s2", async () => { await sleep(20); });
    await Promise.all([p1, p2]);
    // Both should complete — different sessions
  });
});

describe("SessionPromptQueue — timeout (queueTimeoutMs)", () => {
  it("rejects with QueueTimeoutError if too slow", async () => {
    const q = new SessionPromptQueue({ queueTimeoutMs: 50 });
    await expect(
      q.run("s1", async () => { await sleep(200); return "never"; })
    ).rejects.toThrow(QueueTimeoutError);
  });

  it("completes if within timeout", async () => {
    const q = new SessionPromptQueue({ queueTimeoutMs: 200 });
    const r = await q.run("s1", async () => { await sleep(20); return "ok"; });
    expect(r).toBe("ok");
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

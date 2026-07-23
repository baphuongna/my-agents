import { describe, it, expect } from "vitest";
import {
  classifyCompletionTarget,
  DurableAckTracker,
  type CompletionSession,
} from "./durable-ack.js";

// ─── classifyCompletionTarget (deep-dive.md §6.4) ────────────────────────────

describe("classifyCompletionTarget", () => {
  it("returns 'terminal' when the parent session is gone (null)", () => {
    expect(classifyCompletionTarget(null)).toBe("terminal");
  });

  it("returns 'deliver' when the parent is live (no endedAt)", () => {
    const parent: CompletionSession = { id: "s1" };
    expect(classifyCompletionTarget(parent)).toBe("deliver");
  });

  it("returns 'deliver' when the parent is live (endedAt is null)", () => {
    const parent: CompletionSession = { id: "s1", endedAt: null };
    expect(classifyCompletionTarget(parent)).toBe("deliver");
  });

  it("returns 'terminal' when the parent ended with a non-compression reason", () => {
    const parent: CompletionSession = { id: "s1", endedAt: 1000, endReason: "user" };
    expect(classifyCompletionTarget(parent)).toBe("terminal");
  });

  it("returns 'terminal' when the parent ended with no reason", () => {
    const parent: CompletionSession = { id: "s1", endedAt: 1000 };
    expect(classifyCompletionTarget(parent)).toBe("terminal");
  });

  it("returns 'retry' when compression-ended parent has no tip", () => {
    const parent: CompletionSession = { id: "s1", endedAt: 1000, endReason: "compression" };
    expect(classifyCompletionTarget(parent, null)).toBe("retry");
    expect(classifyCompletionTarget(parent, undefined)).toBe("retry");
  });

  it("returns 'retry' when the tip has also ended", () => {
    const parent: CompletionSession = { id: "s1", endedAt: 1000, endReason: "compression" };
    const tip: CompletionSession = { id: "s2", endedAt: 2000 };
    expect(classifyCompletionTarget(parent, tip)).toBe("retry");
  });

  it("returns 'deliver' when the tip is live", () => {
    const parent: CompletionSession = { id: "s1", endedAt: 1000, endReason: "compression" };
    const tip: CompletionSession = { id: "s2" };
    expect(classifyCompletionTarget(parent, tip)).toBe("deliver");
  });

  it("returns 'deliver' when the tip is live (endedAt null)", () => {
    const parent: CompletionSession = { id: "s1", endedAt: 1000, endReason: "compression" };
    const tip: CompletionSession = { id: "s2", endedAt: null };
    expect(classifyCompletionTarget(parent, tip)).toBe("deliver");
  });
});

// ─── DurableAckTracker ────────────────────────────────────────────────────────

describe("DurableAckTracker", () => {
  it("claim returns true for a new delivery", () => {
    const t = new DurableAckTracker();
    expect(t.claim("s1", "d1")).toBe(true);
  });

  it("claim returns false for a double-claim (same session + delivery)", () => {
    const t = new DurableAckTracker();
    expect(t.claim("s1", "d1")).toBe(true);
    expect(t.claim("s1", "d1")).toBe(false);
  });

  it("allows claiming different deliveries for the same session", () => {
    const t = new DurableAckTracker();
    expect(t.claim("s1", "d1")).toBe(true);
    expect(t.claim("s1", "d2")).toBe(true);
  });

  it("complete prevents re-claim", () => {
    const t = new DurableAckTracker();
    t.claim("s1", "d1");
    t.complete("s1", "d1");
    expect(t.claim("s1", "d1")).toBe(false);
  });

  it("release allows re-claim (retry)", () => {
    const t = new DurableAckTracker();
    t.claim("s1", "d1");
    t.release("s1", "d1");
    expect(t.claim("s1", "d1")).toBe(true);
  });

  it("drop prevents re-claim (terminal)", () => {
    const t = new DurableAckTracker();
    t.claim("s1", "d1");
    t.drop("s1", "d1");
    expect(t.claim("s1", "d1")).toBe(false);
  });

  it("complete after release still prevents re-claim", () => {
    const t = new DurableAckTracker();
    t.claim("s1", "d1");
    t.release("s1", "d1");
    t.claim("s1", "d1");
    t.complete("s1", "d1");
    expect(t.claim("s1", "d1")).toBe(false);
  });

  it("full lifecycle: claim → complete → claim blocked", () => {
    const t = new DurableAckTracker();
    expect(t.claim("s1", "d1")).toBe(true); // claim
    t.complete("s1", "d1"); // complete
    expect(t.claim("s1", "d1")).toBe(false); // blocked
  });

  it("full lifecycle: claim → release → claim → drop → claim blocked", () => {
    const t = new DurableAckTracker();
    expect(t.claim("s1", "d1")).toBe(true); // claim
    t.release("s1", "d1"); // release
    expect(t.claim("s1", "d1")).toBe(true); // re-claim
    t.drop("s1", "d1"); // drop
    expect(t.claim("s1", "d1")).toBe(false); // blocked
  });

  it("does not block a different delivery after complete", () => {
    const t = new DurableAckTracker();
    t.claim("s1", "d1");
    t.complete("s1", "d1");
    expect(t.claim("s1", "d2")).toBe(true); // different delivery still claimable
  });

  it("does not block the same delivery for a different session", () => {
    const t = new DurableAckTracker();
    t.claim("s1", "d1");
    t.complete("s1", "d1");
    expect(t.claim("s2", "d1")).toBe(true); // same delivery, different session
  });
});

import { describe, it, expect } from "vitest";
import { frame, type WireEnvelope } from "./wire-envelope.js";

describe("[unit] wire-envelope", () => {
  it("frame produces version 1 envelope with all fields", () => {
    const env = frame({ sessionId: "s1", seq: 5, event: { type: "text", delta: "hi" } });
    expect(env.version).toBe(1);
    expect(env.sessionId).toBe("s1");
    expect(env.seq).toBe(5);
    expect(env.event).toEqual({ type: "text", delta: "hi" });
    expect(env.ts).toBeTypeOf("number");
    expect(env.runId).toBeUndefined();
    expect(env.laneId).toBeUndefined();
  });

  it("frame accepts optional runId/laneId/ts", () => {
    const env = frame({ sessionId: "s1", seq: 0, event: null, runId: "r1", laneId: "l1", ts: 999 });
    expect(env.runId).toBe("r1");
    expect(env.laneId).toBe("l1");
    expect(env.ts).toBe(999);
  });

  it("frame default ts is nowWallclock (>0)", () => {
    const env = frame({ sessionId: "s", seq: 0, event: {} });
    expect(env.ts).toBeGreaterThan(0);
  });

  it("WireEnvelope satisfies structural shape", () => {
    const env: WireEnvelope = frame({ sessionId: "s", seq: 1, event: "x" });
    expect(env.event).toBe("x");
  });
});

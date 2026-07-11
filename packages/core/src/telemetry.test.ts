import { describe, it, expect } from "vitest";
import { TelemetrySink, project } from "@my-agent/core";
import type { RuntimeEvent } from "@my-agent/core";

describe("§13 telemetry — projected, bounded, sampled sink (Phase 8)", () => {
  it("projects a RuntimeEvent without payload (no secrets leak)", () => {
    const e: RuntimeEvent = {
      kind: "tool",
      ts: 100,
      payload: { apiKey: "sk-supersecret", password: "hunter2" },
    } as unknown as RuntimeEvent;
    const p = project(e as { kind: string; ts?: number });
    expect(p.kind).toBe("tool");
    expect(p.ts).toBe(100);
    // critical: no payload fields → no apiKey/password
    expect(JSON.stringify(p)).not.toContain("sk-supersecret");
    expect(JSON.stringify(p)).not.toContain("hunter2");
  });

  it("ingest increments counts + flush returns a snapshot with the window", () => {
    const sink = new TelemetrySink();
    for (let i = 0; i < 5; i++) sink.ingest({ kind: "turn", ts: i, stage: "event", turnEvent: { state: "Streaming" } });
    for (let i = 0; i < 3; i++) sink.ingest({ kind: "budget", ts: 10 + i, ok: true });
    // counts are reported in the snapshot (cumulative since construction)
    const snap = sink.flush();
    expect(snap.counts).toEqual({ turn: 5, budget: 3 });
    expect(snap.window.length).toBe(8);
    expect(snap.windowStartMs).toBe(0);
    expect(snap.windowEndMs).toBe(12);
    // window resets after flush
    const snap2 = sink.flush();
    expect(snap2.window.length).toBe(0);
    // counts persist across flushes (cumulative)
    expect(snap2.counts).toEqual({ turn: 5, budget: 3 });
  });

  it("sampling is deterministic (counter-based, no Math.random)", () => {
    const sink = new TelemetrySink(0.25); // keep every 4th
    for (let i = 0; i < 100; i++) sink.ingest({ kind: "tool" });
    // with interval=4 starting at seen=1: keep 4, 8, 12, ..., 100 → 25 kept
    expect(sink.droppedCount).toBe(75);
  });

  it("rejects out-of-range sampleRate", () => {
    expect(() => new TelemetrySink(0)).toThrow();
    expect(() => new TelemetrySink(1.5)).toThrow();
    expect(() => new TelemetrySink(-0.1)).toThrow();
  });

  it("cap the window (maxWindow defaults to 10k) — no unbounded growth", () => {
    const sink = new TelemetrySink();
    // ingest more than maxWindow; the sink stores at most maxWindow via ring
    for (let i = 0; i < 200; i++) sink.ingest({ kind: "x", ts: i });
    const snap = sink.flush();
    expect(snap.window.length).toBeLessThanOrEqual(10_000);
  });
});

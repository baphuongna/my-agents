import { describe, it, expect } from "vitest";
import { HindsightReviewer, type HindsightResult } from "./hindsight.js";
import type { ProviderProfile, StreamEvent } from "@my-agent/core";

function makeCritic(events: StreamEvent[], opts: { throwErr?: Error; delayMs?: number } = {}): ProviderProfile {
  return {
    id: "critic",
    model: "critic-1",
    health: () => "Healthy" as const,
    async stream() {
      if (opts.throwErr) throw opts.throwErr;
      if (opts.delayMs) await new Promise(r => setTimeout(r, opts.delayMs));
      return { events: [...events] };
    },
  } as unknown as ProviderProfile;
}

function textEvent(text: string): StreamEvent {
  return { kind: "text", text } as StreamEvent;
}
function doneEvent(input = 10, output = 20): StreamEvent {
  return { kind: "done", usage: { input, output } } as StreamEvent;
}

describe("[unit] HindsightReviewer", () => {
  it("parses valid JSON critique from critic", async () => {
    const json = JSON.stringify({
      issues: [{ severity: "warn", message: "missing edge case" }],
      summary: "mostly correct",
      approved: true,
    });
    const critic = makeCritic([textEvent(json), doneEvent()]);
    const r = await new HindsightReviewer(critic).review("q", "a");
    expect(r.approved).toBe(true);
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]!.severity).toBe("warn");
    expect(r.summary).toBe("mostly correct");
    expect(r.usage).toEqual({ input: 10, output: 20 });
  });

  it("unparseable output → error issue + approved=false", async () => {
    const critic = makeCritic([textEvent("not json at all"), doneEvent()]);
    const r = await new HindsightReviewer(critic).review("q", "a");
    expect(r.approved).toBe(false);
    expect(r.issues[0]!.severity).toBe("error");
    expect(r.summary).toMatch(/parse failed/);
  });

  it("critic throws → error result (not crash)", async () => {
    const critic = makeCritic([], { throwErr: new Error("network down") });
    const r = await new HindsightReviewer(critic).review("q", "a");
    expect(r.approved).toBe(false);
    expect(r.issues[0]!.message).toMatch(/network down/);
    expect(r.usage).toEqual({ input: 0, output: 0 });
  });

  it("timeout → error result", async () => {
    const critic = makeCritic([textEvent("...")], { delayMs: 200 });
    const r = await new HindsightReviewer(critic).review("q", "a", undefined, { timeoutMs: 50 });
    expect(r.approved).toBe(false);
    expect(r.issues[0]!.message).toMatch(/timed out/);
  });

  it("brace balancing: JSON with } inside string value", async () => {
    const json = JSON.stringify({
      issues: [],
      summary: "has } brace",
      approved: true,
    });
    const critic = makeCritic([textEvent(json), doneEvent()]);
    const r = await new HindsightReviewer(critic).review("q", "a");
    expect(r.approved).toBe(true);
    expect(r.summary).toBe("has } brace");
  });

  it("multiple text events concatenated", async () => {
    const json = JSON.stringify({ issues: [], summary: "ok", approved: true });
    const half = Math.floor(json.length / 2);
    const critic = makeCritic([textEvent(json.slice(0, half)), textEvent(json.slice(half)), doneEvent(5, 5)]);
    const r = await new HindsightReviewer(critic).review("q", "a");
    expect(r.approved).toBe(true);
    expect(r.usage).toEqual({ input: 5, output: 5 });
  });

  it("health() delegates to critic", () => {
    const critic = makeCritic([], );
    expect(new HindsightReviewer(critic).health()).toBe("Healthy");
  });

  it("missing fields → defaults (empty issues, empty summary, not approved)", async () => {
    const critic = makeCritic([textEvent("{}"), doneEvent()]);
    const r = await new HindsightReviewer(critic).review("q", "a");
    expect(r.issues).toEqual([]);
    expect(r.summary).toBe("");
    expect(r.approved).toBe(false);
  });
});

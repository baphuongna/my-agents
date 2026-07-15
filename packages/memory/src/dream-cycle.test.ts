/**
 * DreamCycle tests (§8 R35 — LLM-driven offline consolidation).
 *
 * No real providers/network. Mock providers replay canned stream events; the
 * SkillCurator is a tiny inline mock. Timers are driven with vitest fake timers.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Brain, DreamCycle } from "@my-agent/memory";
import type { DreamResult, Fact } from "@my-agent/memory";
import { nowWallclock } from "@my-agent/core";
import type {
  ComponentHealth,
  History,
  ProviderProfile,
  StreamEvent,
  SystemPrompt,
} from "@my-agent/core";

/** A controllable mock ProviderProfile that replays canned text events.
 * `ref.count` tracks how many times stream() was called. */
function mockProvider(text: string): { profile: ProviderProfile; ref: { count: number } } {
  const ref = { count: 0 };
  const profile: ProviderProfile = {
    id: "mock",
    model: "mock-model",
    async stream(
      _prompt: SystemPrompt,
      _history: History,
    ): Promise<{ events: StreamEvent[] }> {
      ref.count++;
      return {
        events: [
          { kind: "text", text },
          { kind: "done", usage: { input: 0, output: 0 } },
        ],
      };
    },
    health(): ComponentHealth {
      return "Healthy";
    },
  };
  return { profile, ref };
}

/** A minimal SkillCurator mock with controllable review output. */
function mockCurator(reviewed: number, stale: string[] = []) {
  const invocations = { count: 0 };
  return {
    invocations,
    curator: {
      async review() {
        invocations.count++;
        return { reviewed, stale };
      },
    },
  };
}

describe("DreamCycle — constructs and lifecycle", () => {
  it("constructs with a Brain (defaults: 30min interval, no provider/curator)", () => {
    const dc = new DreamCycle({ brain: new Brain() });
    expect(dc.running).toBe(false);
  });

  it("start() arms the timer and is idempotent; stop() clears it", () => {
    const dc = new DreamCycle({ brain: new Brain(), intervalMs: 1000 });
    expect(dc.running).toBe(false);
    dc.start();
    expect(dc.running).toBe(true);
    // idempotent: a second start() doesn't re-arm
    dc.start();
    expect(dc.running).toBe(true);
    dc.stop();
    expect(dc.running).toBe(false);
    // idempotent stop
    dc.stop();
    expect(dc.running).toBe(false);
  });
});

describe("DreamCycle — dream() with a mock provider", () => {
  it("asks the LLM to summarize and stores the summary back as a dream fact", async () => {
    const brain = new Brain();
    // seed two recent facts
    brain.recordFact({
      kind: "event", entity: "Alice", content: "met Bob",
      visibility: "private", notability: 1, source: "session-1",
    });
    brain.recordFact({
      kind: "event", entity: "Alice", content: "discussed the plan",
      visibility: "private", notability: 1, source: "session-1",
    });
    const { profile, ref } = mockProvider("Alice is active and met Bob.");

    const dc = new DreamCycle({ brain, provider: profile, intervalMs: 60_000, allowPrivateInPrompt: true });
    const res: DreamResult = await dc.dream();

    expect(ref.count).toBe(1);
    expect(res.summary).toBe("Alice is active and met Bob.");
    expect(res.memoriesConsolidated).toBe(2);
    // the summary was stored back as a dream fact
    const dreamFacts = brain.factsByEntity("dream-summary");
    expect(dreamFacts.length).toBe(1);
    expect(dreamFacts[0]!.source).toBe("dream");
    expect(dreamFacts[0]!.content).toBe(res.summary);
    expect(res.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("reviews skills via the curator and reports skillsReviewed", async () => {
    const brain = new Brain();
    brain.recordFact({
      kind: "event", entity: "x", content: "y",
      visibility: "private", notability: 1, source: "s",
    });
    const { profile } = mockProvider("summary");
    const { curator, invocations } = mockCurator(4, ["old-skill"]);
    const dc = new DreamCycle({
      brain, provider: profile, skillCurator: curator, intervalMs: 60_000,
    });
    const res = await dc.dream();
    expect(invocations.count).toBe(1);
    expect(res.skillsReviewed).toBe(4);
  });

  it("reports skillsReviewed=0 when no curator is wired", async () => {
    const dc = new DreamCycle({ brain: new Brain(), provider: mockProvider("s").profile });
    const res = await dc.dream();
    expect(res.skillsReviewed).toBe(0);
  });
});

describe("DreamCycle — dream() without a provider (basic consolidation)", () => {
  it("produces a deterministic zero-LLM digest of recent facts", async () => {
    const brain = new Brain();
    brain.recordFact({
      kind: "event", entity: "Alice", content: "a1",
      visibility: "private", notability: 1, source: "s",
    });
    brain.recordFact({
      kind: "event", entity: "Alice", content: "a2",
      visibility: "private", notability: 1, source: "s",
    });
    brain.recordFact({
      kind: "event", entity: "Bob", content: "b1",
      visibility: "private", notability: 1, source: "s",
    });
    const dc = new DreamCycle({ brain, intervalMs: 60_000, allowPrivateInPrompt: true });
    const res = await dc.dream();
    expect(res.memoriesConsolidated).toBe(3);
    expect(res.summary).toContain("Consolidated 3 memories");
    expect(res.summary).toContain("Alice (2)");
    // stored back as a dream fact
    expect(brain.factsByEntity("dream-summary").length).toBe(1);
  });

  it("returns a no-op summary when there are no recent memories", async () => {
    const dc = new DreamCycle({ brain: new Brain(), intervalMs: 60_000 });
    const res = await dc.dream();
    expect(res.memoriesConsolidated).toBe(0);
    expect(res.summary).toContain("No new memories");
  });

  it("excludes facts older than the interval window", async () => {
    const brain = new Brain();
    // an old fact (well outside a 1ms window)
    brain.recordFact({
      kind: "event", entity: "Old", content: "ancient",
      visibility: "private", notability: 1, source: "s",
    });
    // push its createdAt into the distant past
    const facts = brain.unconsolidatedFacts();
    facts[0]!.createdAt = nowWallclock() - 10_000;
    const dc = new DreamCycle({ brain, intervalMs: 1 });
    const res = await dc.dream();
    expect(res.memoriesConsolidated).toBe(0);
  });
});

describe("DreamCycle — timer fires on interval and stop() clears it", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires dream() on each interval tick", async () => {
    const brain = new Brain();
    const { profile } = mockProvider("tick-summary");
    const dc = new DreamCycle({ brain, provider: profile, intervalMs: 1000 });
    const dreamSpy = vi.spyOn(dc, "dream").mockResolvedValue({
      memoriesConsolidated: 0, skillsReviewed: 0, summary: "", durationMs: 0,
    });
    dc.start();
    // advance past two ticks
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(dreamSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    dc.stop();
    expect(dc.running).toBe(false);
  });

  it("stop() clears the timer so no further ticks fire", async () => {
    const brain = new Brain();
    const { profile } = mockProvider("s");
    const dc = new DreamCycle({ brain, provider: profile, intervalMs: 500 });
    const dreamSpy = vi.spyOn(dc, "dream").mockResolvedValue({
      memoriesConsolidated: 0, skillsReviewed: 0, summary: "", durationMs: 0,
    });
    dc.start();
    await vi.advanceTimersByTimeAsync(500);
    const callsAfterFirstTick = dreamSpy.mock.calls.length;
    dc.stop();
    await vi.advanceTimersByTimeAsync(2000);
    expect(dreamSpy.mock.calls.length).toBe(callsAfterFirstTick);
    expect(dc.running).toBe(false);
  });
});

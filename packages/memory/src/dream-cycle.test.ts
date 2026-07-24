/**
 * DreamCycle tests (§8 R35 — LLM-driven offline consolidation).
 *
 * No real providers/network. Mock providers replay canned stream events; the
 * SkillCurator is a tiny inline mock. Timers are driven with vitest fake timers.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Brain } from "./brain.js";
import type { Fact } from "./brain.js";
import {
  DreamCycle,
  assembleDreamSummary,
  buildConsolidationPrompt,
} from "./dream-cycle.js";
import type {
  DreamResult,
  ConsolidationFn,
  ConsolidationDecision,
  ConsolidationMemory,
} from "./dream-cycle.js";
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

describe("assembleDreamSummary — pure prompt assembly", () => {
  it("returns the trimmed summary when there are no patterns", () => {
    expect(assembleDreamSummary("  hello  ", [])).toBe("hello");
  });

  it("appends patterns as a semicolon-separated list", () => {
    const out = assembleDreamSummary("summary", ["p1", "p2"]);
    expect(out).toBe("summary\n\nPatterns: p1; p2");
  });

  it("handles a single pattern", () => {
    expect(assembleDreamSummary("s", ["only"])).toBe("s\n\nPatterns: only");
  });
});

describe("buildConsolidationPrompt — LLM prompt contract", () => {
  it("builds a stable system instruction + memory corpus", () => {
    const memories: ConsolidationMemory[] = [
      { entity: "Alice", content: "met Bob" },
      { entity: "Alice", content: "discussed plan" },
    ];
    const prompt = buildConsolidationPrompt(memories);
    expect(prompt.stable).toMatch(/memory consolidation engine/i);
    expect(prompt.stable).toMatch(/decline/i);
    expect(prompt.context).toContain("2 memory entries");
    expect(prompt.context).toContain("[Alice] met Bob");
    expect(prompt.context).toContain("[Alice] discussed plan");
  });

  it("uses a placeholder corpus when there are no memories", () => {
    const prompt = buildConsolidationPrompt([]);
    expect(prompt.context).toContain("0 memory entries");
    expect(prompt.context).toContain("(no new memories");
  });
});

describe("DreamCycle — LLM-driven consolidation (consolidationFn / summaryFn)", () => {
  function seedBrain(): Brain {
    const brain = new Brain();
    brain.recordFact({
      kind: "event", entity: "Alice", content: "met Bob",
      visibility: "private", notability: 1, source: "s1",
    });
    brain.recordFact({
      kind: "event", entity: "Alice", content: "discussed the plan",
      visibility: "private", notability: 1, source: "s1",
    });
    return brain;
  }

  it("calls consolidationFn with the collected memories", async () => {
    const brain = seedBrain();
    let captured: ConsolidationMemory[] = [];
    const fn: ConsolidationFn = async (input) => {
      captured = input.memories;
      return { consolidate: true, summary: "Alice is central.", patterns: ["recurring meetings"] };
    };
    const dc = new DreamCycle({
      brain, consolidationFn: fn, intervalMs: 60_000, allowPrivateInPrompt: true,
    });
    const res = await dc.dream();
    expect(captured.length).toBe(2);
    expect(captured[0]!.entity).toBe("Alice");
    expect(res.memoriesConsolidated).toBe(2);
  });

  it("stores the consolidated summary + patterns when the decision is consolidate", async () => {
    const brain = seedBrain();
    const fn: ConsolidationFn = async () => ({
      consolidate: true,
      summary: "Alice drives most activity.",
      patterns: ["planning", "collaboration"],
    });
    const dc = new DreamCycle({
      brain, consolidationFn: fn, intervalMs: 60_000, allowPrivateInPrompt: true,
    });
    const res = await dc.dream();
    expect(res.declined).toBeUndefined();
    expect(res.patterns).toEqual(["planning", "collaboration"]);
    const dreamFacts = brain.factsByEntity("dream-summary");
    expect(dreamFacts.length).toBe(1);
    expect(dreamFacts[0]!.content).toContain("Alice drives most activity.");
    expect(dreamFacts[0]!.content).toContain("Patterns: planning; collaboration");
  });

  it("consolidationFn takes precedence over the raw provider", async () => {
    const brain = seedBrain();
    const { profile, ref } = mockProvider("provider-summary");
    let fnCalled = false;
    const fn: ConsolidationFn = async () => {
      fnCalled = true;
      return { consolidate: true, summary: "fn-summary", patterns: [] };
    };
    const dc = new DreamCycle({
      brain, provider: profile, consolidationFn: fn,
      intervalMs: 60_000, allowPrivateInPrompt: true,
    });
    await dc.dream();
    expect(fnCalled).toBe(true);
    expect(ref.count).toBe(0); // provider NOT called when consolidationFn is wired
  });

  it("decline strategy: does NOT store a dream fact and surfaces declineReason", async () => {
    const brain = seedBrain();
    const fn: ConsolidationFn = async () => ({
      consolidate: false,
      summary: "",
      patterns: ["low-signal"],
      declineReason: "memories too disparate",
    });
    const dc = new DreamCycle({
      brain, consolidationFn: fn, intervalMs: 60_000, allowPrivateInPrompt: true,
    });
    const res = await dc.dream();
    expect(res.declined).toBe(true);
    expect(res.declineReason).toBe("memories too disparate");
    // No dream fact stored on decline.
    expect(brain.factsByEntity("dream-summary").length).toBe(0);
    // Patterns are still surfaced even on decline.
    expect(res.patterns).toEqual(["low-signal"]);
  });

  it("decline strategy: uses a default reason when none is given", async () => {
    const brain = seedBrain();
    const fn: ConsolidationFn = async () => ({ consolidate: false, summary: "", patterns: [] });
    const dc = new DreamCycle({
      brain, consolidationFn: fn, intervalMs: 60_000, allowPrivateInPrompt: true,
    });
    const res = await dc.dream();
    expect(res.declined).toBe(true);
    expect(res.declineReason).toBe("consolidation declined");
  });

  it("falls back to a decline when consolidationFn throws (no garbage stored)", async () => {
    const brain = seedBrain();
    const fn: ConsolidationFn = async () => {
      throw new Error("LLM timeout");
    };
    const dc = new DreamCycle({
      brain, consolidationFn: fn, intervalMs: 60_000, allowPrivateInPrompt: true,
    });
    const res = await dc.dream();
    expect(res.declined).toBe(true);
    expect(res.declineReason).toMatch(/LLM timeout/);
    expect(brain.factsByEntity("dream-summary").length).toBe(0);
  });
});

describe("DreamCycle — distributed shutdown handling", () => {
  it("dream() aborts before work when isShuttingDown() is true", async () => {
    const brain = new Brain();
    brain.recordFact({
      kind: "event", entity: "x", content: "y",
      visibility: "private", notability: 1, source: "s",
    });
    const dc = new DreamCycle({
      brain, intervalMs: 60_000, allowPrivateInPrompt: true,
      isShuttingDown: () => true,
    });
    const res = await dc.dream();
    expect(res.shutdownAborted).toBe(true);
    expect(res.summary).toMatch(/aborted/i);
    // Nothing stored.
    expect(brain.factsByEntity("dream-summary").length).toBe(0);
  });

  it("shutdown() arms the flag and stops the timer; subsequent dream() aborts", async () => {
    const brain = new Brain();
    const dc = new DreamCycle({ brain, intervalMs: 1000 });
    dc.start();
    expect(dc.running).toBe(true);
    dc.shutdown();
    expect(dc.running).toBe(false);
    const res = await dc.dream();
    expect(res.shutdownAborted).toBe(true);
  });

  it("dream() aborts mid-consolidation if shutdown arrives after the LLM call", async () => {
    const brain = new Brain();
    brain.recordFact({
      kind: "event", entity: "x", content: "y",
      visibility: "private", notability: 1, source: "s",
    });
    let shuttingDown = false;
    const fn: ConsolidationFn = async () => {
      // simulate shutdown arriving during the (async) LLM call
      shuttingDown = true;
      return { consolidate: true, summary: "should-not-store", patterns: ["p"] };
    };
    const dc = new DreamCycle({
      brain, consolidationFn: fn, intervalMs: 60_000, allowPrivateInPrompt: true,
      isShuttingDown: () => shuttingDown,
    });
    const res = await dc.dream();
    expect(res.shutdownAborted).toBe(true);
    expect(res.patterns).toEqual(["p"]);
    // Mid-cycle abort: nothing stored even though the decision was consolidate.
    expect(brain.factsByEntity("dream-summary").length).toBe(0);
  });

  it("periodic start() stops itself once isShuttingDown() flips true", async () => {
    vi.useFakeTimers();
    try {
      const brain = new Brain();
      let down = false;
      const dc = new DreamCycle({ brain, intervalMs: 1000, isShuttingDown: () => down });
      const spy = vi.spyOn(dc, "dream").mockResolvedValue({
        memoriesConsolidated: 0, skillsReviewed: 0, summary: "", durationMs: 0,
      });
      dc.start();
      await vi.advanceTimersByTimeAsync(1000);
      const callsBeforeShutdown = spy.mock.calls.length;
      expect(callsBeforeShutdown).toBeGreaterThanOrEqual(1);
      down = true; // fleet shutdown
      await vi.advanceTimersByTimeAsync(5000);
      // timer should have self-stopped; no new dream() calls after shutdown
      expect(spy.mock.calls.length).toBe(callsBeforeShutdown);
      expect(dc.running).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

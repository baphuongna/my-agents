/**
 * @my-agent/council — CouncilProvider smoke tests.
 *
 * Covers: construction (1 member ok, 0 members throws), health() aggregation
 * (Healthy / Degraded / Failed), makeReviewer() → HindsightReviewer, and
 * stream() fan-out to all healthy members.
 *
 * No real providers are used — a tiny inline ProviderProfile mock replays a
 * deterministic text + done event trace and records call counts.
 */
import { describe, it, expect } from "vitest";
import { CouncilProvider } from "./council.js";
import { HindsightReviewer } from "./hindsight.js";
import type {
  ComponentHealth,
  History,
  ProviderProfile,
  StreamEvent,
  SystemPrompt,
} from "@my-agent/core";

/** Minimal ProviderProfile mock with controllable health + call tracking. */
function makeProfile(opts: {
  id: string;
  health?: ComponentHealth;
  text?: string;
}): { profile: ProviderProfile; calls: { count: number } } {
  const calls = { count: 0 };
  const profile: ProviderProfile = {
    id: opts.id,
    model: `model-${opts.id}`,
    health: () => opts.health ?? "Healthy",
    async stream(
      _prompt: SystemPrompt,
      _history: History,
    ): Promise<{ events: StreamEvent[] }> {
      calls.count++;
      return {
        events: [
          { kind: "text", text: opts.text ?? `answer-${opts.id}` },
          { kind: "done", usage: { input: 1, output: 1 } },
        ],
      };
    },
  };
  return { profile, calls };
}

const emptyHistory: History = { append() {}, entries: () => [] };
const prompt: SystemPrompt = { stable: "s", context: "c", volatile: "v" };

describe("CouncilProvider — construction", () => {
  it("constructor with 1 member works", () => {
    const { profile } = makeProfile({ id: "solo" });
    const council = new CouncilProvider({
      members: [{ profile, role: "Solo" }],
    });
    expect(council.id).toBe("council:1");
    expect(council.model).toContain("Solo");
  });

  it("constructor with 0 members throws", () => {
    expect(() => new CouncilProvider({ members: [] })).toThrow();
  });
});

describe("CouncilProvider — health()", () => {
  it("returns Healthy when all members healthy", () => {
    const a = makeProfile({ id: "a" });
    const b = makeProfile({ id: "b" });
    const council = new CouncilProvider({
      members: [
        { profile: a.profile, role: "A" },
        { profile: b.profile, role: "B" },
      ],
    });
    expect(council.health()).toBe("Healthy");
  });

  it("returns Degraded when some members failed", () => {
    const a = makeProfile({ id: "a" });
    const b = makeProfile({ id: "b", health: "Failed" });
    const council = new CouncilProvider({
      members: [
        { profile: a.profile, role: "A" },
        { profile: b.profile, role: "B" },
      ],
    });
    expect(council.health()).toBe("Degraded");
  });

  it("returns Failed when every member failed", () => {
    const a = makeProfile({ id: "a", health: "Failed" });
    const b = makeProfile({ id: "b", health: "Failed" });
    const council = new CouncilProvider({
      members: [
        { profile: a.profile, role: "A" },
        { profile: b.profile, role: "B" },
      ],
    });
    expect(council.health()).toBe("Failed");
  });
});

describe("CouncilProvider — makeReviewer()", () => {
  it("returns a HindsightReviewer", () => {
    const { profile } = makeProfile({ id: "critic" });
    const council = new CouncilProvider({
      members: [{ profile, role: "Critic" }],
    });
    const reviewer = council.makeReviewer();
    expect(reviewer).toBeInstanceOf(HindsightReviewer);
  });
});

describe("CouncilProvider — stream() fan-out", () => {
  it("calls every healthy member once and aggregates attributed output", async () => {
    const a = makeProfile({ id: "a", text: "alpha-answer" });
    const b = makeProfile({ id: "b", text: "beta-answer" });
    const c = makeProfile({ id: "c", text: "gamma-answer" });
    const council = new CouncilProvider({
      members: [
        { profile: a.profile, role: "Skeptic" },
        { profile: b.profile, role: "Pragmatist" },
        { profile: c.profile, role: "Critic" },
      ],
      // default strategy is "attributed"
    });

    const { events } = await council.stream(prompt, emptyHistory);

    // Every member was fanned out to exactly once.
    expect(a.calls.count).toBe(1);
    expect(b.calls.count).toBe(1);
    expect(c.calls.count).toBe(1);

    // Attributed strategy emits each member's contribution under its role.
    const text = events
      .filter((e) => e.kind === "text")
      .map((e) => (e.kind === "text" ? e.text : ""))
      .join("");
    expect(text).toContain("Skeptic");
    expect(text).toContain("Pragmatist");
    expect(text).toContain("Critic");
    expect(text).toContain("alpha-answer");
    expect(text).toContain("gamma-answer");

    // A terminal done event is always emitted.
    expect(events.some((e) => e.kind === "done")).toBe(true);
  });

  it("skips failed members during fan-out", async () => {
    const ok = makeProfile({ id: "ok", text: "ok-answer" });
    const dead = makeProfile({ id: "dead", health: "Failed", text: "dead-answer" });
    const council = new CouncilProvider({
      members: [
        { profile: ok.profile, role: "Alive" },
        { profile: dead.profile, role: "Dead" },
      ],
    });

    const { events } = await council.stream(prompt, emptyHistory);

    expect(ok.calls.count).toBe(1);
    expect(dead.calls.count).toBe(0); // failed members are not streamed
    const text = events
      .filter((e) => e.kind === "text")
      .map((e) => (e.kind === "text" ? e.text : ""))
      .join("");
    expect(text).toContain("Alive");
    expect(text).not.toContain("dead-answer");
  });
});

/**
 * @my-agent/council — multi-model council tests.
 *
 * Covers multi-member scenarios that exercise the full council pipeline:
 *   - attributed strategy with 2 mock members (fan-out + attributed emission)
 *   - judge strategy (mock judge synthesizes member answers)
 *   - health() aggregation with mixed Healthy/Degraded/Failed members
 *
 * Uses inline ProviderProfile mocks — no real providers or network calls.
 */
import { describe, it, expect } from "vitest";
import { CouncilProvider } from "./council.js";
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
          { kind: "done", usage: { input: 10, output: 5 } },
        ],
      };
    },
  };
  return { profile, calls };
}

const emptyHistory: History = { append() {}, entries: () => [] };
const prompt: SystemPrompt = { stable: "s", context: "c", volatile: "v" };

// ── Attributed strategy (2 mock members) ────────────────────────────────────

describe("CouncilProvider — multi-model attributed strategy", () => {
  it("fans out to 2 members and emits attributed responses", async () => {
    const a = makeProfile({ id: "anthropic", text: "Use a recursive approach." });
    const b = makeProfile({ id: "openai", text: "Use an iterative approach." });
    const council = new CouncilProvider({
      members: [
        { profile: a.profile, role: "Anthropic" },
        { profile: b.profile, role: "OpenAI" },
      ],
      strategy: "attributed",
    });

    const { events } = await council.stream(prompt, emptyHistory);

    // Both members were fanned out to exactly once.
    expect(a.calls.count).toBe(1);
    expect(b.calls.count).toBe(1);

    const text = events
      .filter((e) => e.kind === "text")
      .map((e) => (e.kind === "text" ? e.text : ""))
      .join("");

    // Both members' roles and answers appear under their headings.
    expect(text).toContain("## Anthropic");
    expect(text).toContain("Use a recursive approach.");
    expect(text).toContain("## OpenAI");
    expect(text).toContain("Use an iterative approach.");

    // A done event is emitted with aggregated usage (input summed, output summed).
    const done = events.find((e) => e.kind === "done");
    expect(done).toBeDefined();
    if (done && done.kind === "done") {
      expect(done.usage.input).toBe(20); // 10 + 10
      expect(done.usage.output).toBe(10); // 5 + 5
    }
  });

  it("attributed strategy skips failed members in fan-out", async () => {
    const ok = makeProfile({ id: "ok", text: "good answer" });
    const dead = makeProfile({ id: "dead", health: "Failed", text: "dead answer" });
    const council = new CouncilProvider({
      members: [
        { profile: ok.profile, role: "Alive" },
        { profile: dead.profile, role: "Dead" },
      ],
      strategy: "attributed",
    });

    const { events } = await council.stream(prompt, emptyHistory);

    expect(ok.calls.count).toBe(1);
    expect(dead.calls.count).toBe(0); // failed members are not streamed

    const text = events
      .filter((e) => e.kind === "text")
      .map((e) => (e.kind === "text" ? e.text : ""))
      .join("");

    expect(text).toContain("Alive");
    expect(text).toContain("good answer");
    expect(text).not.toContain("Dead");
    expect(text).not.toContain("dead answer");
  });
});

// ── Judge strategy (mock judge) ─────────────────────────────────────────────

describe("CouncilProvider — judge strategy", () => {
  it("runs members then judge to synthesize answers", async () => {
    const a = makeProfile({ id: "skeptic", text: "I disagree; risks are high." });
    const b = makeProfile({ id: "pragmatist", text: "I agree; benefits outweigh risks." });

    const judgeCalls = { count: 0 };
    const judge: ProviderProfile = {
      id: "judge",
      model: "judge-model",
      health: () => "Healthy",
      async stream(judgePrompt: SystemPrompt, _history: History): Promise<{ events: StreamEvent[] }> {
        judgeCalls.count++;
        // Judge receives the member answers in the context field.
        const ctx = judgePrompt.context ?? "";
        return {
          events: [
            {
              kind: "text",
              text: `Synthesis: consensus reached.${ctx.includes("disagree") ? " Dissent noted." : ""}`,
            },
            { kind: "done", usage: { input: 100, output: 50 } },
          ],
        };
      },
    };

    const council = new CouncilProvider({
      members: [
        { profile: a.profile, role: "Skeptic" },
        { profile: b.profile, role: "Pragmatist" },
      ],
      strategy: "judge",
      judge,
    });

    const { events } = await council.stream(prompt, emptyHistory);

    // Both members and the judge were called exactly once.
    expect(a.calls.count).toBe(1);
    expect(b.calls.count).toBe(1);
    expect(judgeCalls.count).toBe(1);

    const text = events
      .filter((e) => e.kind === "text")
      .map((e) => (e.kind === "text" ? e.text : ""))
      .join("");

    // Judge output is the emitted text (not raw member answers).
    expect(text).toContain("Synthesis");
    expect(text).toContain("Dissent noted.");

    // Done event aggregates member + judge usage.
    const done = events.find((e) => e.kind === "done");
    expect(done).toBeDefined();
    if (done && done.kind === "done") {
      // members: 10+10 input, 5+5 output; judge: 100 input, 50 output
      expect(done.usage.input).toBe(120); // 20 + 100
      expect(done.usage.output).toBe(50); // judge output replaces member output
    }
  });

  it("degrades to attributed when judge stream throws", async () => {
    const a = makeProfile({ id: "a", text: "answer-a" });
    const b = makeProfile({ id: "b", text: "answer-b" });

    const failingJudge: ProviderProfile = {
      id: "bad-judge",
      model: "judge-model",
      health: () => "Healthy",
      async stream(): Promise<{ events: StreamEvent[] }> {
        throw new Error("judge API down");
      },
    };

    const council = new CouncilProvider({
      members: [
        { profile: a.profile, role: "Alpha" },
        { profile: b.profile, role: "Beta" },
      ],
      strategy: "judge",
      judge: failingJudge,
    });

    const { events } = await council.stream(prompt, emptyHistory);

    const text = events
      .filter((e) => e.kind === "text")
      .map((e) => (e.kind === "text" ? e.text : ""))
      .join("");

    // Falls back to attributed — member answers appear under their roles.
    expect(text).toContain("Alpha");
    expect(text).toContain("answer-a");
    expect(text).toContain("Beta");
    expect(text).toContain("answer-b");
  });

  it("falls back to attributed when judge strategy has no judge profile", async () => {
    const a = makeProfile({ id: "a", text: "answer-a" });
    const b = makeProfile({ id: "b", text: "answer-b" });
    const council = new CouncilProvider({
      members: [
        { profile: a.profile, role: "Alpha" },
        { profile: b.profile, role: "Beta" },
      ],
      strategy: "judge",
      // no judge provided → constructor degrades to attributed
    });

    const { events } = await council.stream(prompt, emptyHistory);

    const text = events
      .filter((e) => e.kind === "text")
      .map((e) => (e.kind === "text" ? e.text : ""))
      .join("");

    // Behaves like attributed — both members appear.
    expect(text).toContain("Alpha");
    expect(text).toContain("answer-a");
    expect(text).toContain("Beta");
    expect(text).toContain("answer-b");
  });
});

// ── health() aggregation with mixed members ────────────────────────────────

describe("CouncilProvider — health() with mixed members", () => {
  it("returns Healthy when members are Healthy + Degraded (both operational)", () => {
    // health() only excludes "Failed" members; Degraded is still operational.
    const healthy = makeProfile({ id: "h1", health: "Healthy" });
    const degraded = makeProfile({ id: "d1", health: "Degraded" });
    const council = new CouncilProvider({
      members: [
        { profile: healthy.profile, role: "H1" },
        { profile: degraded.profile, role: "D1" },
      ],
    });
    expect(council.health()).toBe("Healthy");
  });

  it("returns Degraded with mixed Healthy/Failed members", () => {
    const ok = makeProfile({ id: "ok", health: "Healthy" });
    const dead = makeProfile({ id: "dead", health: "Failed" });
    const council = new CouncilProvider({
      members: [
        { profile: ok.profile, role: "OK" },
        { profile: dead.profile, role: "Dead" },
      ],
    });
    expect(council.health()).toBe("Degraded");
  });

  it("returns Degraded with mixed Degraded/Failed members", () => {
    const degraded = makeProfile({ id: "d", health: "Degraded" });
    const dead = makeProfile({ id: "dead", health: "Failed" });
    const council = new CouncilProvider({
      members: [
        { profile: degraded.profile, role: "Deg" },
        { profile: dead.profile, role: "Dead" },
      ],
    });
    expect(council.health()).toBe("Degraded");
  });

  it("returns Degraded when one of three members is Failed", () => {
    const a = makeProfile({ id: "a", health: "Healthy" });
    const b = makeProfile({ id: "b", health: "Degraded" });
    const c = makeProfile({ id: "c", health: "Failed" });
    const council = new CouncilProvider({
      members: [
        { profile: a.profile, role: "A" },
        { profile: b.profile, role: "B" },
        { profile: c.profile, role: "C" },
      ],
    });
    expect(council.health()).toBe("Degraded");
  });

  it("returns Failed when all members are Failed", () => {
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

  it("returns Healthy when all 3+ members Healthy", () => {
    const a = makeProfile({ id: "a", health: "Healthy" });
    const b = makeProfile({ id: "b", health: "Healthy" });
    const c = makeProfile({ id: "c", health: "Healthy" });
    const council = new CouncilProvider({
      members: [
        { profile: a.profile, role: "A" },
        { profile: b.profile, role: "B" },
        { profile: c.profile, role: "C" },
      ],
    });
    expect(council.health()).toBe("Healthy");
  });
});

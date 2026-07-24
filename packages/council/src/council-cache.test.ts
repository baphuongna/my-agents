/**
 * P6 (shard 06, Pattern 6) — advisor signature cache for CouncilProvider.
 *
 * Tests: same prefix → cache hit; new prefix → cache miss; cache returns same
 * outputs as a fresh fanout.
 */
import { describe, it, expect } from "vitest";
import { CouncilProvider, councilRequestSignature } from "./council.js";
import type {
  ComponentHealth,
  History,
  ProviderProfile,
  StreamEvent,
  SystemPrompt,
} from "@my-agent/core";

/** Minimal ProviderProfile mock with call tracking. */
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

const prompt: SystemPrompt = { stable: "s", context: "c", volatile: "v" };

function makeHistory(entries: unknown[]): History {
  return { append() {}, entries: () => entries };
}

describe("[unit] councilRequestSignature", () => {
  it("same prompt + history prefix → same signature", () => {
    const h1 = makeHistory([{ role: "user", content: "hello" }]);
    const h2 = makeHistory([{ role: "user", content: "hello" }]);
    const sig1 = councilRequestSignature(prompt, h1);
    const sig2 = councilRequestSignature(prompt, h2);
    expect(sig1).toBe(sig2);
  });

  it("different prompt → different signature", () => {
    const h = makeHistory([{ role: "user", content: "hello" }]);
    const sig1 = councilRequestSignature(prompt, h);
    const sig2 = councilRequestSignature({ ...prompt, context: "different" }, h);
    expect(sig1).not.toBe(sig2);
  });

  it("prefix up to last user message: tool-loop growth doesn't change signature", () => {
    // Turn 1: user asks, assistant responds with tool call, tool result, assistant.
    const turn = [
      { role: "user", content: "what files exist?" },
      { role: "assistant", content: "", tool_calls: [{ id: "t1" }] },
      { role: "tool", content: "result" },
      { role: "assistant", content: "here are the files" },
    ];
    // Turn 2: a NEW user message arrives + more tool iterations.
    const turn2 = [
      ...turn,
      { role: "user", content: "read file A" },
      { role: "assistant", content: "", tool_calls: [{ id: "t2" }] },
      { role: "tool", content: "content A" },
    ];
    const sig1 = councilRequestSignature(prompt, makeHistory(turn));
    const sig2 = councilRequestSignature(prompt, makeHistory(turn2));
    // Different because the last user message changed.
    expect(sig1).not.toBe(sig2);

    // Now: same prefix but MORE tool iterations after the last user message.
    const turn3 = [
      { role: "user", content: "read file A" },
      { role: "assistant", content: "", tool_calls: [{ id: "t2" }] },
      { role: "tool", content: "content A" },
    ];
    const turn4 = [
      { role: "user", content: "read file A" },
      { role: "assistant", content: "", tool_calls: [{ id: "t2" }] },
      { role: "tool", content: "content A" },
      { role: "assistant", content: "here is file A" },
      { role: "assistant", content: "", tool_calls: [{ id: "t3" }] },
      { role: "tool", content: "more" },
    ];
    const sig3 = councilRequestSignature(prompt, makeHistory(turn3));
    const sig4 = councilRequestSignature(prompt, makeHistory(turn4));
    // SAME because the prefix up to the last user message is identical.
    expect(sig3).toBe(sig4);
  });
});

describe("[unit] CouncilProvider — signature cache (P6)", () => {
  it("same prefix → cache HIT (members not re-fanned)", async () => {
    const a = makeProfile({ id: "a", text: "alpha" });
    const b = makeProfile({ id: "b", text: "beta" });
    const council = new CouncilProvider({
      members: [
        { profile: a.profile, role: "A" },
        { profile: b.profile, role: "B" },
      ],
      cadence: "user_turn",
    });
    const history = makeHistory([{ role: "user", content: "hello" }]);

    // First call: MISS → fanout.
    const r1 = await council.stream(prompt, history);
    expect(a.calls.count).toBe(1);
    expect(b.calls.count).toBe(1);
    expect(council.cacheMisses).toBe(1);
    expect(council.cacheHits).toBe(0);

    // Second call: same prefix → HIT → no re-fanout.
    const r2 = await council.stream(prompt, history);
    expect(a.calls.count).toBe(1); // NOT called again
    expect(b.calls.count).toBe(1); // NOT called again
    expect(council.cacheHits).toBe(1);
    expect(council.cacheMisses).toBe(1);
  });

  it("new prefix → cache MISS (members re-fanned)", async () => {
    const a = makeProfile({ id: "a", text: "alpha" });
    const b = makeProfile({ id: "b", text: "beta" });
    const council = new CouncilProvider({
      members: [
        { profile: a.profile, role: "A" },
        { profile: b.profile, role: "B" },
      ],
      cadence: "user_turn",
    });
    const h1 = makeHistory([{ role: "user", content: "hello" }]);
    const h2 = makeHistory([{ role: "user", content: "different" }]);

    await council.stream(prompt, h1);
    expect(a.calls.count).toBe(1);
    expect(council.cacheMisses).toBe(1);

    await council.stream(prompt, h2);
    expect(a.calls.count).toBe(2); // called again (new prefix)
    expect(council.cacheMisses).toBe(2);
    expect(council.cacheHits).toBe(0);
  });

  it("cache returns same outputs as a fresh fanout", async () => {
    const a = makeProfile({ id: "a", text: "consistent-answer" });
    const council = new CouncilProvider({
      members: [{ profile: a.profile, role: "A" }],
      cadence: "user_turn",
    });
    const history = makeHistory([{ role: "user", content: "hello" }]);

    const r1 = await council.stream(prompt, history); // MISS
    const r2 = await council.stream(prompt, history); // HIT

    // The cached output should be structurally identical to the fresh fanout.
    const text1 = r1.events.filter((e) => e.kind === "text").map((e) => (e.kind === "text" ? e.text : "")).join("");
    const text2 = r2.events.filter((e) => e.kind === "text").map((e) => (e.kind === "text" ? e.text : "")).join("");
    expect(text1).toBe(text2);
    expect(text1).toContain("consistent-answer");
  });

  it("tool-loop iterations reuse cache (prefix stability)", async () => {
    const a = makeProfile({ id: "a", text: "advice" });
    const council = new CouncilProvider({
      members: [{ profile: a.profile, role: "A" }],
      cadence: "user_turn",
    });

    // Iteration 1: user → assistant(tool) → tool(result)
    const h1 = makeHistory([
      { role: "user", content: "do a thing" },
      { role: "assistant", content: "", tool_calls: [{ id: "t1" }] },
      { role: "tool", content: "result1" },
    ]);
    await council.stream(prompt, h1);
    expect(a.calls.count).toBe(1); // first fanout

    // Iteration 2: same prefix but MORE tool growth after the last user message.
    const h2 = makeHistory([
      { role: "user", content: "do a thing" },
      { role: "assistant", content: "", tool_calls: [{ id: "t1" }] },
      { role: "tool", content: "result1" },
      { role: "assistant", content: "continuing" },
      { role: "assistant", content: "", tool_calls: [{ id: "t2" }] },
      { role: "tool", content: "result2" },
    ]);
    await council.stream(prompt, h2);
    // The prefix up to the last user message is the same → cache HIT → no re-fanout.
    expect(a.calls.count).toBe(1);
    expect(council.cacheHits).toBe(1);
  });

  it("cadence: per_call disables caching", async () => {
    const a = makeProfile({ id: "a", text: "alpha" });
    const council = new CouncilProvider({
      members: [{ profile: a.profile, role: "A" }],
      cadence: "per_call",
    });
    const history = makeHistory([{ role: "user", content: "hello" }]);

    await council.stream(prompt, history);
    await council.stream(prompt, history);
    // No caching → both calls re-fan.
    expect(a.calls.count).toBe(2);
    expect(council.cacheSize).toBe(0);
  });

  it("default cadence is user_turn", async () => {
    const a = makeProfile({ id: "a", text: "alpha" });
    const council = new CouncilProvider({
      members: [{ profile: a.profile, role: "A" }],
      // No cadence specified → defaults to user_turn.
    });
    const history = makeHistory([{ role: "user", content: "hello" }]);
    await council.stream(prompt, history);
    await council.stream(prompt, history);
    expect(a.calls.count).toBe(1); // cached
  });

  it("clearCache() invalidates cached entries", async () => {
    const a = makeProfile({ id: "a", text: "alpha" });
    const council = new CouncilProvider({
      members: [{ profile: a.profile, role: "A" }],
      cadence: "user_turn",
    });
    const history = makeHistory([{ role: "user", content: "hello" }]);
    await council.stream(prompt, history);
    expect(council.cacheSize).toBe(1);
    council.clearCache();
    expect(council.cacheSize).toBe(0);
    await council.stream(prompt, history);
    expect(a.calls.count).toBe(2); // re-fanned after clear
  });
});

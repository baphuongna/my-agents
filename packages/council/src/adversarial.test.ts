/**
 * adversarialReview tests — covers all findings survive, finding refuted,
 * threshold filtering, unparseable output defaults to false, and provider
 * cycling when reviewers > providers.
 */
import { describe, it, expect } from "vitest";
import { adversarialReview } from "./adversarial.js";
import type {
  ComponentHealth,
  History,
  ProviderProfile,
  StreamEvent,
  SystemPrompt,
} from "@my-agent/core";

/** Minimal ProviderProfile mock with controllable text + call tracking. */
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
          { kind: "text", text: opts.text ?? `{"real": true, "reason": "ok"}` },
          { kind: "done", usage: { input: 1, output: 1 } },
        ],
      };
    },
  };
  return { profile, calls };
}

describe("adversarialReview", () => {
  it("all findings survive when every reviewer votes real", async () => {
    const a = makeProfile({ id: "a", text: '{"real": true, "reason": "confirmed"}' });
    const b = makeProfile({ id: "b", text: '{"real": true, "reason": "verified"}' });

    const result = await adversarialReview(["finding-1", "finding-2"], {
      reviewerCount: 2,
      threshold: 0.5,
      providers: [a.profile, b.profile],
    });

    expect(result.real).toEqual(["finding-1", "finding-2"]);
    expect(result.refuted).toEqual([]);
    expect(result.votes).toHaveLength(2);
    expect(result.votes[0]!.realCount).toBe(2);
    expect(result.votes[0]!.total).toBe(2);
  });

  it("findings refuted when reviewers vote real=false", async () => {
    const a = makeProfile({ id: "a", text: '{"real": false, "reason": "nope"}' });
    const b = makeProfile({ id: "b", text: '{"real": false, "reason": "bogus"}' });

    const result = await adversarialReview(["bad-finding"], {
      reviewerCount: 2,
      threshold: 0.5,
      providers: [a.profile, b.profile],
    });

    expect(result.real).toEqual([]);
    expect(result.refuted).toEqual(["bad-finding"]);
    expect(result.votes[0]!.realCount).toBe(0);
  });

  it("threshold filtering: 3/4 real survives at 0.75 but not at 0.76", async () => {
    // 4 reviewers: 3 return real=true, 1 returns real=false.
    const r1 = makeProfile({ id: "r1", text: '{"real": true, "reason": "1"}' });
    const r2 = makeProfile({ id: "r2", text: '{"real": true, "reason": "2"}' });
    const r3 = makeProfile({ id: "r3", text: '{"real": true, "reason": "3"}' });
    const r4 = makeProfile({ id: "r4", text: '{"real": false, "reason": "4"}' });

    // ratio = 3/4 = 0.75 ≥ 0.75 → survives
    const pass = await adversarialReview(["contested"], {
      reviewerCount: 4,
      threshold: 0.75,
      providers: [r1.profile, r2.profile, r3.profile, r4.profile],
    });
    expect(pass.real).toEqual(["contested"]);

    // ratio = 3/4 = 0.75 < 0.76 → refuted
    const fail = await adversarialReview(["contested"], {
      reviewerCount: 4,
      threshold: 0.76,
      providers: [r1.profile, r2.profile, r3.profile, r4.profile],
    });
    expect(fail.refuted).toEqual(["contested"]);
  });

  it("unparseable reviewer output defaults to real=false", async () => {
    const a = makeProfile({ id: "a", text: "I cannot evaluate this." });
    const b = makeProfile({ id: "b", text: "```json\nnot json at all\n```" });

    const result = await adversarialReview(["fuzzy"], {
      reviewerCount: 2,
      threshold: 0.5,
      providers: [a.profile, b.profile],
    });

    expect(result.real).toEqual([]);
    expect(result.refuted).toEqual(["fuzzy"]);
    expect(result.votes[0]!.realCount).toBe(0);
    expect(result.votes[0]!.total).toBe(2);
  });

  it("provider cycling: single provider called reviewerCount times", async () => {
    const solo = makeProfile({ id: "solo", text: '{"real": true, "reason": "yes"}' });

    const result = await adversarialReview(["one-finding"], {
      reviewerCount: 3,
      threshold: 0.5,
      providers: [solo.profile],
    });

    // The single provider was cycled 3 times (once per reviewer).
    expect(solo.calls.count).toBe(3);
    expect(result.votes[0]!.realCount).toBe(3);
    expect(result.votes[0]!.total).toBe(3);
    expect(result.real).toEqual(["one-finding"]);
  });
});

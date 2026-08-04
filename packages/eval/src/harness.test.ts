import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ParityHarness, type ParityScenario } from "./harness.js";

function makeScenario(id: string, response = "ok", tier: "unit" | "integration" | "credentialed" = "unit"): ParityScenario {
  return {
    id, tier, description: `scenario ${id}`,
    trace: { messages: [{ role: "user", content: "q" }], responses: [response] },
    expectedResponse: response,
  };
}

describe("[unit] eval ParityHarness", () => {
  afterEach(() => { delete process.env.MYA_CREDENTIALED; });

  it("add + grade unit scenarios with identity compressor → all pass", async () => {
    const h = new ParityHarness();
    h.add(makeScenario("s1"));
    h.add(makeScenario("s2"));
    const results = await h.grade();
    expect(results).toHaveLength(2);
    expect(results.every(r => r.passed)).toBe(true);
  });

  it("grade filters by tier", async () => {
    const h = new ParityHarness();
    h.add(makeScenario("unit1", "a", "unit"));
    h.add(makeScenario("int1", "b", "integration"));
    const unitResults = await h.grade(undefined, { tier: "unit" });
    expect(unitResults).toHaveLength(1);
    expect(unitResults[0]!.id).toBe("unit1");
  });

  it("grade with drift → scenario fails", async () => {
    const h = new ParityHarness();
    h.add({ ...makeScenario("s1", "right"), expectedResponse: "wrong" }); // mismatch → drift
    // Wait — makeScenario sets expectedResponse = response. Let me fix:
    // The trace.responses has "right" but expectedResponse is "wrong" → drift
    const results = await h.grade();
    expect(results[0]!.passed).toBe(false);
  });

  it("credentialed tier requires MYA_CREDENTIALED=1", async () => {
    const h = new ParityHarness();
    h.add(makeScenario("c1", "x", "credentialed"));
    await expect(h.grade(undefined, { tier: "credentialed" })).rejects.toThrow(/MYA_CREDENTIALED/);
  });

  it("credentialed tier passes with env set", async () => {
    process.env.MYA_CREDENTIALED = "1";
    const h = new ParityHarness();
    h.add(makeScenario("c1", "x", "credentialed"));
    const results = await h.grade(undefined, { tier: "credentialed" });
    expect(results).toHaveLength(1);
  });

  it("empty harness → empty results", async () => {
    const h = new ParityHarness();
    expect(await h.grade()).toEqual([]);
  });

  it("compressor that shrinks → drift detected", async () => {
    const h = new ParityHarness();
    h.add({
      id: "s1", tier: "unit", description: "multi-msg",
      trace: { messages: [{ role: "user", content: "q" }, { role: "assistant", content: "a" }], responses: ["ok"] },
      expectedResponse: "ok",
    });
    const shrinking = { compress: (h: unknown[]) => h.slice(0, 1), ratio: () => 0.5 };
    const results = await h.grade(shrinking);
    expect(results[0]!.passed).toBe(false);
  });
});

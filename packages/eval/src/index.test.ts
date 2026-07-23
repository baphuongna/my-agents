/**
 * @my-agent/eval — barrel export tests for defaultHarness + keyFactPreserved.
 */
import { describe, it, expect } from "vitest";
import { defaultHarness, keyFactPreserved, identicalPassthrough } from "./index.js";
import { ParityHarness } from "./harness.js";

describe("defaultHarness — pre-loaded mock scenarios", () => {
  it("returns a ParityHarness instance", () => {
    expect(defaultHarness()).toBeInstanceOf(ParityHarness);
  });

  it("ships the identical-passthrough + key-fact-preserved scenarios", async () => {
    const h = defaultHarness();
    const results = await h.grade();
    const ids = results.map((r) => r.id);
    expect(ids).toContain(identicalPassthrough.id);
    expect(ids).toContain(keyFactPreserved.id);
    expect(results).toHaveLength(2);
  });

  it("every built-in scenario passes against the identity compressor", async () => {
    const h = defaultHarness();
    const results = await h.grade();
    for (const r of results) {
      expect(r.passed, `${r.id} should pass`).toBe(true);
    }
  });

  it("summarize counts passes + drifters", async () => {
    const h = defaultHarness();
    const results = await h.grade();
    const summary = h.summarize(results);
    expect(summary.passed).toBe(2);
    expect(summary.failed).toBe(0);
    expect(summary.drifters).toEqual([]);
  });
});

describe("keyFactPreserved — built-in unit scenario", () => {
  it("is a unit-tier scenario", () => {
    expect(keyFactPreserved.tier).toBe("unit");
  });

  it("has a stable id + description", () => {
    expect(keyFactPreserved.id).toBe("02-key-fact-preserved");
    expect(keyFactPreserved.description).toMatch(/key fact/i);
  });

  it("records the deadline fact in the trace and expects it preserved", () => {
    expect(keyFactPreserved.expectedResponse).toBe("The deadline is July 31.");
    const lastResp = keyFactPreserved.trace.responses.at(-1);
    expect(lastResp).toBe("The deadline is July 31.");
    const userTurn = keyFactPreserved.trace.messages.find((m) => m.role === "user");
    expect(userTurn?.content).toMatch(/July 31/);
  });

  it("passes grading against the identity compressor (no drift)", async () => {
    const h = new ParityHarness();
    h.add(keyFactPreserved);
    const [r] = await h.grade();
    expect(r?.passed).toBe(true);
  });

  it("drifts when the expected response is altered", async () => {
    const h = new ParityHarness();
    h.add({ ...keyFactPreserved, expectedResponse: "The deadline is August 15." });
    const [r] = await h.grade();
    expect(r?.passed).toBe(false);
    expect(r?.drifters ?? r?.id).toBeTruthy();
  });
});

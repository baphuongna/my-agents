import { describe, it, expect } from "vitest";
import { validateSchema } from "@my-agent/subagents";

// validateSchema is internal but exported for testing.
describe("§10 subagent resultSchema validation (fail-closed)", () => {
  it("accepts a matching object", () => {
    const r = validateSchema({ a: 1, b: "x" }, {
      type: "object",
      required: ["a", "b"],
      properties: { a: { type: "number" }, b: { type: "string" } },
    });
    expect(r.ok).toBe(true);
  });

  it("rejects a missing required field", () => {
    const r = validateSchema({ a: 1 }, {
      type: "object", required: ["a", "b"],
      properties: { a: { type: "number" }, b: { type: "string" } },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/missing required/);
  });

  it("rejects a wrong type", () => {
    const r = validateSchema({ a: "not-a-number" }, {
      type: "object", properties: { a: { type: "number" } },
    });
    expect(r.ok).toBe(false);
  });

  it("rejects an enum violation", () => {
    const r = validateSchema("maybe", { type: "string", enum: ["yes", "no"] });
    expect(r.ok).toBe(false);
  });

  it("validates array items", () => {
    const r = validateSchema([1, 2, "x"], { type: "array", items: { type: "number" } });
    expect(r.ok).toBe(false);
  });
});

describe("§10 GreenContract verifyGreen (scope + evidence)", () => {
  it("rejects evidence below the required scope", async () => {
    const { verifyGreen } = await import("@my-agent/subagents");
    const r = verifyGreen({ required: "Workspace", evidence: { ran: "TargetedTests", passed: true } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("scope-insufficient");
  });

  it("rejects failed evidence even at the right scope", async () => {
    const { verifyGreen } = await import("@my-agent/subagents");
    const r = verifyGreen({ required: "Package", evidence: { ran: "Package", passed: false, summary: "1 test failed" } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("evidence-failed");
  });

  it("accepts passing evidence at ≥ the required scope", async () => {
    const { verifyGreen } = await import("@my-agent/subagents");
    const r = verifyGreen({ required: "Package", evidence: { ran: "Workspace", passed: true } });
    expect(r.ok).toBe(true);
  });
});

/**
 * @my-agent/eval — tier filtering tests (Phase 7).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ParityHarness } from "./harness.js";
import type { ParityScenario } from "./harness.js";

const unitScenario: ParityScenario = {
  id: "test-unit",
  tier: "unit",
  description: "unit tier test",
  trace: { messages: [{ role: "user", content: "hi" }], responses: ["hello"] },
  expectedResponse: "hello",
};

const integrationScenario: ParityScenario = {
  id: "test-integration",
  tier: "integration",
  description: "integration tier test",
  trace: { messages: [{ role: "user", content: "hi" }], responses: ["hello"] },
  expectedResponse: "hello",
};

const credentialedScenario: ParityScenario = {
  id: "test-credentialed",
  tier: "credentialed",
  description: "credentialed tier test",
  trace: { messages: [{ role: "user", content: "hi" }], responses: ["hello"] },
  expectedResponse: "hello",
};

describe("ParityHarness tier filtering", () => {
  let harness: ParityHarness;

  beforeEach(() => {
    harness = new ParityHarness();
    harness.add(unitScenario);
    harness.add(integrationScenario);
    harness.add(credentialedScenario);
  });

  it("grade() defaults to unit tier only", async () => {
    const results = await harness.grade();
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe("test-unit");
  });

  it("grade({tier:'integration'}) runs integration scenarios", async () => {
    const results = await harness.grade(undefined, { tier: "integration" });
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe("test-integration");
  });

  it("grade({tier:'credentialed'}) throws without MYA_CREDENTIALED=1", async () => {
    delete process.env["MYA_CREDENTIALED"];
    await expect(harness.grade(undefined, { tier: "credentialed" })).rejects.toThrow(
      /MYA_CREDENTIALED/,
    );
  });

  it("grade({tier:'credentialed'}) works with MYA_CREDENTIALED=1", async () => {
    process.env["MYA_CREDENTIALED"] = "1";
    const results = await harness.grade(undefined, { tier: "credentialed" });
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe("test-credentialed");
  });

  it("MYA_CREDENTIALED=0 does NOT enable credentialed tier", async () => {
    process.env["MYA_CREDENTIALED"] = "0";
    await expect(harness.grade(undefined, { tier: "credentialed" })).rejects.toThrow();
  });

  it("gradeAll() runs unit + integration (credentialed only if MYA_CREDENTIALED=1)", async () => {
    delete process.env["MYA_CREDENTIALED"];
    const all = await harness.gradeAll();
    expect(all.unit).toHaveLength(1);
    expect(all.integration).toHaveLength(1);
    expect(all.credentialed).toBeUndefined();
  });

  it("gradeAll() includes credentialed when MYA_CREDENTIALED=1", async () => {
    process.env["MYA_CREDENTIALED"] = "1";
    const all = await harness.gradeAll();
    expect(all.unit).toHaveLength(1);
    expect(all.integration).toHaveLength(1);
    expect(all.credentialed).toHaveLength(1);
  });

  afterEach(() => {
    delete process.env["MYA_CREDENTIALED"];
  });
});

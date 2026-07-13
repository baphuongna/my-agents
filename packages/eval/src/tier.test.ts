/**
 * @my-agent/eval — tier filtering tests (Phase 7).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ParityHarness } from "./harness.js";
import type { ParityScenario } from "./harness.js";
import {
  IntegrationTier,
  CredentialedTier,
  toolCallConversation,
  warnFixtureFreshness,
  FRESHNESS_WARN_DAYS,
} from "./tiers.js";
import type {
  IntegrationScenario,
  CredentialedScenario,
} from "./tiers.js";
import { MockProvider } from "@my-agent/ai";

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

// ─── Integration tier (local MockProvider, no network) ─────────────────────

describe("IntegrationTier", () => {
  it("runs a multi-turn tool-call conversation via MockProvider", async () => {
    const tier = new IntegrationTier();
    tier.add(toolCallConversation);
    const results = await tier.runAll();
    expect(results).toHaveLength(1);
    const r = results[0]!;
    expect(r.passed).toBe(true);
    expect(r.toolCalls).toContain("get_weather");
    expect(r.finalText).toBe("The weather in Paris is sunny.");
  });

  it("fails when an expected tool call never fires", async () => {
    const tier = new IntegrationTier();
    const missing: IntegrationScenario = {
      ...toolCallConversation,
      id: "int-missing-tool",
      expectToolCalls: ["get_weather", "search_web"],
    };
    const r = await tier.run(missing);
    expect(r.passed).toBe(false);
    expect(r.reason).toMatch(/missing tool calls.*search_web/);
  });

  it("fails when the final answer does not match", async () => {
    const tier = new IntegrationTier();
    const wrong: IntegrationScenario = {
      ...toolCallConversation,
      id: "int-wrong-answer",
      expectedResponse: "It is raining.",
    };
    const r = await tier.run(wrong);
    expect(r.passed).toBe(false);
    expect(r.reason).toMatch(/response mismatch/);
  });

  it("collects tool calls across multiple turns", async () => {
    const tier = new IntegrationTier();
    const multi: IntegrationScenario = {
      id: "int-multi-tools",
      description: "two tool calls across two turns",
      turns: [
        {
          trace: {
            id: "m1",
            model: "mock-1",
            events: [
              {
                kind: "tool_calls",
                calls: [{ id: "c1", name: "read_file", args: { path: "a" } }],
              },
              { kind: "done", usage: { input: 1, output: 1 } },
            ],
          },
        },
        {
          trace: {
            id: "m2",
            model: "mock-1",
            events: [
              {
                kind: "tool_calls",
                calls: [{ id: "c2", name: "write_file", args: { path: "b" } }],
              },
              { kind: "text", text: "done" },
              { kind: "done", usage: { input: 1, output: 1 } },
            ],
          },
        },
      ],
      expectToolCalls: ["read_file", "write_file"],
      expectedResponse: "done",
    };
    tier.add(multi);
    const r = (await tier.runAll())[0]!;
    expect(r.passed).toBe(true);
    expect(r.toolCalls).toEqual(["read_file", "write_file"]);
  });
});

// ─── Credentialed tier (real provider, MYA_CREDENTIALED gate) ──────────────

describe("CredentialedTier", () => {
  afterEach(() => {
    delete process.env["MYA_CREDENTIALED"];
  });

  it(".enabled is false without MYA_CREDENTIALED=1", () => {
    delete process.env["MYA_CREDENTIALED"];
    expect(CredentialedTier.enabled).toBe(false);
  });

  it(".enabled is true with MYA_CREDENTIALED=1", () => {
    process.env["MYA_CREDENTIALED"] = "1";
    expect(CredentialedTier.enabled).toBe(true);
  });

  it("run() throws without MYA_CREDENTIALED=1 (no real API calls)", async () => {
    delete process.env["MYA_CREDENTIALED"];
    // MockProvider satisfies ProviderProfile but is never reached: the gate throws first.
    const tier = new CredentialedTier(new MockProvider({ id: "x", model: "m", events: [] }));
    const scenario: CredentialedScenario = {
      id: "cred-1",
      description: "gate test",
      turns: [{ role: "user", content: "hi" }],
      expectedResponse: "hi",
    };
    await expect(tier.run(scenario)).rejects.toThrow(/MYA_CREDENTIALED/);
  });

  it("run() grades the streamed response when the gate is open", async () => {
    process.env["MYA_CREDENTIALED"] = "1";
    // Use MockProvider as the stand-in provider so the gate + grading logic is
    // exercised without real network access (lifts the gate, drives stream()).
    const provider = new MockProvider({
      id: "cred-mock",
      model: "mock-1",
      events: [
        { kind: "text", text: "Hello, world!" },
        { kind: "done", usage: { input: 1, output: 1 } },
      ],
    });
    const tier = new CredentialedTier(provider);
    const scenario: CredentialedScenario = {
      id: "cred-2",
      description: "gate open",
      turns: [{ role: "user", content: "say hello" }],
      expectedResponse: "Hello",
    };
    const r = await tier.run(scenario);
    expect(r.passed).toBe(true);
    expect(r.finalText).toBe("Hello, world!");
  });

  it("run() fails when the streamed response omits the expected substring", async () => {
    process.env["MYA_CREDENTIALED"] = "1";
    const provider = new MockProvider({
      id: "cred-mock",
      model: "mock-1",
      events: [
        { kind: "text", text: "Goodbye." },
        { kind: "done", usage: { input: 1, output: 1 } },
      ],
    });
    const tier = new CredentialedTier(provider);
    const scenario: CredentialedScenario = {
      id: "cred-3",
      description: "mismatch",
      turns: [{ role: "user", content: "say hello" }],
      expectedResponse: "Hello",
    };
    const r = await tier.run(scenario);
    expect(r.passed).toBe(false);
    expect(r.reason).toMatch(/did not contain/);
  });

  it("runAll() throws on the first scenario when the gate is closed", async () => {
    delete process.env["MYA_CREDENTIALED"];
    const tier = new CredentialedTier(new MockProvider({ id: "x", model: "m", events: [] }));
    await expect(
      tier.runAll([
        { id: "c", description: "d", turns: [{ role: "user", content: "hi" }], expectedResponse: "hi" },
      ]),
    ).rejects.toThrow(/MYA_CREDENTIALED/);
  });
});

// ─── Golden fixture freshness gate (30-day warn) ───────────────────────────

describe("warnFixtureFreshness", () => {
  const DAY = 24 * 60 * 60 * 1000;

  it("warns when a fixture is older than 30 days", () => {
    const now = Date.parse("2026-07-13");
    const warnings = warnFixtureFreshness(
      [{ id: "golden-A", recordedAt: now - 45 * DAY }],
      now,
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.id).toBe("golden-A");
    expect(warnings[0]!.ageDays).toBeGreaterThanOrEqual(30);
    expect(warnings[0]!.message).toMatch(/45 days old/);
  });

  it("does not warn for fresh fixtures", () => {
    const now = Date.parse("2026-07-13");
    const warnings = warnFixtureFreshness(
      [{ id: "golden-B", recordedAt: now - 5 * DAY }],
      now,
    );
    expect(warnings).toHaveLength(0);
  });

  it("does not warn when recordedAt is unknown (best-effort)", () => {
    const warnings = warnFixtureFreshness([{ id: "golden-C" }], Date.now());
    expect(warnings).toHaveLength(0);
  });

  it("respects a custom maxAgeDays threshold", () => {
    const now = Date.parse("2026-07-13");
    // 10 days old → stale under a 7-day threshold, fresh under 30.
    const fixtures = [{ id: "golden-D", recordedAt: now - 10 * DAY }];
    expect(warnFixtureFreshness(fixtures, now, 7)).toHaveLength(1);
    expect(warnFixtureFreshness(fixtures, now, 30)).toHaveLength(0);
  });

  it("FRESHNESS_WARN_DAYS is 30", () => {
    expect(FRESHNESS_WARN_DAYS).toBe(30);
  });
});

import { describe, it, expect } from "vitest";
import {
  checkIdleTrigger,
  maybeIdleCompact,
} from "./idle-trigger.js";
import {
  DEFAULT_COMPRESSION_CONFIG,
  CompressionState,
  type CompressionConfig,
  type Message,
} from "./compress.js";

function makeConfig(overrides: Partial<CompressionConfig> = {}): CompressionConfig {
  return { ...DEFAULT_COMPRESSION_CONFIG, idleCompactAfterSeconds: 300, ...overrides };
}

function makeMessages(n: number): Message[] {
  const msgs: Message[] = [];
  for (let i = 0; i < n; i++) {
    msgs.push({ role: i % 2 === 0 ? "user" : "assistant", content: `message ${i} `.repeat(50) });
  }
  return msgs;
}

describe("[unit] checkIdleTrigger", () => {
  it("idle gap below threshold → no trigger", () => {
    const config = makeConfig({ idleCompactAfterSeconds: 300 });
    const state = new CompressionState();
    const decision = checkIdleTrigger({
      config,
      state,
      idleGapSeconds: 100,
      currentTokens: 50_000,
      floorTokens: 1_000,
    });
    expect(decision.shouldCompact).toBe(false);
    expect(decision.reason).toContain("idle gap");
  });

  it("above threshold + tokens > floor → trigger", () => {
    const config = makeConfig({ idleCompactAfterSeconds: 300 });
    const state = new CompressionState();
    const decision = checkIdleTrigger({
      config,
      state,
      idleGapSeconds: 400,
      currentTokens: 50_000,
      floorTokens: 1_000,
    });
    expect(decision.shouldCompact).toBe(true);
    expect(decision.reason).toContain("idle gap 400s");
  });

  it("cooldown active → no trigger", () => {
    const config = makeConfig({ idleCompactAfterSeconds: 300 });
    const state = new CompressionState();
    state.setCooldown(600);
    const decision = checkIdleTrigger({
      config,
      state,
      idleGapSeconds: 400,
      currentTokens: 50_000,
      floorTokens: 1_000,
    });
    expect(decision.shouldCompact).toBe(false);
    expect(decision.reason).toContain("cooldown");
  });

  it("floor check prevents over-summarization (tokens < floor)", () => {
    const config = makeConfig({ idleCompactAfterSeconds: 300 });
    const state = new CompressionState();
    const decision = checkIdleTrigger({
      config,
      state,
      idleGapSeconds: 400,
      currentTokens: 500,
      floorTokens: 5_000,
    });
    expect(decision.shouldCompact).toBe(false);
    expect(decision.reason).toContain("floor");
    expect(decision.reason).toContain("over-summarization");
  });

  it("disabled config → no trigger", () => {
    const config = makeConfig({ enabled: false, idleCompactAfterSeconds: 300 });
    const state = new CompressionState();
    const decision = checkIdleTrigger({
      config,
      state,
      idleGapSeconds: 400,
      currentTokens: 50_000,
      floorTokens: 1_000,
    });
    expect(decision.shouldCompact).toBe(false);
    expect(decision.reason).toContain("disabled");
  });

  it("idleAfterSeconds=0 (not configured) → no trigger", () => {
    const config = makeConfig({ idleCompactAfterSeconds: 0 });
    const state = new CompressionState();
    const decision = checkIdleTrigger({
      config,
      state,
      idleGapSeconds: 400,
      currentTokens: 50_000,
      floorTokens: 1_000,
    });
    expect(decision.shouldCompact).toBe(false);
    expect(decision.reason).toContain("not configured");
  });

  it("at-threshold boundary (exactly idleAfterSeconds) → trigger (>=)", () => {
    const config = makeConfig({ idleCompactAfterSeconds: 300 });
    const state = new CompressionState();
    const decision = checkIdleTrigger({
      config,
      state,
      idleGapSeconds: 300,
      currentTokens: 50_000,
      floorTokens: 1_000,
    });
    expect(decision.shouldCompact).toBe(true);
  });
});

describe("[unit] maybeIdleCompact", () => {
  it("no trigger → messages returned unchanged", async () => {
    const config = makeConfig({ idleCompactAfterSeconds: 300 });
    const state = new CompressionState();
    const messages = makeMessages(50);
    const result = await maybeIdleCompact(
      { config, state, idleGapSeconds: 100, currentTokens: 50_000, floorTokens: 1_000 },
      messages,
      async () => "summary",
    );
    expect(result.decision.shouldCompact).toBe(false);
    // Same reference (no compression ran).
    expect(result.messages).toBe(messages);
  });

  it("trigger → compression runs, messages returned (may differ)", async () => {
    const config = makeConfig({
      idleCompactAfterSeconds: 300,
      protectFirstN: 1,
      protectLastN: 2,
    });
    const state = new CompressionState();
    const messages = makeMessages(50);
    const result = await maybeIdleCompact(
      { config, state, idleGapSeconds: 400, currentTokens: 50_000, floorTokens: 1_000 },
      messages,
      async () => "## Historical Task Snapshot\n\nsummary text",
    );
    expect(result.decision.shouldCompact).toBe(true);
    // Compression ran — the result has a compressed-summary marker somewhere.
    const hasSummary = result.messages.some(
      (m) => typeof m.content === "string" && m.content.includes("compressed summary"),
    );
    expect(hasSummary).toBe(true);
  });

  it("trigger but summaryFn returns null → falls back to static summary", async () => {
    const config = makeConfig({
      idleCompactAfterSeconds: 300,
      protectFirstN: 1,
      protectLastN: 2,
    });
    const state = new CompressionState();
    const messages = makeMessages(50);
    const result = await maybeIdleCompact(
      { config, state, idleGapSeconds: 400, currentTokens: 50_000, floorTokens: 1_000 },
      messages,
      async () => null, // LLM summary failed
    );
    expect(result.decision.shouldCompact).toBe(true);
    // Still got a compressed result (static fallback).
    const hasSummary = result.messages.some(
      (m) => typeof m.content === "string" && m.content.includes("compressed summary"),
    );
    expect(hasSummary).toBe(true);
  });
});

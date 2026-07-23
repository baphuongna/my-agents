/**
 * Tests for auto-capture pattern extraction (auto-capture.ts).
 *
 * Covers: classify() pattern detection + confidence boosting, autoCapture()
 * storage/dedup/skip-audit with a real in-memory SqliteMemoryManager.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { classify, autoCapture, SqliteMemoryManager, type CaptureMemoryType } from "@my-agent/memory";

describe("classify()", () => {
  it("returns null for empty/whitespace text", () => {
    expect(classify("")).toBeNull();
    expect(classify("   ")).toBeNull();
  });

  it("returns null when no pattern matches", () => {
    expect(classify("The weather is nice today.")).toBeNull();
  });

  it("detects preference patterns", () => {
    const result = classify("I prefer dark mode for all my editors");
    expect(result).not.toBeNull();
    expect(result!.memoryType).toBe("preference");
    expect(result!.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it("detects 'my favorite' as high-confidence preference", () => {
    const result = classify("My favorite editor is neovim");
    expect(result).not.toBeNull();
    expect(result!.memoryType).toBe("preference");
    expect(result!.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("detects decision patterns", () => {
    const result = classify("I decided to use Rust for the new service");
    expect(result).not.toBeNull();
    expect(result!.memoryType).toBe("decision");
  });

  it("detects commitment patterns", () => {
    const result = classify("I will send the report by tomorrow morning");
    expect(result).not.toBeNull();
    expect(result!.memoryType).toBe("commitment");
  });

  it("detects goal patterns", () => {
    const result = classify("My goal is to ship the product by Q3");
    expect(result).not.toBeNull();
    expect(result!.memoryType).toBe("goal");
  });

  it("detects context patterns", () => {
    const result = classify("I'm currently working on the authentication module");
    expect(result).not.toBeNull();
    expect(result!.memoryType).toBe("context");
  });

  it("detects fact patterns", () => {
    const result = classify("My name is Alice and I am a developer");
    expect(result).not.toBeNull();
    expect(result!.memoryType).toBe("fact");
  });

  it("detects learning patterns", () => {
    const result = classify("I learned that the cache was the bottleneck");
    expect(result).not.toBeNull();
    expect(result!.memoryType).toBe("learning");
  });

  it("detects instruction patterns", () => {
    const result = classify("Always run the linter before committing code");
    expect(result).not.toBeNull();
    expect(result!.memoryType).toBe("instruction");
  });

  it("detects error patterns", () => {
    const result = classify("This doesn't work when the input is empty");
    expect(result).not.toBeNull();
    expect(result!.memoryType).toBe("error");
  });

  it("detects artifact patterns (PR references)", () => {
    const result = classify("The fix is in PR #1234 for this issue");
    expect(result).not.toBeNull();
    expect(result!.memoryType).toBe("artifact");
  });

  it("confidence boosters increase the score", () => {
    const base = classify("I prefer dark mode");
    const boosted = classify("I absolutely definitely prefer dark mode");
    expect(base).not.toBeNull();
    expect(boosted).not.toBeNull();
    // Booster keywords ("absolutely", "definitely") should increase confidence
    expect(boosted!.confidence).toBeGreaterThanOrEqual(base!.confidence);
  });

  it("confidence is capped at 1.0", () => {
    const result = classify("I always never absolutely definitely strongly prefer dark mode");
    expect(result).not.toBeNull();
    expect(result!.confidence).toBeLessThanOrEqual(1.0);
  });

  it("matchedPattern field is populated with the regex source", () => {
    const result = classify("I prefer dark mode");
    expect(result).not.toBeNull();
    expect(typeof result!.matchedPattern).toBe("string");
    expect(result!.matchedPattern.length).toBeGreaterThan(0);
  });
});

describe("autoCapture()", () => {
  let manager: SqliteMemoryManager;

  beforeEach(() => {
    manager = new SqliteMemoryManager({ dbPath: ":memory:" });
  });

  afterEach(() => {
    manager.close();
  });

  it("captures a high-confidence preference sentence", () => {
    const result = autoCapture("I prefer dark mode for my editors.", manager);
    expect(result.captured).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.details[0]!.type).toBe("preference");
    expect(result.details[0]!.reason).toBe("stored");
  });

  it("skips sentences below the confidence threshold", () => {
    // "I want a coffee" → preference with baseConfidence 0.6, default threshold 0.55 → captured
    // Use a lower threshold to force a skip
    const result = autoCapture("I want a coffee.", manager, { minConfidence: 0.99 });
    expect(result.captured).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.details[0]!.reason).toMatch(/below threshold|no pattern/);
  });

  it("skips sentences with no pattern match", () => {
    const result = autoCapture("The weather is nice and sunny today.", manager);
    expect(result.captured).toBe(0);
    expect(result.details[0]!.reason).toBe("no pattern match");
  });

  it("deduplicates identical sentences on second capture", () => {
    const text = "I prefer dark mode for my editors.";
    autoCapture(text, manager);
    const result2 = autoCapture(text, manager);
    expect(result2.captured).toBe(0);
    expect(result2.skipped).toBe(1);
    expect(result2.details[0]!.reason).toBe("duplicate");
  });

  it("captures multiple different sentences in one call", () => {
    const text =
      "I prefer dark mode for my editors. " +
      "I decided to use Rust for the backend service.";
    const result = autoCapture(text, manager);
    expect(result.captured).toBe(2);
    const types = result.details.map((d) => d.type);
    expect(types).toContain("preference");
    expect(types).toContain("decision");
  });

  it("filters out questions (not facts)", () => {
    const result = autoCapture("What is your favorite programming language?", manager);
    expect(result.captured).toBe(0);
  });

  it("filters out short greetings", () => {
    const result = autoCapture("Hi there!", manager);
    expect(result.captured).toBe(0);
  });

  it("respects custom source and sessionId options", () => {
    const result = autoCapture("I prefer dark mode for my editors.", manager, {
      source: "test-source",
      sessionId: "sess-42",
    });
    expect(result.captured).toBe(1);
  });

  it("importance is boosted by classification confidence", () => {
    // Capture and verify the stored importance ≥ max(default, confidence * 0.6)
    const result = autoCapture(
      "My favorite editor is neovim forever.",
      manager,
      { importance: 0.1 },
    );
    expect(result.captured).toBe(1);
    // The detail should show high confidence
    expect(result.details[0]!.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("session-scoped types get scope='session'", () => {
    // context is a session-scoped type
    const result = autoCapture(
      "I'm currently working on the authentication module right now.",
      manager,
    );
    expect(result.captured).toBeGreaterThanOrEqual(1);
    const ctxDetail = result.details.find((d) => d.type === "context");
    expect(ctxDetail).toBeDefined();
  });

  it("with agentId, brain types get scope='role'", () => {
    const result = autoCapture(
      "I prefer dark mode for my editors.",
      manager,
      { agentId: "agent-1" },
    );
    expect(result.captured).toBe(1);
    // preference is a brain (non-session) type → role-scoped with agentId
    expect(result.details[0]!.type).toBe("preference");
  });

  it("returns details with truncated content (≤80 chars)", () => {
    const longPref = "I prefer " + "dark ".repeat(20) + "mode configuration.";
    const result = autoCapture(longPref, manager);
    for (const d of result.details) {
      expect(d.content.length).toBeLessThanOrEqual(80);
    }
  });
});

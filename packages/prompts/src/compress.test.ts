/**
 * Tests for the context compression engine (Phase 2).
 *
 * Covers:
 *   - shouldIdleCompact (all branches)
 *   - resolveModelThreshold (longest substring match)
 *   - computeThresholdTokens (floors + guards)
 *   - pruneOldToolResults (dedup, summarize, truncate)
 *   - assembleCompressed (role selection, zero-user guard)
 *   - CompressionState (shouldCompress, updateFromResponse, isBlocked)
 *   - generateSummary (template, rolling update, redaction)
 *   - compress (integration: phases 0-4)
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  shouldIdleCompact,
  resolveModelThreshold,
  computeThresholdTokens,
  pruneOldToolResults,
  assembleCompressed,
  CompressionState,
  generateSummary,
  compress,
  isCompressedSummaryMessage,
  DEFAULT_COMPRESSION_CONFIG,
  COMPRESSED_SUMMARY_METADATA_KEY,
  type Message,
  type CompressionConfig,
  type SummaryFn,
} from "./compress.js";
import { setTimeProvider } from "@my-agent/core";

// ─── Message helpers ─────────────────────────────────────────────────────────

function userMsg(content: string): Message {
  return { role: "user", content };
}
function assistantMsg(content: string): Message {
  return { role: "assistant", content };
}
function toolMsg(callId: string, content: string): Message {
  return { role: "tool", tool_call_id: callId, content };
}
function assistantWithToolCalls(
  content: string,
  calls: { id: string; name: string; arguments: string }[],
): Message {
  return {
    role: "assistant",
    content,
    tool_calls: calls.map((c) => ({
      id: c.id,
      type: "function",
      function: { name: c.name, arguments: c.arguments },
    })),
  };
}
function systemMsg(content: string): Message {
  return { role: "system", content };
}

/** Build N trivial messages to exceed the min-size guard. */
function buildConversation(n: number): Message[] {
  const msgs: Message[] = [systemMsg("system"), userMsg("start")];
  for (let i = 0; i < n; i++) {
    msgs.push(assistantMsg(`assistant turn ${i}`));
    msgs.push(userMsg(`user turn ${i}`));
  }
  return msgs;
}

// ─── Fake clock ──────────────────────────────────────────────────────────────

let fakeNow = 1_000_000;
beforeEach(() => {
  fakeNow = 1_000_000;
  setTimeProvider({
    nowWallclock: () => fakeNow,
    nowMonotonic: () => fakeNow,
  });
});
afterEach(() => {
  setTimeProvider({
    nowWallclock: () => Date.now(),
    nowMonotonic: () => Date.now(),
  });
});

// ─── 2.3 shouldIdleCompact ───────────────────────────────────────────────────

describe("shouldIdleCompact", () => {
  it("returns false when disabled", () => {
    expect(
      shouldIdleCompact({
        enabled: false,
        idleAfterSeconds: 60,
        idleGapSeconds: 120,
        tokens: 5000,
        floorTokens: 1000,
        cooldownActive: false,
      }),
    ).toBe(false);
  });

  it("returns false when idleAfterSeconds is 0", () => {
    expect(
      shouldIdleCompact({
        enabled: true,
        idleAfterSeconds: 0,
        idleGapSeconds: 120,
        tokens: 5000,
        floorTokens: 1000,
        cooldownActive: false,
      }),
    ).toBe(false);
  });

  it("returns false when idle gap is less than idleAfterSeconds", () => {
    expect(
      shouldIdleCompact({
        enabled: true,
        idleAfterSeconds: 60,
        idleGapSeconds: 30,
        tokens: 5000,
        floorTokens: 1000,
        cooldownActive: false,
      }),
    ).toBe(false);
  });

  it("returns false when cooldown is active", () => {
    expect(
      shouldIdleCompact({
        enabled: true,
        idleAfterSeconds: 60,
        idleGapSeconds: 120,
        tokens: 5000,
        floorTokens: 1000,
        cooldownActive: true,
      }),
    ).toBe(false);
  });

  it("returns false when tokens are below floor", () => {
    expect(
      shouldIdleCompact({
        enabled: true,
        idleAfterSeconds: 60,
        idleGapSeconds: 120,
        tokens: 500,
        floorTokens: 1000,
        cooldownActive: false,
      }),
    ).toBe(false);
  });

  it("returns true when all conditions are met", () => {
    expect(
      shouldIdleCompact({
        enabled: true,
        idleAfterSeconds: 60,
        idleGapSeconds: 60,
        tokens: 5000,
        floorTokens: 1000,
        cooldownActive: false,
      }),
    ).toBe(true);
  });

  it("returns true when idle gap exceeds threshold", () => {
    expect(
      shouldIdleCompact({
        enabled: true,
        idleAfterSeconds: 60,
        idleGapSeconds: 3600,
        tokens: 5000,
        floorTokens: 1000,
        cooldownActive: false,
      }),
    ).toBe(true);
  });
});

// ─── 2.2 resolveModelThreshold ───────────────────────────────────────────────

describe("resolveModelThreshold", () => {
  it("returns default when no thresholds configured", () => {
    expect(resolveModelThreshold("gpt-4o", {}, 0.5)).toBe(0.5);
  });

  it("returns default when no key matches", () => {
    expect(
      resolveModelThreshold("gpt-4o", { "claude-3": 0.6 }, 0.5),
    ).toBe(0.5);
  });

  it("returns the matching threshold", () => {
    expect(
      resolveModelThreshold("claude-3.5-sonnet", { "claude-3": 0.6 }, 0.5),
    ).toBe(0.6);
  });

  it("returns the longest matching key (most specific)", () => {
    const thresholds = {
      "claude": 0.4,
      "claude-3": 0.6,
      "claude-3.5": 0.7,
    };
    expect(resolveModelThreshold("claude-3.5-sonnet", thresholds, 0.5)).toBe(0.7);
  });

  it("prefers longer match over shorter even if shorter appears first", () => {
    const thresholds: Record<string, number> = {};
    // Insert shorter first, longer second — longest still wins
    thresholds["gpt"] = 0.3;
    thresholds["gpt-4"] = 0.8;
    expect(resolveModelThreshold("gpt-4o", thresholds, 0.5)).toBe(0.8);
  });

  it("handles case sensitivity (model names are case-sensitive)", () => {
    expect(
      resolveModelThreshold("Claude-3", { "claude": 0.6 }, 0.5),
    ).toBe(0.5);
  });
});

// ─── 2.2 computeThresholdTokens ──────────────────────────────────────────────

describe("computeThresholdTokens", () => {
  it("computes threshold for large context with 50%", () => {
    // 1M context × 0.50 = 500_000; 85% ceiling = 850_000; result = 500_000
    expect(computeThresholdTokens(1_000_000, 0.5)).toBe(500_000);
  });

  it("bumps small context (<512K) to at least 75%", () => {
    // 200K × 0.75 = 150K (since 0.75 > 0.50, we use 0.75)
    // 85% ceiling = 170K; result = 150K
    expect(computeThresholdTokens(200_000, 0.5)).toBe(150_000);
  });

  it("floors context at 64K minimum", () => {
    // contextLength = 1000 → effectiveContext = 64_000
    // 1000 < 512K → pct = max(0.5, 0.75) = 0.75
    // threshold = 64_000 × 0.75 = 48_000
    // 85% ceiling = 64_000 × 0.85 = 54_400; result = 48_000
    expect(computeThresholdTokens(1000, 0.5)).toBe(48_000);
  });

  it("applies 85% ceiling when threshold percent exceeds it", () => {
    // If someone sets threshold to 0.90:
    // 128K × 0.90 = 115_200
    // 85% ceiling = 128_000 × 0.85 = 108_800; result = 108_800
    expect(computeThresholdTokens(128_000, 0.9)).toBe(108_800);
  });

  it("respects maxTokens reservation", () => {
    // 1M - 300K = 700K effective; 700K × 0.50 = 350_000
    expect(computeThresholdTokens(1_000_000, 0.5, 300_000)).toBe(350_000);
  });

  it("maxTokens >= ctx falls back to MINIMUM_CONTEXT_LENGTH", () => {
    // 1M - 600K = 400K effective; 400K × 0.50 = 200_000
    expect(computeThresholdTokens(1_000_000, 0.5, 600_000)).toBe(200_000);
  });

  it("returns integer (floored)", () => {
    // 64K × 0.50 = 32_000 (already integer)
    // But ensure floor is applied for non-integer results
    expect(Number.isInteger(computeThresholdTokens(128_000, 0.333))).toBe(true);
  });

  it("handles 64K floor correctly (64K < 512K → small-context bump)", () => {
    // 64K is below 512K small-context limit → pct = max(0.5, 0.75) = 0.75
    // 64_000 × 0.75 = 48_000; 85% ceiling = 54_400; result = 48_000
    expect(computeThresholdTokens(64_000, 0.5)).toBe(48_000);
  });

  it("handles 512K boundary exactly (not bumped)", () => {
    // 512K is NOT < 512K, so pct stays 0.50
    // 512_000 × 0.50 = 256_000; 85% = 435_200; result = 256_000
    expect(computeThresholdTokens(512_000, 0.5)).toBe(256_000);
  });

  it("computes 50% for large context (≥512K)", () => {
    // 600K ≥ 512K → pct stays 0.50
    // 600_000 × 0.50 = 300_000; 85% = 510_000; result = 300_000
    expect(computeThresholdTokens(600_000, 0.5)).toBe(300_000);
  });
});

// ─── 2.4 pruneOldToolResults ─────────────────────────────────────────────────

describe("pruneOldToolResults", () => {
  it("returns messages unchanged when nothing to prune", () => {
    const msgs = [
      systemMsg("sys"),
      userMsg("hello"),
      assistantMsg("hi"),
      userMsg("bye"),
    ];
    const result = pruneOldToolResults(msgs, { protectTailCount: 2 });
    expect(result.prunedCount).toBe(0);
    expect(result.messages).toHaveLength(msgs.length);
    // Content unchanged
    expect(result.messages[1]?.content).toBe("hello");
  });

  it("deduplicates identical long tool results (Pass 1)", () => {
    const longContent = "x".repeat(300);
    const msgs: Message[] = [
      systemMsg("sys"),
      assistantWithToolCalls("", [{ id: "c1", name: "bash", arguments: "{}" }]),
      toolMsg("c1", longContent),
      assistantWithToolCalls("", [{ id: "c2", name: "bash", arguments: "{}" }]),
      toolMsg("c2", longContent), // duplicate of c1
      userMsg("latest — protected"), // protected tail
    ];
    // protectTailCount=1 → protectedStart=5 → indices 0–4 are prunable
    const result = pruneOldToolResults(msgs, { protectTailCount: 1 });
    // Pass 1 deduplicates: the FIRST occurrence (c1, index 2) is added to
    // the hash set; the SECOND occurrence (c2, index 4) gets the marker.
    const dupTool = result.messages.find(
      (m) => m.role === "tool" && m.tool_call_id === "c2",
    );
    expect(dupTool?.content).toContain("Duplicate tool output");
    // c1 was summarized by Pass 2 (it was the first in the hash set)
    const firstTool = result.messages.find(
      (m) => m.role === "tool" && m.tool_call_id === "c1",
    );
    expect(firstTool?.content).toContain("[Truncated tool output]");
    expect(result.prunedCount).toBeGreaterThanOrEqual(2);
  });

  it("replaces long tool results with summary (Pass 2)", () => {
    const longContent = "Line one\nLine two\n".repeat(20); // >200 chars
    const msgs: Message[] = [
      systemMsg("sys"),
      assistantWithToolCalls("", [{ id: "c1", name: "bash", arguments: "{}" }]),
      toolMsg("c1", longContent),
      userMsg("latest user"),
    ];
    const result = pruneOldToolResults(msgs, { protectTailCount: 1 });
    const toolEntry = result.messages.find((m) => m.role === "tool");
    expect(toolEntry?.content).toContain("[Truncated tool output]");
    expect(toolEntry?.content.length).toBeLessThan(longContent.length);
    expect(result.prunedCount).toBeGreaterThanOrEqual(1);
  });

  it("does not prune tool results ≤200 chars", () => {
    const shortContent = "x".repeat(150);
    const msgs: Message[] = [
      systemMsg("sys"),
      assistantWithToolCalls("", [{ id: "c1", name: "read", arguments: "{}" }]),
      toolMsg("c1", shortContent),
      userMsg("latest"),
    ];
    const result = pruneOldToolResults(msgs, { protectTailCount: 1 });
    const toolEntry = result.messages.find((m) => m.role === "tool");
    expect(toolEntry?.content).toBe(shortContent);
    expect(result.prunedCount).toBe(0);
  });

  it("truncates tool_calls args JSON >500 chars (Pass 3)", () => {
    const longArgs = JSON.stringify({
      data: "A".repeat(600),
      more: { nested: "B".repeat(400) },
    });
    const msgs: Message[] = [
      systemMsg("sys"),
      assistantWithToolCalls("", [{ id: "c1", name: "write", arguments: longArgs }]),
      toolMsg("c1", "done"),
      userMsg("latest"),
    ];
    const result = pruneOldToolResults(msgs, { protectTailCount: 1 });
    const assistant = result.messages.find((m) => m.role === "assistant");
    const tc = assistant?.tool_calls?.[0];
    expect(tc).toBeDefined();
    expect(tc!.function.arguments.length).toBeLessThan(longArgs.length);
    // Result should still be valid JSON (parse + shrink + stringify)
    expect(() => JSON.parse(tc!.function.arguments)).not.toThrow();
    expect(result.prunedCount).toBeGreaterThanOrEqual(1);
  });

  it("falls back to raw slice when args is not valid JSON", () => {
    const longArgs = "{invalid json " + "x".repeat(600);
    const msgs: Message[] = [
      systemMsg("sys"),
      assistantWithToolCalls("", [{ id: "c1", name: "write", arguments: longArgs }]),
      toolMsg("c1", "done"),
      userMsg("latest"),
    ];
    const result = pruneOldToolResults(msgs, { protectTailCount: 1 });
    const assistant = result.messages.find((m) => m.role === "assistant");
    const tc = assistant?.tool_calls?.[0];
    expect(tc!.function.arguments.length).toBeLessThan(longArgs.length);
    expect(tc!.function.arguments).toContain("[truncated]");
  });

  it("protects tail messages from all passes", () => {
    const longContent = "x".repeat(300);
    const msgs: Message[] = [
      systemMsg("sys"),
      assistantWithToolCalls("", [{ id: "c1", name: "bash", arguments: "{}" }]),
      toolMsg("c1", longContent),
      assistantWithToolCalls("", [{ id: "c2", name: "bash", arguments: "{}" }]),
      toolMsg("c2", longContent), // in protected tail
    ];
    const result = pruneOldToolResults(msgs, { protectTailCount: 2 });
    // The tail tool result should be unchanged
    const tailTool = result.messages[result.messages.length - 1];
    expect(tailTool?.content).toBe(longContent);
  });

  it("uses protectTailTokens to compute boundary", () => {
    // 3 tool messages of ~100 tokens each; protectTailTokens = 150 → protect ~1-2
    const content = "y".repeat(400); // ~100 tokens
    const msgs: Message[] = [
      systemMsg("sys"),
      toolMsg("t1", content),
      toolMsg("t2", content),
      toolMsg("t3", content),
      userMsg("latest"),
    ];
    const result = pruneOldToolResults(msgs, {
      protectTailCount: 1,
      protectTailTokens: 150,
    });
    // At least the last message should be protected
    expect(result.messages[result.messages.length - 1]?.content).toBe("latest");
    // Some pruning should have occurred on earlier messages
    expect(result.prunedCount).toBeGreaterThanOrEqual(1);
  });
});

// ─── 2.6 assembleCompressed ──────────────────────────────────────────────────

describe("assembleCompressed", () => {
  it("sets summary role to user when head ends with assistant", () => {
    const head = [systemMsg("sys"), assistantMsg("hello")];
    const tail = [userMsg("latest")];
    const result = assembleCompressed(head, "summary text", tail);
    const summary = result.find((m) => m.content.includes("summary text"));
    expect(summary?.role).toBe("user");
  });

  it("sets summary role to user when head is empty (force user-leading, no tail collision)", () => {
    // head empty → forceUserLeading=true → summary=user
    // tail starts with assistant → no collision → summary stays user
    const tail = [assistantMsg("response")];
    const result = assembleCompressed([], "summary text", tail);
    const summary = result.find((m) => m.content.includes("summary text"));
    expect(summary?.role).toBe("user");
  });

  it("flips to assistant when head empty and tail starts with user (collision)", () => {
    // head empty → forceUserLeading=true → summary=user
    // tail starts with user → collision → flip to assistant (safe: no head)
    const tail = [userMsg("latest")];
    const result = assembleCompressed([], "summary text", tail);
    const summary = result.find((m) => m.content.includes("summary text"));
    expect(summary?.role).toBe("assistant");
  });

  it("sets summary role to user when head ends with system (no tail collision)", () => {
    // head ends with system → forceUserLeading=true → summary=user
    // tail starts with assistant → no collision → stays user
    const head = [systemMsg("sys")];
    const tail = [assistantMsg("response")];
    const result = assembleCompressed(head, "summary text", tail);
    const summary = result.find((m) => m.content.includes("summary text"));
    expect(summary?.role).toBe("user");
  });

  it("flips to assistant when head ends with system and tail starts with user", () => {
    // head ends with system → forceUserLeading=true → summary=user
    // tail starts with user → collision → flip to assistant
    // assistant ≠ system (head last) → flip safe → summary=assistant
    const head = [systemMsg("sys")];
    const tail = [userMsg("latest")];
    const result = assembleCompressed(head, "summary text", tail);
    const summary = result.find((m) => m.content.includes("summary text"));
    expect(summary?.role).toBe("assistant");
  });

  it("sets summary role to assistant when head ends with user and tail starts with user", () => {
    const head = [systemMsg("sys"), userMsg("old question")];
    const tail = [userMsg("latest")]; // tail starts with user
    const result = assembleCompressed(head, "summary text", tail);
    const summary = result.find((m) => m.content.includes("summary text"));
    // Head ends with user → summary = assistant; tail starts with user → no collision
    expect(summary?.role).toBe("assistant");
  });

  it("flips summary role to avoid collision with tail", () => {
    const head = [systemMsg("sys"), assistantMsg("hello")];
    const tail = [assistantMsg("response")]; // tail starts with assistant
    const result = assembleCompressed(head, "summary text", tail);
    const summary = result.find((m) => m.content.includes("summary text"));
    // Head ends with assistant → summary = user
    // Tail starts with assistant → no collision (user ≠ assistant)
    expect(summary?.role).toBe("user");
  });

  it("flips to user when head=assistant, summary=user, tail starts with user but flip is safe", () => {
    // head ends with user, tail starts with assistant → summary = assistant
    // but we want: head ends with system, tail starts with user
    const head = [systemMsg("sys")];
    const tail = [userMsg("latest")];
    const result = assembleCompressed(head, "summary text", tail);
    const summary = result.find((m) => m.content.includes("summary text"));
    // head ends with system → forceUserLeading → summary = user
    // tail starts with user → collision → flip to assistant
    // assistant ≠ system (head last) → flip safe → summary = assistant
    expect(summary?.role).toBe("assistant");
  });

  it("triggers zero-user guard when no user survives", () => {
    const head = [systemMsg("sys"), assistantMsg("response")];
    const tail = [assistantMsg("response2")]; // no user anywhere
    const result = assembleCompressed(head, "summary text", tail);
    const summary = result.find((m) => m.content.includes("summary text"));
    // No user in head+tail → force user leading → summary = user
    // tail starts with assistant → no collision
    expect(summary?.role).toBe("user");
  });

  it("marks summary message with _compressedSummary metadata", () => {
    const result = assembleCompressed([], "summary text", []);
    const summary = result[0];
    expect(summary).toBeDefined();
    expect(isCompressedSummaryMessage(summary!)).toBe(true);
    expect(summary![COMPRESSED_SUMMARY_METADATA_KEY]).toBe(true);
  });

  it("prepends SUMMARY_PREFIX directive to content", () => {
    const result = assembleCompressed([], "my summary", []);
    const summary = result[0];
    expect(summary?.content).toContain("my summary");
    expect(summary?.content).toContain("Respond ONLY to the latest user message");
  });

  it("preserves head and tail order", () => {
    const head = [systemMsg("h1"), userMsg("h2")];
    const tail = [assistantMsg("t1"), userMsg("t2")];
    const result = assembleCompressed(head, "S", tail);
    expect(result).toHaveLength(5);
    expect(result[0]?.content).toBe("h1");
    expect(result[1]?.content).toBe("h2");
    // index 2 = summary
    expect(result[3]?.content).toBe("t1");
    expect(result[4]?.content).toBe("t2");
  });
});

// ─── 2.7 CompressionState ───────────────────────────────────────────────────

describe("CompressionState", () => {
  let state: CompressionState;

  beforeEach(() => {
    state = new CompressionState();
  });

  describe("shouldCompress", () => {
    it("returns false when tokens below threshold", () => {
      expect(state.shouldCompress(100, 200)).toBe(false);
    });

    it("returns true when tokens at or above threshold and not blocked", () => {
      expect(state.shouldCompress(200, 200)).toBe(true);
      expect(state.shouldCompress(300, 200)).toBe(true);
    });

    it("returns false when blocked (ineffectiveCount ≥ 2)", () => {
      state.ineffectiveCount = 2;
      expect(state.shouldCompress(500, 200)).toBe(false);
    });

    it("returns false when blocked (fallbackStreak ≥ 2 + cooldown)", () => {
      state.fallbackStreak = 2;
      state.setCooldown(); // fallbackStreak always comes with cooldown
      expect(state.shouldCompress(500, 200)).toBe(false);
    });
  });

  describe("updateFromResponse", () => {
    it("increments ineffectiveCount when still over threshold after compaction", () => {
      expect(state.ineffectiveCount).toBe(0);
      state.updateFromResponse(300, 200);
      expect(state.ineffectiveCount).toBe(1);
    });

    it("does not increment when under threshold", () => {
      state.updateFromResponse(150, 200);
      expect(state.ineffectiveCount).toBe(0);
    });

    it("resets ineffectiveCount to 0 when under threshold (prevents permanent deadlock)", () => {
      state.updateFromResponse(300, 200); // over → count=1
      state.updateFromResponse(300, 200); // over → count=2
      expect(state.ineffectiveCount).toBe(2);
      state.updateFromResponse(150, 200); // under → reset to 0
      expect(state.ineffectiveCount).toBe(0);
    });

    it("increments at exact threshold boundary", () => {
      state.updateFromResponse(200, 200);
      expect(state.ineffectiveCount).toBe(1);
    });
  });

  describe("isBlocked", () => {
    it("returns false when all counters are zero and no cooldown", () => {
      expect(state.isBlocked()).toBe(false);
    });

    it("returns true when cooldown is active", () => {
      state.cooldownUntil = fakeNow + 60_000;
      expect(state.isBlocked()).toBe(true);
    });

    it("returns false when cooldown has expired", () => {
      state.cooldownUntil = fakeNow - 1000;
      expect(state.isBlocked()).toBe(false);
    });

    it("returns true when ineffectiveCount reaches 2", () => {
      state.ineffectiveCount = 1;
      expect(state.isBlocked()).toBe(false);
      state.ineffectiveCount = 2;
      expect(state.isBlocked()).toBe(true);
    });

    it("returns true when fallbackStreak reaches 2 with cooldown", () => {
      state.fallbackStreak = 1;
      expect(state.isBlocked()).toBe(false);
      state.fallbackStreak = 2;
      state.setCooldown(); // fallbackStreak always comes with cooldown
      expect(state.isBlocked()).toBe(true);
    });

    it("resets fallbackStreak after cooldown expires", () => {
      state.fallbackStreak = 2;
      state.setCooldown(0); // expired immediately (0 seconds)
      expect(state.isBlocked()).toBe(false); // cooldown expired + fallbackStreak reset
      expect(state.fallbackStreak).toBe(0);
    });
  });

  describe("setCooldown", () => {
    it("sets cooldownUntil to now + seconds * 1000", () => {
      state.setCooldown(120);
      expect(state.cooldownUntil).toBe(fakeNow + 120_000);
    });

    it("uses default 600s", () => {
      state.setCooldown();
      expect(state.cooldownUntil).toBe(fakeNow + 600_000);
    });
  });

  describe("reset", () => {
    it("clears all counters and cooldown", () => {
      state.ineffectiveCount = 5;
      state.fallbackStreak = 3;
      state.cooldownUntil = fakeNow + 999_999;
      state.reset();
      expect(state.ineffectiveCount).toBe(0);
      expect(state.fallbackStreak).toBe(0);
      expect(state.cooldownUntil).toBe(0);
      expect(state.isBlocked()).toBe(false);
    });
  });
});

// ─── 2.5 generateSummary ─────────────────────────────────────────────────────

describe("generateSummary", () => {
  it("uses first-compaction template (no previousSummary)", async () => {
    let capturedPrompt = "";
    const summaryFn: SummaryFn = async (prompt) => {
      capturedPrompt = prompt;
      return "## Goal\nDo something";
    };
    const turns: Message[] = [
      userMsg("Fix the bug"),
      assistantMsg("I'll look into it"),
    ];
    const result = await generateSummary(turns, { summaryFn });
    expect(result).toBe("## Goal\nDo something");
    expect(capturedPrompt).toContain("TURNS TO SUMMARIZE:");
    expect(capturedPrompt).toContain("Fix the bug");
    expect(capturedPrompt).toContain("## Goal");
    expect(capturedPrompt).toContain("## Critical Context");
  });

  it("uses rolling-update template when previousSummary is provided", async () => {
    let capturedPrompt = "";
    const summaryFn: SummaryFn = async (prompt) => {
      capturedPrompt = prompt;
      return "Updated summary";
    };
    const turns: Message[] = [userMsg("New turn")];
    const result = await generateSummary(turns, {
      previousSummary: "## Goal\nOld goal",
      summaryFn,
    });
    expect(result).toBe("Updated summary");
    expect(capturedPrompt).toContain("PREVIOUS SUMMARY:");
    expect(capturedPrompt).toContain("Old goal");
    expect(capturedPrompt).toContain("NEW TURNS TO INCORPORATE:");
    expect(capturedPrompt).toContain("PRESERVE all existing information");
  });

  it("includes focusTopic and memoryContext in the prompt", async () => {
    let capturedPrompt = "";
    const summaryFn: SummaryFn = async (prompt) => {
      capturedPrompt = prompt;
      return "summary";
    };
    await generateSummary([userMsg("hi")], {
      focusTopic: "Authentication refactoring",
      memoryContext: "User prefers functional style",
      summaryFn,
    });
    expect(capturedPrompt).toContain("Authentication refactoring");
    expect(capturedPrompt).toContain("User prefers functional style");
  });

  it("returns null when summaryFn returns null", async () => {
    const summaryFn: SummaryFn = async () => null;
    const result = await generateSummary([userMsg("hi")], { summaryFn });
    expect(result).toBeNull();
  });

  it("returns null when summaryFn throws", async () => {
    const summaryFn: SummaryFn = async () => {
      throw new Error("LLM error");
    };
    const result = await generateSummary([userMsg("hi")], { summaryFn });
    expect(result).toBeNull();
  });

  it("redacts secrets in the prompt and output", async () => {
    let capturedPrompt = "";
    const summaryFn: SummaryFn = async (prompt) => {
      capturedPrompt = prompt;
      return "The key is sk-1234567890abcdef";
    };
    const result = await generateSummary(
      [userMsg("My key is ghp_1234567890abcdefghijklmnop")],
      { summaryFn },
    );
    // Input should be redacted in the prompt
    expect(capturedPrompt).not.toContain("ghp_1234567890abcdefghijklmnop");
    // Output should also be redacted
    expect(result).not.toContain("sk-1234567890abcdef");
  });

  it("includes tool call names in the serialized turns", async () => {
    let capturedPrompt = "";
    const summaryFn: SummaryFn = async (prompt) => {
      capturedPrompt = prompt;
      return "summary";
    };
    const turns: Message[] = [
      assistantWithToolCalls("", [
        { id: "c1", name: "read", arguments: "{}" },
        { id: "c2", name: "edit", arguments: "{}" },
      ]),
    ];
    await generateSummary(turns, { summaryFn });
    expect(capturedPrompt).toContain("read");
    expect(capturedPrompt).toContain("edit");
  });
});

// ─── 2.8 compress (integration) ──────────────────────────────────────────────

describe("compress", () => {
  it("returns messages unchanged when config is disabled", async () => {
    const config: CompressionConfig = {
      ...DEFAULT_COMPRESSION_CONFIG,
      enabled: false,
    };
    const state = new CompressionState();
    const msgs = buildConversation(20);
    const result = await compress(msgs, config, state, async () => "summary");
    expect(result).toBe(msgs);
  });

  it("returns messages unchanged when too few messages (min-size guard)", async () => {
    const state = new CompressionState();
    const msgs = [systemMsg("s"), userMsg("u"), assistantMsg("a")];
    // protectFirstN = 3, minSize = 3 + 4 = 7; 3 <= 7 → guard
    const result = await compress(
      msgs,
      DEFAULT_COMPRESSION_CONFIG,
      state,
      async () => "summary",
    );
    expect(result).toBe(msgs);
    expect(state.ineffectiveCount).toBe(1);
  });

  it("returns messages unchanged when anti-thrashing blocks", async () => {
    const state = new CompressionState();
    state.ineffectiveCount = 2;
    const msgs = buildConversation(20);
    const result = await compress(
      msgs,
      DEFAULT_COMPRESSION_CONFIG,
      state,
      async () => "summary",
    );
    expect(result).toBe(msgs);
  });

  it("force=true bypasses anti-thrashing and enabled=false", async () => {
    const config: CompressionConfig = {
      ...DEFAULT_COMPRESSION_CONFIG,
      enabled: false,
    };
    const state = new CompressionState();
    state.ineffectiveCount = 5;
    state.cooldownUntil = fakeNow + 999_999;
    const msgs = buildConversation(20);
    const result = await compress(msgs, config, state, async () => "summary", {
      force: true,
    });
    // Should have compressed
    expect(result).not.toBe(msgs);
    expect(result.length).toBeLessThan(msgs.length);
  });

  it("compresses messages and includes a summary marker", async () => {
    const state = new CompressionState();
    const msgs = buildConversation(20);
    const result = await compress(msgs, DEFAULT_COMPRESSION_CONFIG, state, async () => "## Goal\nTest summary");
    // Should have fewer messages than original (turns collapsed into summary)
    expect(result.length).toBeLessThan(msgs.length);
    // Should contain a compressed summary message
    const summaryMsgs = result.filter(isCompressedSummaryMessage);
    expect(summaryMsgs.length).toBe(1);
    // Summary should contain the LLM output
    expect(summaryMsgs[0]?.content).toContain("Test summary");
  });

  it("falls back to static summary when summaryFn returns null", async () => {
    const state = new CompressionState();
    const msgs = buildConversation(20);
    const result = await compress(msgs, DEFAULT_COMPRESSION_CONFIG, state, async () => null);
    // Should still produce a compressed result with a fallback summary
    const summaryMsgs = result.filter(isCompressedSummaryMessage);
    expect(summaryMsgs.length).toBe(1);
    expect(summaryMsgs[0]?.content).toContain("## Historical Task Snapshot");
    expect(summaryMsgs[0]?.content).toContain("fallback");
    // Fallback streak should increment
    expect(state.fallbackStreak).toBe(1);
    // Cooldown should be set
    expect(state.cooldownUntil).toBeGreaterThan(fakeNow);
  });

  it("preserves head (protectFirstN) and tail (protectLastN) messages", async () => {
    const state = new CompressionState();
    const config: CompressionConfig = {
      ...DEFAULT_COMPRESSION_CONFIG,
      protectFirstN: 2,
      protectLastN: 3,
    };
    const msgs: Message[] = [
      systemMsg("head-sys"),
      userMsg("head-user"),
      ...buildConversation(15),
      userMsg("tail-user-1"),
      assistantMsg("tail-asst"),
      userMsg("tail-user-2"),
    ];
    const result = await compress(msgs, config, state, async () => "summary");
    // First message should be preserved
    expect(result[0]?.content).toBe("head-sys");
    // Last messages should be preserved
    expect(result[result.length - 1]?.content).toBe("tail-user-2");
    expect(result[result.length - 2]?.content).toBe("tail-asst");
  });

  it("passes focusTopic and memoryContext through to generateSummary", async () => {
    let capturedPrompt = "";
    const state = new CompressionState();
    const msgs = buildConversation(20);
    await compress(
      msgs,
      DEFAULT_COMPRESSION_CONFIG,
      state,
      async (prompt) => {
        capturedPrompt = prompt;
        return "summary";
      },
      {
        focusTopic: "API migration",
        memoryContext: "User prefers TypeScript",
      },
    );
    expect(capturedPrompt).toContain("API migration");
    expect(capturedPrompt).toContain("TypeScript");
  });

  it("clears cooldown when force=true", async () => {
    const state = new CompressionState();
    state.cooldownUntil = fakeNow + 999_999;
    const msgs = buildConversation(20);
    await compress(msgs, DEFAULT_COMPRESSION_CONFIG, state, async () => "s", {
      force: true,
    });
    expect(state.cooldownUntil).toBe(0);
  });
});

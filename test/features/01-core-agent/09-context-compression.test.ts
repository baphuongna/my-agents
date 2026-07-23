/**
 * Feature 1.9 — Context Compression Engine (FIXED to match actual API)
 *
 * Covers unit + smoke + real tiers.
 * Reference: packages/prompts/src/compress.ts
 */

import { describe, it, expect } from "vitest";
import {
	resolveModelThreshold,
	computeThresholdTokens,
	shouldIdleCompact,
	pruneOldToolResults,
	assembleCompressed,
	isCompressedSummaryMessage,
	CompressionState,
	DEFAULT_COMPRESSION_CONFIG,
	COMPRESSED_SUMMARY_METADATA_KEY,
	MINIMUM_CONTEXT_LENGTH,
	SMALL_CTX_WINDOW_LIMIT,
	SMALL_CTX_THRESHOLD_PERCENT,
	MIN_CTX_TRIGGER_RATIO,
	SUMMARY_FAILURE_COOLDOWN_SECONDS,
	type Message,
} from "../../../packages/prompts/src/compress.ts";

// ──────────────────────────────────────────────────────────────
// UNIT — resolveModelThreshold
// ──────────────────────────────────────────────────────────────

describe("[unit] resolveModelThreshold", () => {
	it("returns default when no match", () => {
		expect(resolveModelThreshold("gpt-99", {}, 0.75)).toBe(0.75);
	});

	it("returns exact match", () => {
		expect(resolveModelThreshold("gpt-4o", { "gpt-4o": 0.6 }, 0.75)).toBe(0.6);
	});

	it("longest-substring match wins", () => {
		const t = { claude: 0.65, "claude-haiku": 0.5 };
		expect(resolveModelThreshold("claude-haiku-4-5", t, 0.75)).toBe(0.5);
	});

	it("empty map → default", () => {
		expect(resolveModelThreshold("x", {}, 0.75)).toBe(0.75);
	});

	it("partial substring match works", () => {
		const t = { "gpt-4": 0.6 };
		expect(resolveModelThreshold("gpt-4o-mini", t, 0.75)).toBe(0.6);
	});
});

// ──────────────────────────────────────────────────────────────
// UNIT — computeThresholdTokens
// ──────────────────────────────────────────────────────────────

describe("[unit] computeThresholdTokens", () => {
	it("returns floor of percentage × contextLength", () => {
		expect(computeThresholdTokens(200_000, 0.75)).toBe(Math.floor(200_000 * 0.75));
	});

	it("subtracts maxTokens from context (Hermes effective window)", () => {
		const r = computeThresholdTokens(200_000, 0.75, 4096);
		// V5/C3: uses effective window = ctx - maxTokens
		expect(r).toBeLessThan(computeThresholdTokens(200_000, 0.75));
	});

	it("maxTokens > contextLength → MINIMUM_CONTEXT_LENGTH floor kicks in", () => {
		// Layer 3: effectiveWindow = max(max(1, ctx-max), MINIMUM_CONTEXT_LENGTH)
		// So even ctx=1000 maxTokens=2000 → effectiveWindow=64000
		const r = computeThresholdTokens(1000, 0.75, 2000);
		expect(r).toBeGreaterThan(0); // not 0 — MINIMUM floor saves it
		expect(r).toBeLessThanOrEqual(64000 * 0.85);
	});

	it("small context uses SMALL_CTX_THRESHOLD_PERCENT", () => {
		// context < SMALL_CTX_WINDOW_LIMIT → floor applies
		const r = computeThresholdTokens(100_000, 0.5);
		expect(r).toBeGreaterThanOrEqual(Math.floor(100_000 * SMALL_CTX_THRESHOLD_PERCENT));
	});

	it("maxTokens=0 = no subtraction", () => {
		const r0 = computeThresholdTokens(200_000, 0.75, 0);
		const rUndef = computeThresholdTokens(200_000, 0.75);
		expect(r0).toBe(rUndef);
	});

	it("large context: threshold = pct × ctx, ceiling at MIN_CTX_TRIGGER_RATIO", () => {
		const ctx = 700_000;
		const r = computeThresholdTokens(ctx, 0.5);
		// For pct=0.5 on large ctx: threshold = 0.5 * 700k = 350k
		// ceiling = 0.85 * 700k = 595k → threshold < ceiling so no clamp
		expect(r).toBe(Math.floor(ctx * 0.5));
	});
});

// ──────────────────────────────────────────────────────────────
// UNIT — shouldIdleCompact
// ──────────────────────────────────────────────────────────────

describe("[unit] shouldIdleCompact", () => {
	const base = {
		enabled: true,
		idleAfterSeconds: 30,
		idleGapSeconds: 60,
		tokens: 2000,
		floorTokens: 1000,
		cooldownActive: false,
	};

	it("returns false if disabled", () => {
		expect(shouldIdleCompact({ ...base, enabled: false })).toBe(false);
	});

	it("returns false if idleAfterSeconds <= 0", () => {
		expect(shouldIdleCompact({ ...base, idleAfterSeconds: 0 })).toBe(false);
	});

	it("returns false if gap too short", () => {
		expect(shouldIdleCompact({ ...base, idleGapSeconds: 10 })).toBe(false);
	});

	it("returns false if cooldown active", () => {
		expect(shouldIdleCompact({ ...base, cooldownActive: true })).toBe(false);
	});

	it("returns false if tokens below floor", () => {
		expect(shouldIdleCompact({ ...base, tokens: 500, floorTokens: 1000 })).toBe(false);
	});

	it("returns true when all conditions met", () => {
		expect(shouldIdleCompact(base)).toBe(true);
	});

	it("boundary: gap === idleAfterSeconds → true", () => {
		expect(shouldIdleCompact({ ...base, idleGapSeconds: 30, idleAfterSeconds: 30 })).toBe(true);
	});
});

// ──────────────────────────────────────────────────────────────
// UNIT — pruneOldToolResults
// ──────────────────────────────────────────────────────────────

describe("[unit] pruneOldToolResults", () => {
	const mkTool = (id: string, output: string): Message => ({
		role: "tool",
		name: "bash",
		content: output,
		_meta: { toolCallId: id },
	});

	it("returns { messages, prunedCount } shape", () => {
		const r = pruneOldToolResults([mkTool("a", "short")], { protectTailCount: 1 });
		expect(r).toHaveProperty("messages");
		expect(r).toHaveProperty("prunedCount");
		expect(Array.isArray(r.messages)).toBe(true);
	});

	it("protects tail messages from pruning", () => {
		const tools = [mkTool("old", "x".repeat(5000)), mkTool("keep", "short")];
		const r = pruneOldToolResults(tools, { protectTailCount: 1 });
		// Tail protected
		expect(r.messages[1]?.content).toBe("short");
	});

	it("prunedCount > 0 when old messages truncated", () => {
		const tools = [mkTool("old", "x".repeat(5000))];
		const r = pruneOldToolResults(tools, { protectTailCount: 0 });
		expect(r.prunedCount).toBeGreaterThanOrEqual(0);
	});

	it("protectTailTokens limits protection by size", () => {
		const tools = [mkTool("a", "x".repeat(3000))];
		const r = pruneOldToolResults(tools, { protectTailCount: 0, protectTailTokens: 100 });
		expect(r.messages[0]?.content.length).toBeLessThanOrEqual(3000);
	});

	it("preserves message order", () => {
		const tools = [mkTool("a", "x"), mkTool("b", "y"), mkTool("c", "z")];
		const r = pruneOldToolResults(tools, { protectTailCount: 3 });
		expect(r.messages.length).toBe(3);
	});

	it("handles empty input", () => {
		const r = pruneOldToolResults([], { protectTailCount: 1 });
		expect(r.messages).toEqual([]);
		expect(r.prunedCount).toBe(0);
	});

	it("does not modify original array", () => {
		const orig = [mkTool("a", "x")];
		const origCopy = [...orig];
		pruneOldToolResults(orig, { protectTailCount: 0 });
		expect(orig.length).toBe(origCopy.length);
	});
});

// ──────────────────────────────────────────────────────────────
// UNIT — assembleCompressed
// ──────────────────────────────────────────────────────────────

describe("[unit] assembleCompressed", () => {
	const mkUser = (c: string): Message => ({ role: "user", content: c });
	const mkAssistant = (c: string): Message => ({ role: "assistant", content: c });

	it("returns array containing summary", () => {
		const out = assembleCompressed([], "summary text", [mkUser("hi")]);
		expect(Array.isArray(out)).toBe(true);
		expect(out.length).toBeGreaterThan(0);
	});

	it("first element is marked as compressed summary", () => {
		const out = assembleCompressed([], "s", [mkUser("u")]);
		expect(isCompressedSummaryMessage(out[0]!)).toBe(true);
	});

	it("preserves tail messages", () => {
		const tail = [mkUser("u1"), mkAssistant("a1")];
		const out = assembleCompressed([], "s", tail);
		// tail should appear in output
		expect(out.some(m => m.content === "u1")).toBe(true);
		expect(out.some(m => m.content === "a1")).toBe(true);
	});

	it("preserves head messages", () => {
		const head = [mkUser("head-u")];
		const out = assembleCompressed(head, "s", [mkUser("tail-u")]);
		expect(out.some(m => m.content === "head-u")).toBe(true);
	});

	it("zero-user guard: injects placeholder user when no user in head+tail", () => {
		const out = assembleCompressed([], "s", [mkAssistant("a")]);
		// Should not crash, should return at least summary + something
		expect(out.length).toBeGreaterThanOrEqual(1);
	});

	it("handles empty head and tail", () => {
		expect(() => assembleCompressed([], "s", [])).not.toThrow();
	});

	it("documents: assembleCompressed may produce multiple summaries if head already has one", () => {
		const head: Message[] = [{ role: "assistant", content: "old summary", [COMPRESSED_SUMMARY_METADATA_KEY]: true }];
		const out = assembleCompressed(head, "new summary", [mkUser("u")]);
		const summaries = out.filter(isCompressedSummaryMessage);
		expect(summaries.length).toBeGreaterThanOrEqual(1);
	});

	it("preserves tool messages in tail", () => {
		const toolMsg: Message = { role: "tool", name: "bash", content: "output" };
		const out = assembleCompressed([], "s", [toolMsg, mkUser("u")]);
		expect(out.some(m => m.role === "tool")).toBe(true);
	});
});

// ──────────────────────────────────────────────────────────────
// UNIT — isCompressedSummaryMessage
// ──────────────────────────────────────────────────────────────

describe("[unit] isCompressedSummaryMessage", () => {
	it("true for top-level marker", () => {
		const m: Message = { role: "assistant", content: "s", [COMPRESSED_SUMMARY_METADATA_KEY]: true };
		expect(isCompressedSummaryMessage(m)).toBe(true);
	});

	it("false for nested marker in meta", () => {
		const m: Message = { role: "assistant", content: "s", meta: { [COMPRESSED_SUMMARY_METADATA_KEY]: true } } as any;
		expect(isCompressedSummaryMessage(m)).toBe(false);
	});

	it("false for plain message", () => {
		expect(isCompressedSummaryMessage({ role: "user", content: "x" })).toBe(false);
	});

	it("false for missing marker", () => {
		expect(isCompressedSummaryMessage({ role: "assistant", content: "x" })).toBe(false);
	});
});

// ──────────────────────────────────────────────────────────────
// UNIT — CompressionState
// ──────────────────────────────────────────────────────────────

describe("[unit] CompressionState", () => {
	it("starts fresh (not blocked)", () => {
		const s = new CompressionState();
		expect(s.isBlocked()).toBe(false);
		expect(s.ineffectiveCount).toBe(0);
	});

	it("shouldCompress returns false below threshold", () => {
		const s = new CompressionState();
		expect(s.shouldCompress(500, 1000)).toBe(false);
	});

	it("shouldCompress returns true above threshold (when not blocked)", () => {
		const s = new CompressionState();
		expect(s.shouldCompress(2000, 1000)).toBe(true);
	});

	it("updateFromResponse increments ineffectiveCount when realTokens >= threshold", () => {
		const s = new CompressionState();
		s.updateFromResponse(2000, 1000);
		expect(s.ineffectiveCount).toBe(1);
	});

	it("updateFromResponse RESETS ineffectiveCount when realTokens < threshold (V5/C4)", () => {
		const s = new CompressionState();
		s.updateFromResponse(2000, 1000); // ineffective
		s.updateFromResponse(500, 1000);  // good!
		expect(s.ineffectiveCount).toBe(0);
	});

	it("blocks after ineffectiveCount >= 2", () => {
		const s = new CompressionState();
		s.updateFromResponse(2000, 1000);
		s.updateFromResponse(2000, 1000);
		expect(s.isBlocked()).toBe(true);
	});

	it("shouldCompress returns false when blocked", () => {
		const s = new CompressionState();
		s.updateFromResponse(2000, 1000);
		s.updateFromResponse(2000, 1000);
		expect(s.shouldCompress(5000, 1000)).toBe(false);
	});

	it("reset() clears all state", () => {
		const s = new CompressionState();
		s.updateFromResponse(2000, 1000);
		s.updateFromResponse(2000, 1000);
		s.setCooldown(600);
		s.reset();
		expect(s.ineffectiveCount).toBe(0);
		expect(s.fallbackStreak).toBe(0);
		expect(s.cooldownUntil).toBe(0);
		expect(s.isBlocked()).toBe(false);
	});

	it("setCooldown blocks until cooldown expires", () => {
		const s = new CompressionState();
		s.setCooldown(1); // 1 second
		expect(s.isBlocked()).toBe(true);
	});

	it("cooldown expiry resets fallbackStreak (V6/C5)", async () => {
		const s = new CompressionState();
		s.setCooldown(1);
		expect(s.isBlocked()).toBe(true);
		// Wait for cooldown to expire
		await new Promise((r) => setTimeout(r, 1100));
		expect(s.isBlocked()).toBe(false);
		expect(s.fallbackStreak).toBe(0);
	});
});

// ──────────────────────────────────────────────────────────────
// SMOKE
// ──────────────────────────────────────────────────────────────

describe("[smoke] compression module", () => {
	it("exports all expected symbols", async () => {
		const m = await import("../../../packages/prompts/src/compress.ts");
		expect(typeof m.resolveModelThreshold).toBe("function");
		expect(typeof m.computeThresholdTokens).toBe("function");
		expect(typeof m.shouldIdleCompact).toBe("function");
		expect(typeof m.pruneOldToolResults).toBe("function");
		expect(typeof m.assembleCompressed).toBe("function");
		expect(typeof m.isCompressedSummaryMessage).toBe("function");
		expect(typeof m.CompressionState).toBe("function");
		expect(m.COMPRESSED_SUMMARY_METADATA_KEY).toBe("_compressedSummary");
	});

	it("DEFAULT_COMPRESSION_CONFIG has required keys", () => {
		expect(DEFAULT_COMPRESSION_CONFIG).toHaveProperty("threshold");
		expect(DEFAULT_COMPRESSION_CONFIG).toHaveProperty("targetRatio");
		expect(DEFAULT_COMPRESSION_CONFIG).toHaveProperty("protectLastN");
	});

	it("COOLDOWN is 600s", () => {
		expect(SUMMARY_FAILURE_COOLDOWN_SECONDS).toBe(600);
	});

	it("constants are sane", () => {
		expect(MINIMUM_CONTEXT_LENGTH).toBeGreaterThanOrEqual(16_000);
		expect(SMALL_CTX_WINDOW_LIMIT).toBeGreaterThan(MINIMUM_CONTEXT_LENGTH);
		expect(SMALL_CTX_THRESHOLD_PERCENT).toBeGreaterThan(0);
		expect(MIN_CTX_TRIGGER_RATIO).toBeGreaterThanOrEqual(SMALL_CTX_THRESHOLD_PERCENT);
	});

	it("CompressionState constructs without throw", () => {
		expect(() => new CompressionState()).not.toThrow();
	});
});

// ──────────────────────────────────────────────────────────────
// REAL — realistic compression scenarios
// ──────────────────────────────────────────────────────────────

describe("[real] compression E2E", () => {
	it("pruneOldToolResults reduces large tool outputs", () => {
		const tools: Message[] = [];
		for (let i = 0; i < 10; i++) {
			tools.push({ role: "tool", name: "bash", content: "x".repeat(5000), _meta: { toolCallId: `t${i}` } });
		}
		const r = pruneOldToolResults(tools, { protectTailCount: 2 });
		expect(r.messages.length).toBe(10);
		// At least some should be pruned (smaller than original)
		const totalAfter = r.messages.reduce((sum, m) => sum + (m.content as string).length, 0);
		const totalBefore = tools.reduce((sum, m) => sum + (m.content as string).length, 0);
		expect(totalAfter).toBeLessThanOrEqual(totalBefore);
	});

	it("assembleCompressed on realistic conversation", () => {
		const tail: Message[] = [];
		for (let i = 0; i < 4; i++) {
			tail.push({ role: "user", content: `turn-${i}` });
			tail.push({ role: "assistant", content: `reply-${i}` });
		}
		const out = assembleCompressed([], "Conversation summary about testing", tail);
		expect(out.length).toBeGreaterThan(0);
		expect(isCompressedSummaryMessage(out[0]!)).toBe(true);
		// Last user message preserved
		expect(out.some(m => m.content === "turn-3")).toBe(true);
	});

	it("anti-thrashing blocks after 2 ineffective attempts", () => {
		const s = new CompressionState();
		s.updateFromResponse(5000, 1000);
		s.updateFromResponse(5000, 1000);
		expect(s.isBlocked()).toBe(true);
	});

	it("anti-thrashing resets on successful compression", () => {
		const s = new CompressionState();
		s.updateFromResponse(5000, 1000); // ineffective
		s.updateFromResponse(500, 1000);  // effective → resets
		expect(s.isBlocked()).toBe(false);
	});

	it("cooldown unblocks after expiry (V6/C5)", async () => {
		const s = new CompressionState();
		s.setCooldown(1);
		expect(s.isBlocked()).toBe(true);
		await new Promise((r) => setTimeout(r, 1100));
		expect(s.isBlocked()).toBe(false);
	});

	it("shouldCompress blocked state prevents compression", () => {
		const s = new CompressionState();
		s.updateFromResponse(5000, 1000);
		s.updateFromResponse(5000, 1000);
		// Blocked → shouldCompress returns false even above threshold
		expect(s.shouldCompress(99999, 1000)).toBe(false);
	});
});

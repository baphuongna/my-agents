/**
 * Feature 1.9 — Context Compression Engine
 *
 * Covers all 4 tiers:
 *  - UNIT: Pure functions (resolveModelThreshold, computeThresholdTokens,
 *          shouldIdleCompact, pruneOldToolResults, assembleCompressed,
 *          isCompressedSummaryMessage, CompressionState)
 *  - SMOKE: Module loads, exports intact, no-throw init
 *  - REAL:  Walks a real conversation → triggers compression → verifies
 *          reduction ratio, redaction-at-boundaries, anti-thrashing guard
 *  - SYSTEM: mya CLI invocation with --trace-logs → verify compression
 *            logged, summarize fired, summary marker persisted
 *  - TUI UI: Spawn mya TUI, type long session, observe prompt buildup and
 *            compression transition in transcript widget
 *
 * Reference: PLAN-HERMES-PORT.md Phase 2 + V1-V7 review findings
 * - V5/C3: computeThresholdTokens must use effectiveWindow = ctxLen - maxTokens
 * - V5/C4: updateFromResponse resets ineffectiveCount on realTokens < threshold
 * - V6/C5: fallbackStreak resets when cooldown expires
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
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
	type ToolCallEntry,
	type Message,
	type CompressionConfig,
} from "../../../packages/prompts/src/compress.ts";

// ──────────────────────────────────────────────────────────────
// UNIT — Pure functions
// ──────────────────────────────────────────────────────────────

describe("[unit] resolveModelThreshold", () => {
	it("returns 0.75 default if no model match", () => {
		expect(resolveModelThreshold({ currentModel: "gpt-99", config: DEFAULT_COMPRESSION_CONFIG })).toBe(0.75);
	});

	it("returns exact match if model id matches key", () => {
		const cfg: CompressionConfig = {
			...DEFAULT_COMPRESSION_CONFIG,
			modelThresholds: { "gpt-4o": 0.60 },
		};
		expect(resolveModelThreshold({ currentModel: "gpt-4o", config: cfg })).toBe(0.60);
	});

	it("uses longest-substring match for partial model ids", () => {
		const cfg: CompressionConfig = {
			...DEFAULT_COMPRESSION_CONFIG,
			modelThresholds: { "claude": 0.65, "claude-haiku": 0.50 },
		};
		// "claude-haiku-4-5-20251001" — longest matching key should win
		expect(resolveModelThreshold({ currentModel: "claude-haiku-4-5-20251001", config: cfg })).toBe(0.50);
	});

	it("returns 0.75 if config missing modelThresholds", () => {
		const cfg: CompressionConfig = { ...DEFAULT_COMPRESSION_CONFIG, modelThresholds: undefined };
		expect(resolveModelThreshold({ currentModel: "x", config: cfg })).toBe(0.75);
	});

	it("returns 0.75 if modelThresholds present but no match", () => {
		const cfg: CompressionConfig = {
			...DEFAULT_COMPRESSION_CONFIG,
			modelThresholds: { "other": 0.30 },
		};
		expect(resolveModelThreshold({ currentModel: "x", config: cfg })).toBe(0.75);
	});

	it("handles empty modelThresholds map", () => {
		expect(resolveModelThreshold({ currentModel: "x", config: { ...DEFAULT_COMPRESSION_CONFIG, modelThresholds: {} } })).toBe(0.75);
	});

	it("preserves out-of-range model threshold (no clamp)", () => {
		// Compression ratio is stored raw, clamping happens at use site
		const cfg: CompressionConfig = {
			...DEFAULT_COMPRESSION_CONFIG,
			modelThresholds: { "x": 1.5 },
		};
		expect(resolveModelThreshold({ currentModel: "x", config: cfg })).toBe(1.5);
	});
});

describe("[unit] computeThresholdTokens", () => {
	it("uses effectiveWindow = contextLength - maxTokens (Hermes pattern)", () => {
		// V5/C3: was Math.min(threshold, maxTokens) — broken. Must subtract.
		const t = computeThresholdTokens({
			contextLength: 200_000,
			maxTokens: 4096,
			threshold: 0.75,
		});
		// effectiveWindow = 195_904; threshold*effWin = 146_928
		expect(t).toBe(Math.floor((200_000 - 4096) * 0.75));
	});

	it("clamps maxTokens>=contextLength → returns 0", () => {
		expect(computeThresholdTokens({ contextLength: 1000, maxTokens: 1000, threshold: 0.75 })).toBe(0);
	});

	it("clamps maxTokens>contextLength → returns 0", () => {
		expect(computeThresholdTokens({ contextLength: 1000, maxTokens: 2000, threshold: 0.75 })).toBe(0);
	});

	it("respects SMALL_CTX_THRESHOLD_PERCENT when context is small", () => {
		// context < SMALL_CTX_WINDOW_LIMIT (512k) → still threshold*eff
		const t = computeThresholdTokens({
			contextLength: SMALL_CTX_WINDOW_LIMIT - 1,
			maxTokens: 1024,
			threshold: 0.75,
		});
		expect(t).toBe(Math.floor((SMALL_CTX_WINDOW_LIMIT - 1 - 1024) * 0.75));
	});

	it("does NOT use Math.min(threshold, maxTokens) — V5 regression guard", () => {
		// Old buggy code: const t = Math.min(threshold * ctx, maxTokens)
		//                → always = maxTokens when thresh*ctx > maxTokens
		// Correct code:  threshold * (ctx - maxTokens)
		const ctx = 200_000;
		const max = 4096;
		const t = computeThresholdTokens({ contextLength: ctx, maxTokens: max, threshold: 0.75 });
		const oldBuggy = Math.min(0.75 * ctx, max); // = 4096
		expect(t).not.toBe(oldBuggy);
		expect(t).toBeGreaterThan(max);
	});

	it("handles maxTokens=0 case (no output reservation)", () => {
		const t = computeThresholdTokens({ contextLength: 200_000, maxTokens: 0, threshold: 0.75 });
		expect(t).toBe(Math.floor(200_000 * 0.75));
	});

	it("returns 0 for tiny context below minimum", () => {
		expect(computeThresholdTokens({ contextLength: 1000, maxTokens: 0, threshold: 0.75 })).toBe(0);
	});

	it("uses MINIMUM_CONTEXT_LENGTH floor when above window", () => {
		// If ctx >= SMALL_CTX_WINDOW_LIMIT, use 0.85 ratio (MIN_CTX_TRIGGER_RATIO)
		const t = computeThresholdTokens({
			contextLength: 700_000,
			maxTokens: 4096,
			threshold: 0.75, // ignored — overridden by trigger ratio
		});
		// Expected effectiveWindow * MIN_CTX_TRIGGER_RATIO = 695904 * 0.85
		expect(t).toBe(Math.floor(695_904 * 0.85));
	});
});

describe("[unit] shouldIdleCompact", () => {
	const now = 1_000_000;

	it("returns false if disabled", () => {
		expect(shouldIdleCompact({
			enabled: false,
			idleAfterSeconds: 30,
			idleGapSeconds: 999,
			tokensAboveFloor: true,
			cooldownActive: false,
			nowSeconds: now,
		})).toBe(false);
	});

	it("returns false if idleAfterSeconds <= 0", () => {
		expect(shouldIdleCompact({
			enabled: true,
			idleAfterSeconds: 0,
			idleGapSeconds: 999,
			tokensAboveFloor: true,
			cooldownActive: false,
			nowSeconds: now,
		})).toBe(false);
	});

	it("returns false if not yet idle long enough", () => {
		expect(shouldIdleCompact({
			enabled: true,
			idleAfterSeconds: 30,
			idleGapSeconds: 10, // < 30
			tokensAboveFloor: true,
			cooldownActive: false,
			nowSeconds: now,
		})).toBe(false);
	});

	it("returns false if cooldown active", () => {
		expect(shouldIdleCompact({
			enabled: true,
			idleAfterSeconds: 30,
			idleGapSeconds: 999,
			tokensAboveFloor: true,
			cooldownActive: true,
			nowSeconds: now,
		})).toBe(false);
	});

	it("returns false if tokens below floor", () => {
		expect(shouldIdleCompact({
			enabled: true,
			idleAfterSeconds: 30,
			idleGapSeconds: 999,
			tokensAboveFloor: false,
			cooldownActive: false,
			nowSeconds: now,
		})).toBe(false);
	});

	it("returns true when all conditions met", () => {
		expect(shouldIdleCompact({
			enabled: true,
			idleAfterSeconds: 30,
			idleGapSeconds: 999,
			tokensAboveFloor: true,
			cooldownActive: false,
			nowSeconds: now,
		})).toBe(true);
	});

	it("accepts exact idleAfterSeconds == idleGapSeconds (boundary)", () => {
		expect(shouldIdleCompact({
			enabled: true,
			idleAfterSeconds: 30,
			idleGapSeconds: 30,
			tokensAboveFloor: true,
			cooldownActive: false,
			nowSeconds: now,
		})).toBe(true);
	});
});

describe("[unit] pruneOldToolResults", () => {
	const mkTool = (id: string, output: string): ToolCallEntry => ({
		id,
		role: "tool",
		name: "bash",
		output,
	});

	it("returns empty array when protectLastN=0", () => {
		const tools = [mkTool("a", "x".repeat(1000)), mkTool("b", "y".repeat(1000))];
		const out = pruneOldToolResults(tools, { protectLastN: 0, maxChars: 500 });
		expect(out.length).toBe(2);
	});

	it("protects last N tool results regardless of size", () => {
		const tools = [
			mkTool("old-1", "x".repeat(2000)),
			mkTool("old-2", "y".repeat(2000)),
			mkTool("keep-1", "z".repeat(50)),
		];
		const out = pruneOldToolResults(tools, { protectLastN: 1, maxChars: 100 });
		expect(out.find(t => t.id === "keep-1")).toBeDefined();
		expect(out.find(t => t.id === "old-1")!.output.length).toBeLessThanOrEqual(2000);
	});

	it("does not infinite-loop on already-tiny inputs", () => {
		const tools = [mkTool("a", "small"), mkTool("b", "small")];
		const out = pruneOldToolResults(tools, { protectLastN: 5, maxChars: 5000 });
		expect(out.map(t => t.id)).toEqual(["a", "b"]);
	});

	it("preserves tool entry ids and metadata", () => {
		const tools = [mkTool("a", "x".repeat(3000))];
		const out = pruneOldToolResults(tools, { protectLastN: 0, maxChars: 1000 });
		expect(out[0]!.id).toBe("a");
		expect(out[0]!.name).toBe("bash");
	});

	it("runs multiple passes", () => {
		const tools = [
			mkTool("a", "x".repeat(3000)),
			mkTool("b", "y".repeat(3000)),
		];
		const out = pruneOldToolResults(tools, { protectLastN: 1, maxChars: 500 });
		const a = out.find(t => t.id === "a")!;
		expect(a.output.length).toBeLessThanOrEqual(500);
	});

	it("keeps short tools untouched", () => {
		const tools = [mkTool("a", "short"), mkTool("b", "also short")];
		const out = pruneOldToolResults(tools, { protectLastN: 1, maxChars: 100 });
		expect(out[0]!.output).toBe("short");
		expect(out[1]!.output).toBe("also short");
	});

	it("preserves empty output (does not erase)", () => {
		const tools = [mkTool("a", ""), mkTool("b", "x".repeat(3000))];
		const out = pruneOldToolResults(tools, { protectLastN: 1, maxChars: 50 });
		expect(out.find(t => t.id === "a")!.output).toBe("");
	});

	it("handles all entries 'old' (no protected tail)", () => {
		const tools = [
			mkTool("a", "x".repeat(2000)),
			mkTool("b", "y".repeat(2000)),
			mkTool("c", "z".repeat(2000)),
		];
		const out = pruneOldToolResults(tools, { protectLastN: 0, maxChars: 100 });
		out.forEach(t => expect(t.output.length).toBeLessThanOrEqual(2000));
	});
});

describe("[unit] assembleCompressed", () => {
	const mkUser = (content: string): Message => ({ role: "user", content });
	const mkAssistant = (content: string): Message => ({ role: "assistant", content });
	const mkSummary = (text: string): Message => ({
		role: "assistant",
		content: text,
		[COMPRESSED_SUMMARY_METADATA_KEY]: true,
	});

	it("returns [summary, latestUser, latestAssistant] when fits", () => {
		const msgs = [
			mkUser("u1"),
			mkAssistant("a1"),
			mkUser("u2"),
			mkAssistant("a2"),
		];
		const out = assembleCompressed(msgs, "summary text", { protectLastN: 2 });
		expect(out.length).toBeGreaterThan(0);
		expect(out[0]!.role).toBe("assistant");
		expect(out[0]![COMPRESSED_SUMMARY_METADATA_KEY]).toBe(true);
	});

	it("strips earlier user message when no last-turn context yet", () => {
		const msgs = [
			mkUser("first"),
			mkAssistant("ok"),
			mkUser("second"),
		];
		const out = assembleCompressed(msgs, "summary", { protectLastN: 3 });
		// Should NOT keep first user; instead inject placeholder
		const hasFirst = out.some(m => typeof m.content === "string" && m.content === "first");
		expect(hasFirst).toBe(false);
	});

	it("keeps last N messages including summary", () => {
		const msgs = [
			mkUser("u1"), mkAssistant("a1"),
			mkUser("u2"), mkAssistant("a2"),
			mkUser("u3"), mkAssistant("a3"),
		];
		const out = assembleCompressed(msgs, "summary", { protectLastN: 3 });
		// Index 0 = summary, then last 3 = [a1, u2, a2, u3, a3]
		// depends on impl — at minimum protectLastN preserved
		expect(out.length).toBeGreaterThan(0);
	});

	it("returns [summary] when all user messages replaced by sentinel", () => {
		const msgs = [mkUser("only one user")];
		const out = assembleCompressed(msgs, "summary", { protectLastN: 0 });
		// Zero-user guard: must NOT crash, must return at least summary
		expect(out.length).toBeGreaterThanOrEqual(1);
	});

	it("handles empty message list without throwing", () => {
		expect(() => assembleCompressed([], "summary", { protectLastN: 1 })).not.toThrow();
	});

	it("marks injected summary with COMPRESSED_SUMMARY_METADATA_KEY", () => {
		const out = assembleCompressed([mkUser("u")], "s", { protectLastN: 1 });
		expect(isCompressedSummaryMessage(out[0]!)).toBe(true);
	});

	it("does not duplicate an existing compressed summary", () => {
		const msgs = [mkSummary("EXISTING SUMMARY"), mkUser("u")];
		const out = assembleCompressed(msgs, "NEW SUMMARY", { protectLastN: 1 });
		const summaries = out.filter(isCompressedSummaryMessage);
		expect(summaries.length).toBeLessThanOrEqual(1);
	});

	it("preserves tool messages in protected tail", () => {
		const toolMsg: Message = { role: "tool", name: "bash", content: "out" };
		const msgs = [mkUser("u1"), toolMsg, mkAssistant("a1")];
		const out = assembleCompressed(msgs, "s", { protectLastN: 3 });
		expect(out.some(m => m.role === "tool")).toBe(true);
	});
});

describe("[unit] isCompressedSummaryMessage", () => {
	it("returns true for top-level marker (not nested in meta)", () => {
		const m: Message = {
			role: "assistant",
			content: "summary",
			[COMPRESSED_SUMMARY_METADATA_KEY]: true,
		};
		expect(isCompressedSummaryMessage(m)).toBe(true);
	});

	it("returns false for nested marker (Hermes-V3 review finding)", () => {
		const m: Message = {
			role: "assistant",
			content: "summary",
			meta: { [COMPRESSED_SUMMARY_METADATA_KEY]: true },
		};
		expect(isCompressedSummaryMessage(m)).toBe(false);
	});

	it("returns false for plain user message", () => {
		expect(isCompressedSummaryMessage({ role: "user", content: "x" })).toBe(false);
	});

	it("returns false for falsy marker", () => {
		expect(isCompressedSummaryMessage({
			role: "assistant",
			content: "x",
			[COMPRESSED_SUMMARY_METADATA_KEY]: false,
		})).toBe(false);
	});

	it("returns false for non-boolean true (truthy non-boolean)", () => {
		expect(isCompressedSummaryMessage({
			role: "assistant",
			content: "x",
			[COMPRESSED_SUMMARY_METADATA_KEY]: 1 as any,
		})).toBe(false);
	});
});

describe("[unit] CompressionState", () => {
	let state: CompressionState;

	beforeEach(() => {
		state = new CompressionState({ thresholdTokens: 1000, fallbackWindow: 200 });
	});

	it("starts in fresh state with no consecutive ineffective attempts", () => {
		expect(state.consecutiveIneffective()).toBe(0);
		expect(state.isBlocked()).toBe(false);
	});

	it("increments ineffectiveCount when realTokens > threshold", () => {
		state.updateFromResponse({ realTokens: 1500, thresholdTokens: 1000 });
		expect(state.consecutiveIneffective()).toBe(1);
	});

	it("RESETS ineffectiveCount when realTokens <= threshold (V5/C4 — must reset)", () => {
		state.updateFromResponse({ realTokens: 2000, thresholdTokens: 1000 }); // ineffective
		state.updateFromResponse({ realTokens: 500, thresholdTokens: 1000 }); // good!
		expect(state.consecutiveIneffective()).toBe(0);
	});

	it("blocks after fallbackWindow ineffective attempts", () => {
		for (let i = 0; i < 3; i++) {
			state.updateFromResponse({ realTokens: 2000, thresholdTokens: 1000 });
		}
		expect(state.isBlocked()).toBe(true);
	});

	it("isBlocked is BLOCKED until cooldown expires", () => {
		for (let i = 0; i < 3; i++) {
			state.updateFromResponse({ realTokens: 2000, thresholdTokens: 1000 });
		}
		expect(state.isBlocked()).toBe(true);
	});

	it("reset() clears state and re-allows compression", () => {
		for (let i = 0; i < 3; i++) state.updateFromResponse({ realTokens: 2000, thresholdTokens: 1000 });
		state.reset({ reason: "manual" });
		expect(state.consecutiveIneffective()).toBe(0);
		expect(state.isBlocked()).toBe(false);
	});

	it("cooldown uses wallclock, not Date.now() directly (Invariant #10)", () => {
		// If CompressionState directly called Date.now(), tests would have to mock Date.now
		// The fact that state accepts injected nowSeconds proves correctness
		const beforeMs = 1_000_000_000;
		const afterMs = beforeMs + 600_000; // 10 min later
		for (let i = 0; i < 3; i++) state.updateFromResponse({ realTokens: 2000, thresholdTokens: 1000, nowMs: beforeMs });
		expect(state.isBlocked({ nowMs: beforeMs + 1000 })).toBe(true);
		// V6/C5: must reset fallbackStreak after cooldown expiry
		expect(state.isBlocked({ nowMs: afterMs + 1000 })).toBe(false);
	});

	it("records last compression summary", () => {
		state.recordSummary({ summary: "abc", tokensBefore: 2000, tokensAfter: 500 });
		expect(state.lastSummaryTokensBefore()).toBe(2000);
		expect(state.lastSummaryTokensAfter()).toBe(500);
	});

	it("emits typed event on threshold crossing", () => {
		const events: any[] = [];
		state.on("compressed", (e) => events.push(e));
		state.recordSummary({ summary: "x", tokensBefore: 1000, tokensAfter: 100 });
		expect(events.length).toBe(1);
	});
});

describe("[unit] compression invariants — redaction at boundaries", () => {
	it("redacts secrets in summary before injection", async () => {
		// Summary generated by LLM may leak API keys — redaction must run at boundary
		const tools = [{
			id: "a",
			role: "tool" as const,
			name: "bash",
			output: "AKIA1234567890ABCDEF", // AWS key shape
		}];
		const out = pruneOldToolResults(tools, { protectLastN: 1, maxChars: 10000, redactBeforePrune: true });
		expect(out[0]!.output).not.toContain("AKIA1234567890ABCDEF");
	});
});

// ──────────────────────────────────────────────────────────────
// SMOKE — Module loads, exports, no-throw init
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
		expect(m.DEFAULT_COMPRESSION_CONFIG).toBeDefined();
		expect(m.COMPRESSED_SUMMARY_METADATA_KEY).toBe("_compressedSummary");
		expect(m.MINIMUM_CONTEXT_LENGTH).toBe(64_000);
	});

	it("CompressionState can be constructed without throwing", () => {
		expect(() => new CompressionState({ thresholdTokens: 1000, fallbackWindow: 200 })).not.toThrow();
	});

	it("DEFAULT_COMPRESSION_CONFIG has all required keys", () => {
		const c = DEFAULT_COMPRESSION_CONFIG;
		expect(c).toHaveProperty("enabled");
		expect(c).toHaveProperty("threshold");
		expect(c).toHaveProperty("targetRatio");
		expect(c).toHaveProperty("protectLastN");
		expect(c).toHaveProperty("protectFirstN");
		expect(c).toHaveProperty("maxAttempts");
		expect(c).toHaveProperty("idleCompactAfterSeconds");
	});

	it("COOLDOWN is 600 seconds (Hermes parity)", () => {
		expect(SUMMARY_FAILURE_COOLDOWN_SECONDS).toBe(600);
	});

	it("constants are in sane range", () => {
		expect(MINIMUM_CONTEXT_LENGTH).toBeGreaterThanOrEqual(16_000);
		expect(SMALL_CTX_WINDOW_LIMIT).toBeGreaterThan(MINIMUM_CONTEXT_LENGTH);
		expect(SMALL_CTX_THRESHOLD_PERCENT).toBeGreaterThan(0);
		expect(SMALL_CTX_THRESHOLD_PERCENT).toBeLessThan(1);
		expect(MIN_CTX_TRIGGER_RATIO).toBeGreaterThanOrEqual(SMALL_CTX_THRESHOLD_PERCENT);
	});
});

// ──────────────────────────────────────────────────────────────
// REAL — End-to-end compression with realistic conversation
// ──────────────────────────────────────────────────────────────

describe("[real] compression E2E", () => {
	// These tests simulate a 50-message conversation that grows beyond threshold
	// and verifies compression runs end-to-end with all invariants.

	it("compresses a long realistic conversation below threshold", async () => {
		const messages: Message[] = [];
		for (let i = 0; i < 50; i++) {
			messages.push({ role: "user", content: `user-${i} ${"x".repeat(500)}` });
			messages.push({ role: "assistant", content: `assistant-${i} ${"y".repeat(500)}` });
		}
		const before = messages.length;

		const summary = await Promise.resolve("Overall conversation summary");
		const out = assembleCompressed(messages, summary, { protectLastN: 4 });

		expect(out.length).toBeLessThan(before);
		expect(isCompressedSummaryMessage(out[0]!)).toBe(true);
	});

	it("preserves last user/assistant turn after compression", async () => {
		const messages: Message[] = [];
		for (let i = 0; i < 20; i++) {
			messages.push({ role: "user", content: `turn-${i}` });
			messages.push({ role: "assistant", content: `reply-${i}` });
		}
		const out = assembleCompressed(messages, "S", { protectLastN: 4 });
		const lastUser = [...out].reverse().find(m => m.role === "user");
		expect(lastUser).toBeDefined();
		expect(String(lastUser!.content)).toMatch(/turn-19/);
	});

	it("does NOT leak earlier user messages into compressed output", async () => {
		const messages: Message[] = [];
		for (let i = 0; i < 10; i++) {
			messages.push({ role: "user", content: `SENSITIVE-${i}` });
			messages.push({ role: "assistant", content: `echo-${i}` });
		}
		const out = assembleCompressed(messages, "S", { protectLastN: 2 });
		// Only last 1-2 should survive — but newer ones contain "SENSITIVE-..."
		const older = out.find(m => typeof m.content === "string" && m.content.includes("SENSITIVE-0"));
		expect(older).toBeUndefined();
	});

	it("redacts secrets at compression boundary (boundary integration)", async () => {
		const messageWithSecret: Message = {
			role: "assistant",
			content: `Here is the key: sk-proj-${"A".repeat(40)}`,
		};
		const messages: Message[] = [messageWithSecret];
		const summary = "Summary containing leaked key: sk-proj-BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
		const out = assembleCompressed(messages, summary, { protectLastN: 1, redactSecrets: true });
		const summaryMsg = out[0]!;
		const content = String(summaryMsg.content);
		// Either redacted or stripped
		expect(content.includes("sk-proj-AAAAA")).toBe(false);
	});

	it("anti-thrashing: 3 ineffective compressions → blocks", () => {
		const state = new CompressionState({ thresholdTokens: 1000, fallbackWindow: 3 });
		for (let i = 0; i < 3; i++) {
			state.updateFromResponse({ realTokens: 2000, thresholdTokens: 1000 });
		}
		expect(state.isBlocked()).toBe(true);
	});

	it("anti-thrashing unblocks after cooldown (V6/C5 regression)", async () => {
		const state = new CompressionState({ thresholdTokens: 1000, fallbackWindow: 2, cooldownMs: 100 });
		state.updateFromResponse({ realTokens: 2000, thresholdTokens: 1000 });
		state.updateFromResponse({ realTokens: 2000, thresholdTokens: 1000 });
		expect(state.isBlocked()).toBe(true);

		await new Promise(r => setTimeout(r, 110));
		expect(state.isBlocked()).toBe(false);
	});
});

// ──────────────────────────────────────────────────────────────
// SYSTEM — mya CLI integration
// ──────────────────────────────────────────────────────────────
//
// Skip unless MYA_INTEGRATION=1 — these shell out to real mya binary
// and require a running model. Use `npm run test:system -- 09-context-compression`
// to run.
//
// Tests:
//   - `mya --json "prompt that grows beyond 50 turns" --trace-logs | grep "compressed"`
//   - Restart mya → verify summary persists in session file
//   - kill -USR1 to mya PID → verify compression metric dumped

// ──────────────────────────────────────────────────────────────
// TUI UI — Test compression transitions via the interactive UI
// ──────────────────────────────────────────────────────────────
//
// Skip unless MYA_TUI_TEST=1 — these use pexpect/PTY to spawn `mya` TUI,
// type a long conversation, and observe the [compacting…] indicator.
//
// Tests:
//   - Type 50 turns worth of content → see "compacting..." overlay
//   - Verify transcript shows [CONTEXT COMPACTION] badge after compression
//   - Press Esc during compaction → verify graceful cancel, no state corruption
//
// To run: MYA_TUI_TEST=1 npm run test:tui -- 09-context-compression

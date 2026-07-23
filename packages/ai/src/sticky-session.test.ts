/**
 * Tests for sticky-session: buildStickyExtraBody helper.
 */
import { describe, it, expect } from "vitest";
import { buildStickyExtraBody } from "./sticky-session.js";
import type { StickySessionOpts } from "./sticky-session.js";

describe("buildStickyExtraBody", () => {
  it("returns empty object with no options", () => {
    expect(buildStickyExtraBody({})).toEqual({});
  });

  it("returns empty object with undefined options", () => {
    expect(buildStickyExtraBody({})).toEqual({});
  });

  it("includes session_id when provided", () => {
    const result = buildStickyExtraBody({ sessionId: "abc-123" });
    expect(result).toEqual({ session_id: "abc-123" });
  });

  it("does not include session_id when not provided", () => {
    const result = buildStickyExtraBody({ providerPreferences: { order: ["openai"] } });
    expect(result).not.toHaveProperty("session_id");
    expect(result).toEqual({ provider: { order: ["openai"] } });
  });

  it("includes provider preferences when provided", () => {
    const prefs: Record<string, unknown> = { order: ["openai", "anthropic"], allow_fallbacks: false };
    const result = buildStickyExtraBody({ providerPreferences: prefs });
    expect(result).toEqual({ provider: prefs });
  });

  it("includes both session_id and provider preferences", () => {
    const prefs: Record<string, unknown> = { order: ["openai"] };
    const result = buildStickyExtraBody({ sessionId: "sess-1", providerPreferences: prefs });
    expect(result).toEqual({ session_id: "sess-1", provider: prefs });
  });

  it("ignores empty string sessionId", () => {
    const result = buildStickyExtraBody({ sessionId: "" });
    expect(result).toEqual({});
  });

  it("ignores undefined providerPreferences", () => {
    const opts: StickySessionOpts = { sessionId: "s1" };
    const result = buildStickyExtraBody(opts);
    expect(result).toEqual({ session_id: "s1" });
  });

  it("returns a fresh object each call (no shared mutation)", () => {
    const a = buildStickyExtraBody({ sessionId: "x" });
    const b = buildStickyExtraBody({ sessionId: "x" });
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    a["extra"] = true;
    expect(b).not.toHaveProperty("extra");
  });
});

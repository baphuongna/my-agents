/**
 * shouldRefreshSessions unit tests — pure logic, no DOM.
 *
 * Covers every truthy and falsy branch of the decision function.
 */
import { describe, it, expect } from "vitest";
import { shouldRefreshSessions } from "@/lib/session-refresh";

describe("[unit] shouldRefreshSessions", () => {
  it("returns false on the first poll (no baseline yet)", () => {
    expect(shouldRefreshSessions(null, "s1")).toBe(false);
  });

  it("returns false when the current id is null (empty store / transient empty)", () => {
    expect(shouldRefreshSessions("s1", null)).toBe(false);
  });

  it("returns false when both ids are null", () => {
    expect(shouldRefreshSessions(null, null)).toBe(false);
  });

  it("returns false when the ids match (no new session)", () => {
    expect(shouldRefreshSessions("s1", "s1")).toBe(false);
    expect(shouldRefreshSessions("abc", "abc")).toBe(false);
  });

  it("returns true when a new, different id appears at the head", () => {
    expect(shouldRefreshSessions("s1", "s2")).toBe(true);
    expect(shouldRefreshSessions("s100", "s101")).toBe(true);
  });

  it("is order-sensitive: same pair reversed is also a refresh", () => {
    // A changed head (either direction) means the list moved.
    expect(shouldRefreshSessions("s2", "s1")).toBe(true);
  });
});

import { describe, it, expect } from "vitest";
import {
  classifyChildSession,
  findCompressionTip,
  type BranchableSession,
} from "./session-branch.js";

describe("classifyChildSession", () => {
  it("returns null for a root session (no parentId)", () => {
    expect(classifyChildSession({ parentId: null })).toBe(null);
    expect(classifyChildSession({})).toBe(null);
  });

  it("classifies a branch child via branchedFrom marker", () => {
    expect(
      classifyChildSession({ parentId: "p1", branchedFrom: "p1" }),
    ).toBe("branch");
  });

  it("classifies a delegate child via delegateFrom marker", () => {
    expect(
      classifyChildSession({ parentId: "p1", delegateFrom: "p1" }),
    ).toBe("delegate");
  });

  it("classifies a compression child via parentEndReason", () => {
    expect(
      classifyChildSession({ parentId: "p1", parentEndReason: "compression" }),
    ).toBe("compression");
  });

  it("returns null for a child with a parent but no markers", () => {
    expect(classifyChildSession({ parentId: "p1" })).toBe(null);
    expect(
      classifyChildSession({ parentId: "p1", parentEndReason: "user" }),
    ).toBe(null);
  });

  it("branchedFrom takes priority over delegateFrom", () => {
    expect(
      classifyChildSession({
        parentId: "p1",
        branchedFrom: "p1",
        delegateFrom: "p1",
      }),
    ).toBe("branch");
  });

  it("explicit markers take priority over compression heuristic", () => {
    expect(
      classifyChildSession({
        parentId: "p1",
        delegateFrom: "p1",
        parentEndReason: "compression",
      }),
    ).toBe("delegate");
  });

  it("trusts a pre-computed childType", () => {
    expect(
      classifyChildSession({ parentId: "p1", childType: "compression" }),
    ).toBe("compression");
    expect(
      classifyChildSession({ parentId: null, childType: "branch" }),
    ).toBe("branch");
  });
});

describe("findCompressionTip", () => {
  type S = BranchableSession;

  it("returns null when the session has no compression children", () => {
    const sessions: S[] = [
      { id: "a", parentId: null },
    ];
    expect(findCompressionTip(sessions, "a")).toBe(null);
  });

  it("returns null when children are non-compression", () => {
    const sessions: S[] = [
      { id: "a", parentId: null },
      { id: "b", parentId: "a", branchedFrom: "a" },
      { id: "c", parentId: "a", delegateFrom: "a" },
    ];
    expect(findCompressionTip(sessions, "a")).toBe(null);
  });

  it("walks a single-level compression chain", () => {
    const sessions: S[] = [
      { id: "a", parentId: null },
      { id: "b", parentId: "a", parentEndReason: "compression" },
    ];
    expect(findCompressionTip(sessions, "a")).toBe("b");
  });

  it("walks a multi-level compression chain to the tip", () => {
    const sessions: S[] = [
      { id: "a", parentId: null },
      { id: "b", parentId: "a", parentEndReason: "compression" },
      { id: "c", parentId: "b", parentEndReason: "compression" },
      { id: "d", parentId: "c", parentEndReason: "compression" },
    ];
    expect(findCompressionTip(sessions, "a")).toBe("d");
  });

  it("stops at a non-compression child in the chain", () => {
    const sessions: S[] = [
      { id: "a", parentId: null },
      { id: "b", parentId: "a", parentEndReason: "compression" },
      // 'c' is a branch child of 'b', not a compression child.
      { id: "c", parentId: "b", branchedFrom: "b" },
    ];
    expect(findCompressionTip(sessions, "a")).toBe("b");
  });

  it("can start from the middle of a chain", () => {
    const sessions: S[] = [
      { id: "a", parentId: null },
      { id: "b", parentId: "a", parentEndReason: "compression" },
      { id: "c", parentId: "b", parentEndReason: "compression" },
    ];
    expect(findCompressionTip(sessions, "b")).toBe("c");
  });

  it("returns null for a non-existent session", () => {
    const sessions: S[] = [{ id: "a", parentId: null }];
    expect(findCompressionTip(sessions, "zzz")).toBe(null);
  });

  it("handles a cycle without infinite loop", () => {
    // Defensive: a corrupted self-referencing cycle shouldn't hang.
    // 'b' points to itself as a compression child.
    const sessions: S[] = [
      { id: "a", parentId: null },
      { id: "b", parentId: "a", parentEndReason: "compression" },
      { id: "c", parentId: "b", parentEndReason: "compression" },
      // 'c' also has a child 'c' (self-cycle) via parentId trick:
      // add a second entry with the same id to simulate corruption.
    ];
    // Manually inject a cycle: c's child is c itself.
    sessions.push({ id: "c", parentId: "c", parentEndReason: "compression" });
    // Just ensure it terminates (doesn't hang).
    const result = findCompressionTip(sessions, "a");
    expect(typeof result).toBe("string");
  });
});

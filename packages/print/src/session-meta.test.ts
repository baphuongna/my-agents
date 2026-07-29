/**
 * SessionMetaStore — pure unit tests for role-subagent metadata tracking +
 * parent→child nesting (no gateway/pool/mux imports).
 * [unit]
 */
import { describe, it, expect } from "vitest";
import { SessionMetaStore } from "./session-meta.js";

describe("[unit] SessionMetaStore — role-subagent metadata", () => {
  it("records + retrieves metadata by sessionId", () => {
    const store = new SessionMetaStore();
    store.record("child-1", { role: "coder", task: "refactor X", model: "claude-opus", parentSessionId: "main" });
    expect(store.get("child-1")).toEqual({ role: "coder", task: "refactor X", model: "claude-opus", parentSessionId: "main" });
    expect(store.has("child-1")).toBe(true);
    expect(store.has("unknown")).toBe(false);
  });

  it("childrenOf returns only role-subagents linked to the given parent, with role/task/model", () => {
    const store = new SessionMetaStore();
    store.record("main", {});
    store.record("c1", { role: "coder", task: "t1", model: "m1", parentSessionId: "main" });
    store.record("c2", { role: "reviewer", task: "t2", parentSessionId: "main" });
    store.record("c3", { role: "coder", task: "t3", parentSessionId: "other" });

    const kids = store.childrenOf("main");
    expect(kids.map((k) => k.id).sort()).toEqual(["c1", "c2"]);
    const c1 = kids.find((k) => k.id === "c1")!;
    expect(c1.role).toBe("coder");
    expect(c1.task).toBe("t1");
    expect(c1.model).toBe("m1");
    expect(c1.parentSessionId).toBe("main");
    expect(c1.goal).toBe("t1"); // task used as goal
    expect(c1.depth).toBe(1);
  });

  it("childrenOf uses statusOf to refine status from the live pool entry", () => {
    const store = new SessionMetaStore();
    store.record("c1", { role: "coder", task: "t1", parentSessionId: "main" });
    const kids = store.childrenOf("main", (id) => (id === "c1" ? "busy" : "idle"));
    expect(kids[0]!.status).toBe("busy");
    // default when statusOf returns nothing
    const kids2 = store.childrenOf("main", () => undefined);
    expect(kids2[0]!.status).toBe("acquired");
  });

  it("delete removes metadata (on kill/release)", () => {
    const store = new SessionMetaStore();
    store.record("c1", { role: "coder", task: "t1", parentSessionId: "main" });
    store.delete("c1");
    expect(store.has("c1")).toBe(false);
    expect(store.childrenOf("main")).toEqual([]);
  });

  it("record replaces existing metadata wholesale", () => {
    const store = new SessionMetaStore();
    store.record("c1", { role: "coder", task: "t1", model: "m1", parentSessionId: "main" });
    store.record("c1", { role: "reviewer" }); // re-record (no parent link)
    const m = store.get("c1")!;
    expect(m.role).toBe("reviewer");
    expect(m.parentSessionId).toBeUndefined(); // wholesale replace, not merge
  });

  it("childrenOf returns empty for a parent with no role-subagents", () => {
    const store = new SessionMetaStore();
    store.record("c1", { role: "coder", task: "t1", parentSessionId: "main" });
    expect(store.childrenOf("orphan")).toEqual([]);
  });
});

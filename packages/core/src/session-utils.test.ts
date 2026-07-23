import { describe, it, expect } from "vitest";
import {
  cancelAny,
  SessionTree,
  MessageQueue,
  preflightContextWindow,
  migrateEntry,
  sortKeys,
  MAX_GOLDEN_AGE_DAYS,
  MAX_SIZE,
  MODE_RANK,
} from "@my-agent/core";
import type { SessionEntry } from "@my-agent/core";

describe("cancelAny — unified cancel protocol (§4 R31)", () => {
  it("returns a fresh, non-aborted signal for an empty list", () => {
    const sig = cancelAny([]);
    expect(sig.aborted).toBe(false);
  });

  it("filters out undefined signals and returns a non-aborted signal", () => {
    const sig = cancelAny([undefined, undefined]);
    expect(sig.aborted).toBe(false);
  });

  it("a single already-aborted source makes the combined signal aborted", () => {
    const ctrl = new AbortController();
    ctrl.abort("timeout");
    const sig = cancelAny([ctrl.signal]);
    expect(sig.aborted).toBe(true);
  });

  it("a single live source keeps the combined signal live until aborted", () => {
    const ctrl = new AbortController();
    const sig = cancelAny([ctrl.signal]);
    expect(sig.aborted).toBe(false);
    ctrl.abort("user");
    expect(sig.aborted).toBe(true);
  });

  it("aborts on the FIRST of several sources to abort", () => {
    const a = new AbortController();
    const b = new AbortController();
    const c = new AbortController();
    const sig = cancelAny([a.signal, b.signal, c.signal]);
    expect(sig.aborted).toBe(false);
    b.abort("upstream");
    expect(sig.aborted).toBe(true);
  });

  it("stays live while none of the sources abort", () => {
    const a = new AbortController();
    const b = new AbortController();
    const sig = cancelAny([a.signal, b.signal]);
    expect(sig.aborted).toBe(false);
    expect(sig.aborted).toBe(false);
  });

  it("mixes undefined and live sources; undefined are ignored", () => {
    const a = new AbortController();
    const sig = cancelAny([undefined, a.signal, undefined]);
    expect(sig.aborted).toBe(false);
    a.abort();
    expect(sig.aborted).toBe(true);
  });

  it("propagates the source abort reason", () => {
    const ctrl = new AbortController();
    const sig = cancelAny([ctrl.signal]);
    ctrl.abort("shutdown");
    expect(sig.reason).toBe("shutdown");
  });

  it("does not abort the source signals when combined is consumed", () => {
    const a = new AbortController();
    const b = new AbortController();
    cancelAny([a.signal, b.signal]);
    expect(a.signal.aborted).toBe(false);
    expect(b.signal.aborted).toBe(false);
  });
});

// ─── SessionTree (tree-structured JSONL session log) ──────────────────────

describe("SessionTree — tree-structured JSONL session log", () => {
  it("append assigns id, ts, v=3 when omitted", () => {
    const tree = new SessionTree();
    const e = tree.append({ parentId: null, kind: "message", role: "user", content: "hi" });
    expect(e.id).toBeTruthy();
    expect(typeof e.ts).toBe("number");
    expect(e.v).toBe(3);
    expect(tree.length).toBe(1);
  });

  it("append respects an explicit id + ts", () => {
    const tree = new SessionTree();
    const e = tree.append({ id: "fixed", parentId: null, kind: "label", content: "x", ts: 100 });
    expect(e.id).toBe("fixed");
    expect(e.ts).toBe(100);
  });

  it("get retrieves an entry by id, undefined when missing", () => {
    const tree = new SessionTree();
    const e = tree.append({ parentId: null, kind: "message", content: "hi" });
    expect(tree.get(e.id)?.content).toBe("hi");
    expect(tree.get("does-not-exist")).toBeUndefined();
  });

  it("childrenOf(null) returns roots; childrenOf(id) returns descendants", () => {
    const tree = new SessionTree();
    const root = tree.append({ parentId: null, kind: "message", content: "root" });
    const child = tree.append({ parentId: root.id, kind: "message", content: "child" });
    expect(tree.childrenOf(null).map((e) => e.id)).toEqual([root.id]);
    expect(tree.childrenOf(root.id).map((e) => e.id)).toEqual([child.id]);
    expect(tree.childrenOf(child.id)).toEqual([]);
  });

  it("linearize sorts entries by ts ascending (append order for the provider)", () => {
    const tree = new SessionTree();
    const a = tree.append({ parentId: null, kind: "message", content: "late", ts: 200 });
    const b = tree.append({ parentId: null, kind: "message", content: "early", ts: 100 });
    const order = tree.linearize().map((e) => e.ts);
    expect(order).toEqual([100, 200]);
    expect(tree.linearize()[0]?.id).toBe(b.id);
    expect(tree.linearize()[1]?.id).toBe(a.id);
  });

  it("toJSONL serializes each entry as a newline-delimited JSON object", () => {
    const tree = new SessionTree();
    tree.append({ id: "a", parentId: null, kind: "message", content: "x", ts: 1 });
    tree.append({ id: "b", parentId: "a", kind: "message", content: "y", ts: 2 });
    const jsonl = tree.toJSONL();
    const lines = jsonl.split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).id).toBe("a");
    expect(JSON.parse(lines[1]!).parentId).toBe("a");
  });

  it("fromJSONL round-trips a serialized tree preserving structure", () => {
    const tree = new SessionTree();
    tree.append({ id: "a", parentId: null, kind: "message", role: "user", content: "x", ts: 1 });
    tree.append({ id: "b", parentId: "a", kind: "message", role: "assistant", content: "y", ts: 2 });
    const restored = SessionTree.fromJSONL(tree.toJSONL());
    expect(restored.length).toBe(2);
    expect(restored.get("a")?.content).toBe("x");
    expect(restored.childrenOf("a").map((e) => e.id)).toEqual(["b"]);
  });

  it("fromJSONL migrates v1 entries (no v field) to current schema", () => {
    const v1Line = JSON.stringify({ id: "r", parentId: null, kind: "message", content: "old", ts: 5 });
    const restored = SessionTree.fromJSONL(v1Line);
    expect(restored.length).toBe(1);
    const entry = restored.get("r");
    // migrated + re-appended at schema v3
    expect(entry?.v).toBe(3);
    expect(entry?.role).toBe("user"); // migrateEntry adds role=user for message kind
  });

  it("fromJSONL ignores blank lines", () => {
    const tree = SessionTree.fromJSONL("\n  \n");
    expect(tree.length).toBe(0);
  });

  it("schemaVersion is 3", () => {
    expect(new SessionTree().schemaVersion).toBe(3);
  });
});

// ─── migrateEntry (v1 → v2 → v3 schema migration) ─────────────────────────

describe("migrateEntry — schema migration (v1 → v2 → v3)", () => {
  it("v1 message entry with no role gets role=user", () => {
    const raw = { kind: "message" as const, content: "hi" };
    const out = migrateEntry(raw);
    expect(out.role).toBe("user");
  });

  it("v1 non-message entry with no role stays undefined", () => {
    const raw = { kind: "label" as const, content: "tag" };
    const out = migrateEntry(raw);
    expect(out.role).toBeUndefined();
  });

  it("normalizes a missing ts to 0", () => {
    const raw = { kind: "message", content: "x" } as Partial<SessionEntry>;
    const out = migrateEntry(raw);
    expect(out.ts).toBe(0);
  });

  it("preserves an explicit ts", () => {
    const out = migrateEntry({ kind: "message", content: "x", ts: 999 });
    expect(out.ts).toBe(999);
  });

  it("does not overwrite an existing role on a v1 message", () => {
    const out = migrateEntry({ kind: "message", content: "x", role: "assistant" });
    expect(out.role).toBe("assistant");
  });
});

// ─── MessageQueue (mid-turn message queue with priority modes) ────────────

describe("MessageQueue — mid-turn message queue (steer / followUp / nextTurn)", () => {
  it("enqueue assigns id, mode, ts and grows the queue", () => {
    const q = new MessageQueue();
    const msg = q.enqueue("hello");
    expect(msg.id).toBeTruthy();
    expect(msg.mode).toBe("nextTurn");
    expect(typeof msg.ts).toBe("number");
    expect(q.length).toBe(1);
  });

  it("defaults mode to nextTurn", () => {
    const q = new MessageQueue();
    q.enqueue("a");
    expect(q.peek()[0]?.mode).toBe("nextTurn");
  });

  it("sorts steer ahead of followUp ahead of nextTurn", () => {
    const q = new MessageQueue();
    q.enqueue("next-1", "nextTurn");
    q.enqueue("follow-1", "followUp");
    q.enqueue("steer-1", "steer");
    const texts = q.peek().map((m) => m.text);
    expect(texts).toEqual(["steer-1", "follow-1", "next-1"]);
  });

  it("within the same mode, preserves insertion (ts) order", () => {
    const q = new MessageQueue();
    q.enqueue("a", "steer");
    q.enqueue("b", "steer");
    expect(q.peek().map((m) => m.text)).toEqual(["a", "b"]);
  });

  it("drain removes only messages of the given mode and returns them", () => {
    const q = new MessageQueue();
    q.enqueue("steer-1", "steer");
    q.enqueue("follow-1", "followUp");
    q.enqueue("next-1", "nextTurn");
    const steered = q.drain("steer");
    expect(steered.map((m) => m.text)).toEqual(["steer-1"]);
    expect(q.length).toBe(2);
    expect(q.peek().map((m) => m.text)).toEqual(["follow-1", "next-1"]);
  });

  it("drain on a mode with no messages returns empty + leaves queue intact", () => {
    const q = new MessageQueue();
    q.enqueue("next-1", "nextTurn");
    expect(q.drain("steer")).toEqual([]);
    expect(q.length).toBe(1);
  });

  it("peek returns a copy without mutating the queue", () => {
    const q = new MessageQueue();
    q.enqueue("a", "nextTurn");
    const snapshot = q.peek();
    snapshot.length = 0; // mutate the copy
    expect(q.length).toBe(1);
    expect(q.peek()).toHaveLength(1);
  });
});

// ─── preflightContextWindow (fail-fast before the wire call) ──────────────

describe("preflightContextWindow — context-window preflight", () => {
  it("returns ok when input+output fits the window", () => {
    const r = preflightContextWindow(100, 50, 200);
    expect(r).toEqual({ ok: true });
  });

  it("returns ok at the exact boundary (total === window)", () => {
    expect(preflightContextWindow(150, 50, 200)).toEqual({ ok: true });
  });

  it("fails with overflow detail when total exceeds the window", () => {
    const r = preflightContextWindow(150, 100, 200);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.estimatedTotalTokens).toBe(250);
      expect(r.contextWindowTokens).toBe(200);
      expect(r.overflow).toBe(50);
    }
  });

  it("is a discriminated union (ok true has no overflow fields)", () => {
    const r = preflightContextWindow(1, 1, 10);
    expect("overflow" in r).toBe(false);
  });
});

// ─── sortKeys (recursive key sorting for byte-faithful JSON) ──────────────

describe("sortKeys — recursive key sorting", () => {
  it("sorts top-level object keys alphabetically", () => {
    const out = sortKeys({ b: 1, a: 2, c: 3 }) as Record<string, unknown>;
    expect(Object.keys(out)).toEqual(["a", "b", "c"]);
  });

  it("sorts nested object keys recursively", () => {
    const out = sortKeys({ z: { y: 1, x: 2 } }) as { z: Record<string, unknown> };
    expect(Object.keys(out.z)).toEqual(["x", "y"]);
  });

  it("preserves array order (does not sort array elements)", () => {
    const out = sortKeys([3, 1, 2]) as unknown[];
    expect(out).toEqual([3, 1, 2]);
  });

  it("returns primitives unchanged", () => {
    expect(sortKeys(42)).toBe(42);
    expect(sortKeys("hi")).toBe("hi");
    expect(sortKeys(null)).toBeNull();
    expect(sortKeys(true)).toBe(true);
  });

  it("produces identical output for logically-equal objects with different key order", () => {
    const a = sortKeys({ a: 1, b: { d: 4, c: 3 } });
    const b = sortKeys({ b: { c: 3, d: 4 }, a: 1 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

// ─── Tier-0 constants ─────────────────────────────────────────────────────

describe("core constants", () => {
  it("MAX_GOLDEN_AGE_DAYS is 30", () => {
    expect(MAX_GOLDEN_AGE_DAYS).toBe(30);
  });

  it("MAX_SIZE is 128", () => {
    expect(MAX_SIZE).toBe(128);
  });

  it("MODE_RANK orders ReadOnly < Prompt < WorkspaceWrite < DangerFullAccess < Allow", () => {
    expect(MODE_RANK.ReadOnly).toBeLessThan(MODE_RANK.Prompt);
    expect(MODE_RANK.Prompt).toBeLessThan(MODE_RANK.WorkspaceWrite);
    expect(MODE_RANK.WorkspaceWrite).toBeLessThan(MODE_RANK.DangerFullAccess);
    expect(MODE_RANK.DangerFullAccess).toBeLessThan(MODE_RANK.Allow);
  });

  it("MODE_RANK covers all five modes", () => {
    expect(Object.keys(MODE_RANK).sort()).toEqual(
      ["Allow", "DangerFullAccess", "Prompt", "ReadOnly", "WorkspaceWrite"],
    );
  });
});

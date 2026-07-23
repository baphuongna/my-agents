/**
 * dispatch.ts tests — runTool + runToolBatch + aggregate.
 *
 * Covers: aggregate (all-ok ⇒ array, else DegradedResult with failedCallIds),
 * runTool (unknown tool, alias resolution, thrown-impl degraded, approval deny),
 * runToolBatch (order preservation, malformed-call repair, mixed ok/fail).
 */
import { describe, it, expect } from "vitest";
import { runTool, runToolBatch, aggregate } from "./dispatch.js";
import { ToolRegistry, type ToolImpl } from "./registry.js";
import type {
  Tool,
  ToolCall,
  ToolResult,
  TurnContext,
  ApprovalDecision,
} from "@my-agent/core";

function fakeTool(
  name: string,
  run: (args: unknown) => Promise<ToolResult>,
  requiredMode: Tool["requiredMode"] = "ReadOnly",
): ToolImpl {
  return {
    meta: { name, args: { type: "object" }, requiredMode },
    run: async (a: unknown) => run(a),
  };
}

function makeCtx(over: Partial<TurnContext> = {}): TurnContext {
  return {
    mode: "Allow",
    approval: {
      async request(): Promise<ApprovalDecision> {
        return { decision: "Allow" };
      },
    },
    emit() {
      /* noop */
    },
    ...over,
  } as unknown as TurnContext;
}

const call = (name: string, id = name, args: unknown = {}): ToolCall => ({ id, name, args });

describe("dispatch: aggregate", () => {
  it("returns the array when all results are ok", () => {
    const results: ToolResult[] = [
      { callId: "1", ok: true, output: "a" },
      { callId: "2", ok: true, output: "b" },
    ];
    expect(aggregate(results)).toBe(results);
  });

  it("returns the array for an empty input", () => {
    expect(aggregate([])).toEqual([]);
  });

  it("returns a DegradedResult naming the failed call ids", () => {
    const results: ToolResult[] = [
      { callId: "1", ok: true, output: "a" },
      { callId: "2", ok: false, output: null, error: "boom" },
      { callId: "3", ok: false, output: null, error: "bang" },
    ];
    const r = aggregate(results);
    expect(Array.isArray(r)).toBe(false);
    if (!Array.isArray(r)) {
      expect(r.failedCallIds).toEqual(["2", "3"]);
      expect(r.results).toBe(results);
    }
  });

  it("returns DegradedResult when every result failed", () => {
    const results: ToolResult[] = [
      { callId: "1", ok: false, output: null, error: "x" },
    ];
    const r = aggregate(results);
    if (!Array.isArray(r)) expect(r.failedCallIds).toEqual(["1"]);
  });
});

describe("dispatch: runTool", () => {
  it("returns ok:false for an unknown tool", async () => {
    const reg = new ToolRegistry();
    const res = await runTool(call("nope"), makeCtx(), reg);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("unknown tool");
  });

  it("executes a registered ReadOnly tool in Allow mode", async () => {
    const reg = new ToolRegistry();
    reg.register(
      fakeTool("echo", async (a) => ({ callId: "echo", ok: true, output: a })),
    );
    const res = await runTool(call("echo", "c1", { x: 1 }), makeCtx(), reg);
    expect(res.ok).toBe(true);
    expect(res.callId).toBe("c1");
    if (res.ok) expect(res.output).toEqual({ x: 1 });
  });

  it("stamps the real call.id onto the result (C2 correlation)", async () => {
    const reg = new ToolRegistry();
    reg.register(
      fakeTool("selfid", async () => ({ callId: "selfid", ok: true, output: null })),
    );
    const res = await runTool(call("selfid", "REAL"), makeCtx(), reg);
    expect(res.callId).toBe("REAL");
  });

  it("resolves an alias before dispatch (§6 R27-14)", async () => {
    const reg = new ToolRegistry();
    reg.declareAlias("search_web", "web_search");
    reg.register(
      fakeTool("web_search", async () => ({ callId: "x", ok: true, output: "hit" })),
    );
    const res = await runTool(call("search_web", "c"), makeCtx(), reg);
    expect(res.ok).toBe(true);
  });

  it("returns degraded result when the impl throws (not a thrown exception)", async () => {
    const reg = new ToolRegistry();
    reg.register(
      fakeTool("boom", async () => {
        throw new Error("kaboom");
      }),
    );
    const res = await runTool(call("boom", "c"), makeCtx(), reg);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe("kaboom");
      expect(res.degraded).toBe(true);
    }
  });

  it("returns ok:false when a DangerFullAccess approval is denied", async () => {
    const reg = new ToolRegistry();
    reg.register(
      fakeTool("danger", async () => ({ callId: "x", ok: true, output: null }), "DangerFullAccess"),
    );
    const ctx = makeCtx({
      approval: {
        async request() {
          return { decision: "Deny", reason: "no way" };
        },
      },
    });
    const res = await runTool(call("danger", "c"), ctx, reg);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("denied");
  });

  it("executes a DangerFullAccess tool when the human approves", async () => {
    const reg = new ToolRegistry();
    reg.register(
      fakeTool("danger", async () => ({ callId: "x", ok: true, output: "ran" }), "DangerFullAccess"),
    );
    const res = await runTool(call("danger", "c"), makeCtx(), reg);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.output).toBe("ran");
  });

  it("invokes the postTool hook with effective args", async () => {
    const reg = new ToolRegistry();
    reg.register(
      fakeTool("echo", async (a) => ({ callId: "echo", ok: true, output: a })),
    );
    const seen: unknown[] = [];
    const ctx = makeCtx({
      hooks: {
        postTool: (c: ToolCall) => seen.push(c),
      },
    });
    await runTool(call("echo", "c", { k: 9 }), ctx, reg);
    expect(seen).toHaveLength(1);
    expect((seen[0] as ToolCall).args).toEqual({ k: 9 });
  });
});

describe("dispatch: runToolBatch", () => {
  it("returns ToolResult[] when all calls succeed, preserving order", async () => {
    const reg = new ToolRegistry();
    reg.register(fakeTool("a", async () => ({ callId: "1", ok: true, output: "A" })));
    reg.register(fakeTool("b", async () => ({ callId: "2", ok: true, output: "B" })));
    const r = await runToolBatch([call("a", "1"), call("b", "2")], makeCtx(), reg);
    expect(Array.isArray(r)).toBe(true);
    if (Array.isArray(r)) {
      expect(r.map((x) => x.callId)).toEqual(["1", "2"]);
      expect(r.every((x) => x.ok)).toBe(true);
    }
  });

  it("returns DegradedResult when one call fails", async () => {
    const reg = new ToolRegistry();
    reg.register(fakeTool("ok", async () => ({ callId: "1", ok: true, output: null })));
    reg.register(
      fakeTool("bad", async () => {
        throw new Error("fail");
      }),
    );
    const r = await runToolBatch([call("ok", "1"), call("bad", "2")], makeCtx(), reg);
    expect(Array.isArray(r)).toBe(false);
    if (!Array.isArray(r)) {
      expect(r.failedCallIds).toEqual(["2"]);
      expect(r.results).toHaveLength(2);
    }
  });

  it("repairs malformed calls (empty name) into error results without throwing", async () => {
    const reg = new ToolRegistry();
    const malformed = { id: "m", name: "", args: {} } as ToolCall;
    const r = await runToolBatch([malformed], makeCtx(), reg);
    if (Array.isArray(r)) {
      expect(r[0]!.ok).toBe(false);
    } else {
      expect(r.failedCallIds).toEqual(["m"]);
    }
  });

  it("an empty batch returns an empty array", async () => {
    const reg = new ToolRegistry();
    const r = await runToolBatch([], makeCtx(), reg);
    expect(r).toEqual([]);
  });
});

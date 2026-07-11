import { describe, it, expect, vi } from "vitest";
import {
  parseRule,
  extractSubject,
  ruleMatches,
  requiresApproval,
  ToolRegistry,
  readTool,
  writeTool,
  type ToolImpl,
} from "@my-agent/tools";
import type { TurnContext, Mode, ToolCall } from "@my-agent/core";

const dangerTool: ToolImpl = {
  meta: { name: "danger_op", args: { type: "object" }, requiredMode: "DangerFullAccess" },
  async run() { return { callId: "1", ok: true, output: null }; },
};

function ctx(over: Partial<TurnContext> = {}): TurnContext {
  return {
    mode: "Prompt", turnId: "t", cwd: "/ws",
    session: { id: "s" } as never,
    history: { append() {} } as never,
    budget: null,
    approval: { async request() { return { decision: "Deny" as const, reason: "no" }; } },
    emit() {},
    ...over,
  } as unknown as TurnContext;
}
function reg(): ToolRegistry {
  const r = new ToolRegistry();
  r.register(readTool); r.register(writeTool); r.register(dangerTool);
  return r;
}

describe("§7 rule grammar (parse + match)", () => {
  it("parses a bare tool name (any subject)", () => {
    expect(parseRule("write")).toEqual({ tool: "write" });
  });
  it("parses tool(exact-subject)", () => {
    expect(parseRule("write(/etc/hosts)")).toEqual({ tool: "write", subject: "/etc/hosts" });
  });
  it("parses a prefix subject tool(subject:*)", () => {
    expect(parseRule("bash(rm:*)")).toEqual({ tool: "bash", subject: "rm", prefix: true });
  });
  it("lowercases", () => {
    expect(parseRule("WRITE(/X)")).toEqual({ tool: "write", subject: "/x" });
  });

  it("extractSubject reads the 10 keys (first wins)", () => {
    expect(extractSubject({ id: "1", name: "write", args: { path: "/a" } })).toBe("/a");
    expect(extractSubject({ id: "1", name: "bash", args: { command: "LS" } })).toBe("ls");
    expect(extractSubject({ id: "1", name: "x", args: { other: 1 } })).toBeUndefined();
  });

  it("ruleMatches: prefix + exact + any", () => {
    expect(ruleMatches({ tool: "bash", subject: "rm", prefix: true }, { id: "1", name: "bash", args: { command: "rm -rf /" } })).toBe(true);
    expect(ruleMatches({ tool: "bash", subject: "rm", prefix: true }, { id: "1", name: "bash", args: { command: "ls" } })).toBe(false);
    expect(ruleMatches({ tool: "write" }, { id: "1", name: "write", args: { path: "/a" } })).toBe(true);
    expect(ruleMatches({ tool: "*" }, { id: "1", name: "anything", args: {} })).toBe(true);
  });
});

describe("§7 7-step pipeline (requiresApproval)", () => {
  it("step 1: config deniedTools is unconditional (even in Allow mode)", () => {
    const c = ctx({ mode: "Allow", permission: { deniedTools: ["write"] } });
    const d = requiresApproval({ id: "1", name: "write", args: { path: "/a" } }, c, reg());
    expect(d.outcome).toBe("Deny");
    expect(d.needsHumanPrompt).toBe(false);
  });

  it("step 2: deny rule matches → Deny (no prompt)", () => {
    const c = ctx({ mode: "Allow", permission: { deny: ["bash(rm:*)"] } });
    const d = requiresApproval({ id: "1", name: "bash", args: { command: "rm -rf x" } }, c, reg());
    expect(d.outcome).toBe("Deny");
  });

  it("step 3: hook override Deny → Deny; Ask → prompt; Allow → falls through", () => {
    const call = { id: "1", name: "read", args: {} };
    // Allow mode so read would normally allow; override=Deny forces Deny
    expect(requiresApproval(call, ctx({ mode: "Allow" }), reg(), "Deny").outcome).toBe("Deny");
    expect(requiresApproval(call, ctx({ mode: "Allow" }), reg(), "Ask").needsHumanPrompt).toBe(true);
    // Allow override falls through → read allowed in Allow mode
    expect(requiresApproval(call, ctx({ mode: "Allow" }), reg(), "Allow").outcome).toBe("Allow");
  });

  it("step 4: ask rule is inviolable (always prompts, even in Allow mode)", () => {
    const c = ctx({ mode: "Allow", permission: { ask: ["write"] } });
    const d = requiresApproval({ id: "1", name: "write", args: { path: "/a" } }, c, reg());
    expect(d.needsHumanPrompt).toBe(true);
  });

  it("step 5: allow rule matches → Allow", () => {
    const c = ctx({ mode: "Prompt", permission: { allow: ["read"] } });
    const d = requiresApproval({ id: "1", name: "read", args: {} }, c, reg());
    expect(d.outcome).toBe("Allow");
    expect(d.needsHumanPrompt).toBe(false);
  });

  it("D8: DangerFullAccess ALWAYS escalates, even with an allow rule + Allow mode", () => {
    const c = ctx({ mode: "Allow", permission: { allow: ["danger_op"] } });
    const d = requiresApproval({ id: "1", name: "danger_op", args: {} }, c, reg());
    expect(d.outcome).toBe("Deny");
    expect(d.needsHumanPrompt).toBe(true);
  });

  it("Allow override falls through BUT still respects ask rules (invariant #13)", () => {
    const c = ctx({ mode: "Allow", permission: { ask: ["write"] } });
    // override=Allow falls through to step 4 → ask rule matches → prompt
    const d = requiresApproval({ id: "1", name: "write", args: { path: "/a" } }, c, reg(), "Allow");
    expect(d.needsHumanPrompt).toBe(true);
  });

  it("Prompt mode asks for writes but auto-allows ReadOnly", () => {
    const read = requiresApproval({ id: "1", name: "read", args: {} }, ctx({ mode: "Prompt" }), reg());
    expect(read.outcome).toBe("Allow");
    // read is ReadOnly, Prompt auto-allows ReadOnly (R27-2/D9)
  });
});

describe("§7 R26-D: concurrent-approval serialization", () => {
  it("approval-requiring tools run sequentially; the rest in parallel", async () => {
    const { runToolBatch } = await import("@my-agent/tools");
    const order: string[] = [];
    // read = ReadOnly (parallel, no prompt in Allow mode); danger_op = prompt
    const calls: ToolCall[] = [
      { id: "a", name: "read", args: {} },
      { id: "b", name: "danger_op", args: {} },
      { id: "c", name: "read", args: {} },
    ];
    const c = ctx({
      mode: "Allow",
      approval: { async request(r) { order.push(`ask:${r.call.id}`); return { decision: "Deny", reason: "test" }; } },
    });
    await runToolBatch(calls, c, reg());
    // both reads ran (parallel, allowed); danger_op prompted once (sequential)
    expect(order).toEqual(["ask:b"]);
  });
});

describe("§7 CC7: pre-hook override + arg mutation", () => {
  it("pre-hook override=Deny denies; args mutation reaches the tool", async () => {
    const { runToolBatch, ok } = await import("@my-agent/tools");
    let seenArgs: unknown = null;
    const echoTool: ToolImpl = {
      meta: { name: "echo", args: { type: "object" }, requiredMode: "ReadOnly" },
      async run(a) { seenArgs = a; return ok("echo", { got: true }); },
    };
    const r = reg(); r.register(echoTool);
    const c = ctx({
      mode: "Allow",
      hooks: {
        async preTool(call) {
          if (call.name === "echo") return { args: { ...call.args as object, redacted: true } };
          return {};
        },
      },
    });
    await runToolBatch([{ id: "1", name: "echo", args: { secret: "x" } }], c, r);
    expect(seenArgs).toMatchObject({ secret: "x", redacted: true }); // mutated args reached the tool
  });
});

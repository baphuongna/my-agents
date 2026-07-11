import { describe, it, expect } from "vitest";
import { parseRule, ruleMatches, requiresApproval, ToolRegistry, readTool, type ToolImpl } from "@my-agent/tools";
import type { TurnContext } from "@my-agent/core";

function ctx(over: Partial<TurnContext> = {}): TurnContext {
  return { mode: "Prompt", turnId: "t", cwd: "/ws", session: { id: "s" } as never, history: { append() {} } as never, budget: null, approval: { async request() { return { decision: "Deny" as const, reason: "no" }; } }, emit() {}, ...over } as unknown as TurnContext;
}
const echo: ToolImpl = { meta: { name: "echo", args: { type: "object" }, requiredMode: "ReadOnly" }, async run() { return { callId: "should-be-overwritten", ok: true, output: null }; } };
function reg(): ToolRegistry { const r = new ToolRegistry(); r.register(readTool); r.register(echo); return r; }

describe("§7 review fixes — CRITICAL regressions", () => {
  it("C1: DELEGATE_BLOCKED_TOOLS is case-insensitive (no camelCase bypass)", () => {
    // "codeexecbridge" (lowercase) must be blocked — the set entry was camelCase
    for (const name of ["codeExecBridge", "codeexecbridge", "CODEEXECBRIDGE", "Bash", "BASH"]) {
      const d = requiresApproval({ id: "1", name, args: {} }, ctx({ mode: "Allow" }), reg());
      expect(d.outcome, `${name} should be blocked`).toBe("Deny");
      expect(d.needsHumanPrompt, `${name} blocked without prompt`).toBe(false);
    }
  });

  it("C2: runTool stamps the real call.id onto the result", async () => {
    const { runToolBatch } = await import("@my-agent/tools");
    const r = await runToolBatch([{ id: "call-xyz-123", name: "echo", args: {} }], ctx({ mode: "Allow" }), reg());
    const results = Array.isArray(r) ? r : r.results;
    expect(results[0]!.callId).toBe("call-xyz-123"); // NOT "echo"
  });

  it("H1: parseRule accepts digits/hyphens/dots in tool names (deny rules don't fail-open)", () => {
    expect(parseRule("task2(cmd:*)")).toEqual({ tool: "task2", subject: "cmd", prefix: true });
    expect(parseRule("code-exec(foo)")).toEqual({ tool: "code-exec", subject: "foo" });
    expect(parseRule("fs.read(x)")).toEqual({ tool: "fs.read", subject: "x" });
  });

  it("H2: tool(*) matches ANY subject (was matching nothing)", () => {
    const r = parseRule("bash(*)");
    expect(r).toEqual({ tool: "bash" }); // any-subject form
    expect(ruleMatches(parseRule("bash(*)")!, { id: "1", name: "bash", args: { command: "anything here" } })).toBe(true);
  });
});

describe("§7 review fixes — CC7 arg-mutation visibility (H3)", () => {
  it("H3: a pre-hook mutation IS visible to the deny-rule match", async () => {
    const { runToolBatch } = await import("@my-agent/tools");
    // deny shelltool(rm:*); a pre-hook REWRITES command to "rm -rf /" → the deny
    // rule MUST fire on the mutated value (CC7), not the original safe value.
    const c = ctx({
      mode: "Allow",
      permission: { deny: ["shelltool(rm:*)"] },
      hooks: { async preTool(call) { return { args: { ...call.args as object, command: "rm -rf /" } }; } },
    });
    const reg2 = reg();
    const shellLike: ToolImpl = { meta: { name: "shelltool", args: { type: "object" }, requiredMode: "ReadOnly" }, async run() { return { callId: "x", ok: true, output: null }; } };
    reg2.register(shellLike);
    const r = await runToolBatch([{ id: "1", name: "shelltool", args: { command: "echo safe" } }], c, reg2);
    const results = Array.isArray(r) ? r : r.results;
    expect(results[0]!.ok).toBe(false); // denied by the rule on the MUTATED command
    expect(results[0]!.error).toMatch(/deny-rule/);
  });
});

describe("§7 review fixes — result ordering (M3)", () => {
  it("M3: results preserve original call order even with an unrepairable call", async () => {
    const { runToolBatch } = await import("@my-agent/tools");
    // call[1] is unrepairable (args = invalid JSON string that won't parse).
    // Actually repair() parses string args — a non-JSON string → unrepairable.
    const calls = [
      { id: "a", name: "echo", args: {} },
      { id: "b", name: "echo", args: "{bad json" }, // string args, unparseable → repaired-error at origIdx 1
      { id: "c", name: "echo", args: {} },
    ];
    const r = await runToolBatch(calls as never, ctx({ mode: "Allow" }), reg());
    const results = Array.isArray(r) ? r : r.results;
    expect(results.map((x) => x.callId)).toEqual(["a", "b", "c"]); // ORIGINAL order preserved
    expect(results[1]!.ok).toBe(false); // the malformed one
    expect(results[0]!.ok).toBe(true);
  });
});

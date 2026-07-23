import { describe, it, expect } from "vitest";
import {
  ToolRegistry,
  readTool,
  requiresApproval,
  resolveInsideWorkspace,
  parseRule,
  extractSubject,
  ruleMatches,
  awaitHumanPrompt,
  type ToolImpl,
} from "@my-agent/tools";
import type { TurnContext, Mode, ApprovalChannel, ApprovalDecision } from "@my-agent/core";

function ctx(mode: Mode): TurnContext {
  return {
    mode,
    turnId: "t1",
    cwd: "/ws",
    session: { id: "s", mode } as never,
    history: { append() { return undefined; } } as never,
    budget: null,
    emit() { return undefined; },
  } as unknown as TurnContext;
}
const dangerTool: ToolImpl = {
  meta: { name: "dangerous_op", args: { type: "object" }, requiredMode: "DangerFullAccess" },
  async run() { return { callId: "1", ok: true, output: null }; },
};

function reg(): ToolRegistry {
  const r = new ToolRegistry();
  r.register(readTool);
  r.register(dangerTool);
  return r;
}

describe("§7 permission gate", () => {
  it("read (ReadOnly) is auto-allowed in Prompt mode (R27-2/D9: Prompt prompts writes only)", () => {
    const d = requiresApproval({ id: "1", name: "read", args: {} }, ctx("Prompt"), reg());
    expect(d.outcome).toBe("Allow");
    expect(d.needsHumanPrompt).toBe(false);
  });

  it("DELEGATE_BLOCKED_TOOLS (bash/spawn/exec) are denied outright without prompt", () => {
    for (const name of ["bash", "spawn", "exec"]) {
      const d = requiresApproval({ id: "1", name, args: {} }, ctx("Allow"), reg());
      expect(d.outcome).toBe("Deny");
      expect(d.needsHumanPrompt).toBe(false);
    }
  });

  it("F2: a DangerFullAccess tool ALWAYS escalates, even in Allow mode", () => {
    // modeSatisfies("Allow", anything) would return true (silent grant); the F2
    // guard forces a human prompt for any DangerFullAccess requirement first.
    for (const mode of ["Allow", "DangerFullAccess", "WorkspaceWrite"] as Mode[]) {
      const d = requiresApproval({ id: "1", name: "dangerous_op", args: {} }, ctx(mode), reg());
      expect(d.outcome).toBe("Deny");
      expect(d.needsHumanPrompt).toBe(true);
    }
  });

  it("unknown tool is denied without prompt", () => {
    const d = requiresApproval({ id: "1", name: "nope", args: {} }, ctx("Allow"), reg());
    expect(d.outcome).toBe("Deny");
    expect(d.needsHumanPrompt).toBe(false);
  });
});

describe("§7 path-safety (F1: containment)", () => {
  it("rejects traversal", () => {
    const r = resolveInsideWorkspace("../../etc/passwd", "/ws");
    expect(r.ok).toBe(false);
  });
  it("accepts an in-root path", () => {
    const r = resolveInsideWorkspace("src/a.ts", "/ws");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.abs.startsWith("/ws")).toBe(true);
  });
  it("rejects absolute escape", () => {
    const r = resolveInsideWorkspace("/etc/passwd", "/ws");
    expect(r.ok).toBe(false);
  });
});

describe("§7 parseRule (rule grammar)", () => {
  it("parses a bare tool name (any subject)", () => {
    expect(parseRule("read")).toEqual({ tool: "read" });
  });
  it("parses tool(subject) exact", () => {
    expect(parseRule("read(/etc/passwd)")).toEqual({ tool: "read", subject: "/etc/passwd" });
  });
  it("parses tool(subject:*) prefix", () => {
    expect(parseRule("write(src:*)")).toEqual({ tool: "write", subject: "src", prefix: true });
  });
  it("tool(*) means any subject (collapses to bare tool)", () => {
    expect(parseRule("bash(*)")).toEqual({ tool: "bash" });
  });
  it("lowercases tool + subject", () => {
    expect(parseRule("READ(/ETC)")).toEqual({ tool: "read", subject: "/etc" });
  });
  it("allows digits, hyphens, dots in tool names (H1)", () => {
    expect(parseRule("tool-1.2(path)")).toEqual({ tool: "tool-1.2", subject: "path" });
  });
  it("'*' as tool matches any tool", () => {
    expect(parseRule("*(path)")).toEqual({ tool: "*", subject: "path" });
  });
  it("returns null for an invalid rule", () => {
    expect(parseRule("(nopath)")).toBeNull();
    expect(parseRule("")).toBeNull();
  });
});

describe("§7 extractSubject (10 JSON keys, lowercased)", () => {
  it("extracts the first present subject key", () => {
    expect(extractSubject({ id: "1", name: "bash", args: { command: "LS -la" } })).toBe("ls -la");
    expect(extractSubject({ id: "1", name: "read", args: { path: "/A/B" } })).toBe("/a/b");
    expect(extractSubject({ id: "1", name: "web", args: { url: "HTTPS://X" } })).toBe("https://x");
  });
  it("returns undefined when no subject key is present", () => {
    expect(extractSubject({ id: "1", name: "x", args: { foo: "bar" } })).toBeUndefined();
  });
  it("returns undefined for non-object args", () => {
    expect(extractSubject({ id: "1", name: "x", args: "str" })).toBeUndefined();
    expect(extractSubject({ id: "1", name: "x", args: null })).toBeUndefined();
  });
  it("prefers effectiveArgs over call.args (H3: pre-hook mutations visible)", () => {
    const call = { id: "1", name: "bash", args: { command: "ORIGINAL" } };
    expect(extractSubject(call, { command: "overridden" })).toBe("overridden");
  });
});

describe("§7 ruleMatches", () => {
  const call = (args: unknown = {}) => ({ id: "1", name: "read", args });
  it("a bare tool rule matches any call of that tool", () => {
    expect(ruleMatches({ tool: "read" }, call())).toBe(true);
  });
  it("a tool mismatch fails fast", () => {
    expect(ruleMatches({ tool: "write" }, call())).toBe(false);
  });
  it("'*' tool matches any tool", () => {
    expect(ruleMatches({ tool: "*" }, call())).toBe(true);
  });
  it("exact subject requires an equal subject", () => {
    expect(ruleMatches({ tool: "read", subject: "/a" }, call({ path: "/a" }))).toBe(true);
    expect(ruleMatches({ tool: "read", subject: "/a" }, call({ path: "/b" }))).toBe(false);
  });
  it("a subject rule requires a subject to be present", () => {
    expect(ruleMatches({ tool: "read", subject: "/a" }, call({}))).toBe(false);
  });
  it("prefix subject matches startsWith", () => {
    expect(ruleMatches({ tool: "read", subject: "src", prefix: true }, call({ path: "src/a" }))).toBe(true);
    expect(ruleMatches({ tool: "read", subject: "src", prefix: true }, call({ path: "etc/x" }))).toBe(false);
  });
  it("uses effectiveArgs for subject extraction", () => {
    const c = { id: "1", name: "read", args: { path: "/old" } };
    expect(ruleMatches({ tool: "read", subject: "/new" }, c, { path: "/new" })).toBe(true);
  });
});

describe("§7 awaitHumanPrompt (human round-trip)", () => {
  const allowChannel: ApprovalChannel = {
    async request() {
      return { decision: "Allow" };
    },
  };
  const denyChannel: ApprovalChannel = {
    async request() {
      return { decision: "Deny", reason: "no" };
    },
  };
  function ctxWith(channel: ApprovalChannel, mode: Mode = "Prompt"): TurnContext {
    return {
      mode,
      approval: channel,
      emit() {
        /* noop */
      },
    } as unknown as TurnContext;
  }

  it("returns Allow immediately when no prompt is needed", async () => {
    const d = await awaitHumanPrompt(
      { id: "1", name: "read", args: {} },
      ctxWith(allowChannel),
      { outcome: "Allow", needsHumanPrompt: false },
      reg(),
    );
    expect(d.decision).toBe("Allow");
  });

  it("returns Deny (with reason) immediately when denied without prompt", async () => {
    const d = await awaitHumanPrompt(
      { id: "1", name: "nope", args: {} },
      ctxWith(allowChannel),
      { outcome: "Deny", reason: "unknown tool", needsHumanPrompt: false },
      reg(),
    );
    expect(d.decision).toBe("Deny");
    if (d.decision === "Deny") expect(d.reason).toBe("unknown tool");
  });

  it("asks the human via ctx.approval when a prompt is needed", async () => {
    const d = await awaitHumanPrompt(
      { id: "1", name: "dangerous_op", args: {} },
      ctxWith(allowChannel),
      { outcome: "Deny", reason: "DangerFullAccess requires explicit human approval", needsHumanPrompt: true },
      reg(),
    );
    expect(d.decision).toBe("Allow");
  });

  it("propagates a human Deny", async () => {
    const d = await awaitHumanPrompt(
      { id: "1", name: "dangerous_op", args: {} },
      ctxWith(denyChannel),
      { outcome: "Deny", reason: "DangerFullAccess requires explicit human approval", needsHumanPrompt: true },
      reg(),
    );
    expect(d.decision).toBe("Deny");
    if (d.decision === "Deny") expect(d.reason).toBe("no");
  });
});

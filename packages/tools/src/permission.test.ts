import { describe, it, expect } from "vitest";
import { ToolRegistry, readTool, requiresApproval, resolveInsideWorkspace, type ToolImpl } from "@my-agent/tools";
import type { TurnContext, Mode } from "@my-agent/core";

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
  it("read with no budget-bound mode escalates to a human (active=Prompt)", () => {
    // guessActiveMode is a Tier-1 stub returning "Prompt"; a read still asks.
    const d = requiresApproval({ id: "1", name: "read", args: {} }, ctx("Prompt"), reg());
    expect(d.needsHumanPrompt).toBe(true);
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

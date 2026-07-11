import { describe, it, expect } from "vitest";
import { InProcessRunner } from "@my-agent/subagents";
import { createBudget, freeBudget } from "@my-agent/core";
import type { ProviderProfile, StreamEvent, ToolExecutor, ToolCall, ToolResult } from "@my-agent/core";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";

/** A mock profile: round 1 emits a `write` tool call; round 2 completes. */
function mockProfile(): ProviderProfile {
  let round = 0;
  return {
    id: "mock",
    model: "mock-1",
    async stream() {
      round++;
      const events: StreamEvent[] = round === 1
        ? [{ kind: "tool_calls", calls: [{ id: "w1", name: "write", args: { path: "out.txt", content: "child-wrote" } }] }, { kind: "done", usage: { input: 1, output: 1 }, finish: "tool" }]
        : [{ kind: "text", text: '{"done": true}' }, { kind: "done", usage: { input: 1, output: 1 }, finish: "stop" }];
      return { events };
    },
    health: () => "Healthy" as const,
  };
}

describe("§10.2 spawn → CoW mergeBack wiring", () => {
  it("a child's file writes 3-way-merge into the parent workspace", async () => {
    const parentWs = mkdtempSync(join(tmpdir(), "cow-parent-"));
    writeFileSync(join(parentWs, "existing.txt"), "base"); // a base file
    // makeToolExecutor: a `write` tool that writes to ctx.workspace (the sandbox)
    const makeToolExecutor = (): ToolExecutor => ({
      async execute(calls: ToolCall[], ctx): Promise<ToolResult[]> {
        for (const c of calls) {
          if (c.name === "write") {
            const a = c.args as { path: string; content: string };
            await writeFile(join(ctx.workspace ?? parentWs, a.path), a.content);
          }
        }
        return calls.map((c) => ({ callId: c.id, ok: true, output: null }));
      },
    });
    const runner = new InProcessRunner({
      profile: mockProfile(),
      makeToolExecutor,
      parentBudget: freeBudget(),
      childAlloc: 1,
    });
    const r = await runner.spawn({
      prompt: "write out.txt",
      toolSurface: { allowed: ["write"], blocked: [] },
      approval: { request: async () => ({ decision: "Allow" as const }) },
      budget: freeBudget(),
      parentWorkspace: parentWs,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.changedPaths).toContain("out.txt");
      // the child's new file merged into the parent
      expect(existsSync(join(parentWs, "out.txt"))).toBe(true);
      expect(readFileSync(join(parentWs, "out.txt"), "utf8")).toBe("child-wrote");
      // the pre-existing base file is untouched
      expect(readFileSync(join(parentWs, "existing.txt"), "utf8")).toBe("base");
    }
  });
});

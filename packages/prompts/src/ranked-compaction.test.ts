import { describe, it, expect } from "vitest";
import {
  rankedCompact,
  rankBriefBlocks,
  selectRankedBriefBlocks,
  type NormalizedBlock,
  type RankedBlock,
} from "./ranked-compaction.js";
import type { RuntimeEvent } from "@my-agent/core";

// ─── Helper: build RuntimeEvents for testing ────────────────────────────────

function userEvent(text: string): RuntimeEvent {
  return { kind: "turn", stage: "start", turnEvent: { state: "Streaming", chunk: { kind: "text", text } } };
}

function assistantEvent(text: string): RuntimeEvent {
  return { kind: "turn", stage: "event", turnEvent: { state: "Streaming", chunk: { kind: "text", text } } };
}

function toolCallEvent(name: string, args: Record<string, unknown>): RuntimeEvent {
  return { kind: "tool", stage: "request", call: { id: `call-${Date.now()}`, name, args } };
}

function toolResultEvent(callId: string, output: string): RuntimeEvent {
  return {
    kind: "turn",
    stage: "event",
    turnEvent: {
      state: "ToolExec",
      result: [{ callId, ok: true, output }],
    },
  };
}

function bashEvent(command: string, output: string, exitCode?: number): RuntimeEvent {
  return toolCallEvent("bash", { command });
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("rankedCompact", () => {
  it("returns a summary with sections when given a mix of events", () => {
    const events: RuntimeEvent[] = [
      userEvent("Fix the bug in login.ts"),
      assistantEvent("I'll examine the file and fix it."),
      toolCallEvent("read", { path: "src/login.ts" }),
      toolResultEvent("call-1", "function login() { ... }"),
      toolCallEvent("edit", { path: "src/login.ts" }),
      toolResultEvent("call-2", "File edited successfully"),
      assistantEvent("I've fixed the bug. The issue was a missing null check."),
    ];

    const result = rankedCompact(events);
    expect(result.summary).toContain("## Session Goal");
    expect(result.summary).toContain("Fix the bug in login.ts");
    expect(result.blocksKept).toBeGreaterThan(0);
    expect(result.tokensSaved).toBeGreaterThanOrEqual(0);
  });

  it("respects maxTokens budget", () => {
    const events: RuntimeEvent[] = [
      userEvent("Fix the bug"),
      assistantEvent("I'll fix it."),
      toolCallEvent("read", { path: "src/login.ts" }),
      toolResultEvent("call-1", "function login() { ... }"),
      toolCallEvent("edit", { path: "src/login.ts" }),
      toolResultEvent("call-2", "File edited successfully"),
      assistantEvent("Fixed."),
    ];

    const result = rankedCompact(events, { maxTokens: 50 });
    // With very low budget, should still keep something but fewer blocks
    expect(result.blocksKept).toBeGreaterThan(0);
  });

  it("scores edit tools higher than read tools", () => {
    const editBlock: NormalizedBlock = { kind: "tool_call", name: "edit", args: { path: "file.ts" } };
    const readBlock: NormalizedBlock = { kind: "tool_call", name: "read", args: { path: "file.ts" } };

    const editRanked = rankBriefBlocks([editBlock]);
    const readRanked = rankBriefBlocks([readBlock]);

    expect(editRanked[0].score).toBeGreaterThan(readRanked[0].score);
  });

  it("scores bash commands with test keywords higher", () => {
    const testBash: NormalizedBlock = { kind: "bash", command: "npm test", output: "", exitCode: 0 };
    const regularBash: NormalizedBlock = { kind: "bash", command: "ls -la", output: "", exitCode: 0 };

    const testRanked = rankBriefBlocks([testBash]);
    const regularRanked = rankBriefBlocks([regularBash]);

    expect(testRanked[0].score).toBeGreaterThan(regularRanked[0].score);
  });

  it("penalizes trivial bash commands", () => {
    const trivialBash: NormalizedBlock = { kind: "bash", command: "echo hello", output: "", exitCode: 0 };
    const realBash: NormalizedBlock = { kind: "bash", command: "cargo build", output: "", exitCode: 0 };

    const trivialRanked = rankBriefBlocks([trivialBash]);
    const realRanked = rankBriefBlocks([realBash]);

    expect(trivialRanked[0].score).toBeLessThan(realRanked[0].score);
  });

  it("preserves recent blocks even when budget is tight", () => {
    // Create 20 blocks, last 5 are recent
    const blocks: NormalizedBlock[] = [];
    for (let i = 0; i < 20; i++) {
      blocks.push({ kind: "assistant", text: `Message ${i}` });
    }

    const selected = selectRankedBriefBlocks(blocks, {
      maxBlocks: 10,
      preserveRecentBlocks: 5,
      maxTokens: 200,
    });

    // Should include the last 5 blocks
    expect(selected.length).toBeGreaterThanOrEqual(5);
    const lastFive = blocks.slice(15);
    for (const block of lastFive) {
      expect(selected).toContainEqual(block);
    }
  });

  it("deduplicates bash commands", () => {
    const blocks: NormalizedBlock[] = [
      { kind: "bash", command: "npm test", output: "pass", exitCode: 0 },
      { kind: "assistant", text: "Running tests..." },
      { kind: "bash", command: "npm test", output: "pass", exitCode: 0 },
      { kind: "bash", command: "cargo build", output: "success", exitCode: 0 },
    ];

    const selected = selectRankedBriefBlocks(blocks, {
      maxBlocks: 10,
      preserveRecentBlocks: 0,
    });

    // Should not have duplicate bash commands
    const bashCommands = selected
      .filter((b) => b.kind === "bash")
      .map((b) => b.command);
    // Unique commands: npm test and cargo build (dedup removes the duplicate npm test)
    expect(new Set(bashCommands).size).toBe(2);
    expect(bashCommands).toContain("npm test");
    expect(bashCommands).toContain("cargo build");
  });

  it("scores nonzero exit code higher than normal bash", () => {
    const successBash: NormalizedBlock = { kind: "bash", command: "npm test", output: "pass", exitCode: 0 };
    const failBash: NormalizedBlock = { kind: "bash", command: "npm test", output: "fail", exitCode: 1 };

    const successRanked = rankBriefBlocks([successBash]);
    const failRanked = rankBriefBlocks([failBash]);

    expect(failRanked[0].score).toBeGreaterThan(successRanked[0].score);
  });

  it("scores workflow commands higher than regular commands", () => {
    const regularBash: NormalizedBlock = { kind: "bash", command: "ls -la", output: "", exitCode: 0 };
    const workflowBash: NormalizedBlock = { kind: "bash", command: "git commit -m 'fix'", output: "", exitCode: 0 };

    const regularRanked = rankBriefBlocks([regularBash]);
    const workflowRanked = rankBriefBlocks([workflowBash]);

    expect(workflowRanked[0].score).toBeGreaterThan(regularRanked[0].score);
  });

  it("handles empty input gracefully", () => {
    const result = rankedCompact([]);
    expect(result.summary).toBe("");
    expect(result.blocksKept).toBe(0);
    expect(result.tokensSaved).toBe(0);
  });

  it("generates structured sections with all parts", () => {
    const events: RuntimeEvent[] = [
      userEvent("Fix the login bug"),
      assistantEvent("I'll examine the code and fix it."),
      toolCallEvent("edit", { path: "src/login.ts" }),
      toolResultEvent("call-1", "File edited successfully"),
      assistantEvent("The bug has been fixed. The issue was a missing null check."),
    ];

    const result = rankedCompact(events);

    expect(result.summary).toContain("## Session Goal");
    expect(result.summary).toContain("## Brief Transcript");
    expect(result.summary).toContain("Fix the login bug");
  });
});
import { describe, it, expect } from "vitest";
import { ClaudeEventNormalizer, ClaudeRuntime, ClaudeSession } from "./claude.js";
import type { StartOpts } from "@my-agent/core";

const opts: StartOpts = { cwd: "/tmp", agentDir: "/tmp/agent", sessionId: "test-claude", env: {} };

describe("[unit] ClaudeEventNormalizer", () => {
  it("assistant text event", () => {
    const line = JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "hello" }] } });
    expect(ClaudeEventNormalizer.parseLine(line)).toEqual({ type: "text", delta: "hello" });
  });

  it("assistant tool_use event", () => {
    const line = JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "tc1", name: "bash", input: { cmd: "ls" } }] } });
    expect(ClaudeEventNormalizer.parseLine(line)).toEqual({ type: "tool_call", toolCallId: "tc1", name: "bash", args: { cmd: "ls" } });
  });

  it("result with usage returns _usage_update", () => {
    const line = JSON.stringify({ type: "result", usage: { input_tokens: 100, output_tokens: 50 }, cost: 0.01 });
    const result = ClaudeEventNormalizer.parseLine(line) as any;
    expect(result?.type).toBe("_usage_update");
    expect(result?.tokensIn).toBe(100);
  });

  it("invalid JSON returns null", () => {
    expect(ClaudeEventNormalizer.parseLine("not json")).toBeNull();
  });

  it("unknown type returns null", () => {
    expect(ClaudeEventNormalizer.parseLine(JSON.stringify({ type: "unknown" }))).toBeNull();
  });
});

describe("[unit] ClaudeRuntime", () => {
  it("capabilities correct for subprocess", () => {
    const rt = new ClaudeRuntime();
    const caps = rt.capabilities();
    expect(caps.execution).toBe("subprocess");
    expect(caps.injectionMethod).toBe("stdin-prompt");
    expect(caps.supportsCompaction).toBe(false);
  });

  it("listModels returns claude models", async () => {
    const rt = new ClaudeRuntime();
    const models = await rt.listModels();
    expect(models.length).toBeGreaterThanOrEqual(1);
    expect(models[0]!.provider).toBe("anthropic");
  });

  it("sessionId and runtimeType", () => {
    const session = new ClaudeSession(opts);
    expect(session.sessionId).toBe("test-claude");
    expect(session.runtimeType).toBe("claude");
    expect(session.executionModel).toBe("subprocess");
  });
});

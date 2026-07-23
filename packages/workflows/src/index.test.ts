/**
 * @my-agent/workflows — barrel export tests for runRhaiWorkflow.
 */
import { describe, it, expect, afterEach } from "vitest";
import { runRhaiWorkflow } from "./index.js";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function makeWorkspace(): string {
  const dir = join(tmpdir(), `rhai-wf-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

const workspaces: string[] = [];

afterEach(() => {
  while (workspaces.length) {
    const dir = workspaces.pop()!;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

function makeContext(input: unknown = "hello") {
  return {
    input,
    tools: { execute: async () => [] } as never,
    provider: {
      id: "mock",
      model: "mock",
      stream: async () => ({ events: [] }),
      health: () => "Healthy",
    } as never,
    session: { id: "test", cwd: tmpdir() },
  };
}

describe("runRhaiWorkflow — Rhai-script workflow runner (§25 / Gap 4)", () => {
  it("reads + evaluates a simple script, returning the value", async () => {
    const ws = makeWorkspace();
    workspaces.push(ws);
    const file = join(ws, "simple.rhai");
    writeFileSync(file, "return 6 * 7;\n");

    const result = await runRhaiWorkflow(file, makeContext());
    expect(result.value).toBe(42);
    expect(Array.isArray(result.events)).toBe(true);
  });

  it("emits log events from inside the script", async () => {
    const ws = makeWorkspace();
    workspaces.push(ws);
    const file = join(ws, "log.rhai");
    writeFileSync(file, "log('info', 'workflow-started');\nreturn null;\n");

    const result = await runRhaiWorkflow(file, makeContext());
    const logs = result.events.filter((e) => e.kind === "log");
    expect(logs).toHaveLength(1);
    expect(logs[0]!.level).toBe("info");
    expect(logs[0]!.message).toBe("workflow-started");
  });

  it("exposes ctx.input to the script as the `input` global", async () => {
    const ws = makeWorkspace();
    workspaces.push(ws);
    const file = join(ws, "input.rhai");
    writeFileSync(file, "return input;\n");

    const result = await runRhaiWorkflow(file, makeContext("the-answer"));
    expect(result.value).toBe("the-answer");
  });

  it("emits structured events via emit_event", async () => {
    const ws = makeWorkspace();
    workspaces.push(ws);
    const file = join(ws, "emit.rhai");
    writeFileSync(file, "emit_event('step.done', { ok: true });\nreturn null;\n");

    const result = await runRhaiWorkflow(file, makeContext());
    const custom = result.events.filter((e) => e.kind === "step.done");
    expect(custom).toHaveLength(1);
    expect(custom[0]!.payload).toEqual({ ok: true });
  });

  it("captures script errors as an error event (no throw)", async () => {
    const ws = makeWorkspace();
    workspaces.push(ws);
    const file = join(ws, "err.rhai");
    writeFileSync(file, "throw new Error('script-boom');\n");

    const result = await runRhaiWorkflow(file, makeContext());
    expect(result.value).toBeUndefined();
    expect(result.events.some((e) => e.kind === "error" && e.message?.includes("script-boom"))).toBe(
      true,
    );
  });

  it("rejects when the workflow file does not exist", async () => {
    await expect(
      runRhaiWorkflow(join(tmpdir(), `nope-${Date.now()}.rhai`), makeContext()),
    ).rejects.toThrow();
  });
});

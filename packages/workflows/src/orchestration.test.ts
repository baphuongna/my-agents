/**
 * Workflow orchestration primitives (A1) — agent/parallel/pipeline/phase.
 *
 * Uses a MOCK spawn (no real subagent/LLM needed) to verify the orchestration
 * semantics: parallel runs concurrently, pipeline sequences, phase emits events,
 * agent() throws clearly when no spawn is bound.
 *
 * NOTE: the vm runner expects CommonJS `module.exports.default = async (ctx) => ...`
 * (NOT ESM `export default` — `export` is a syntax error in the script context).
 */
import { describe, it, expect } from "vitest";
import { runWorkflowSource, type WorkflowContext } from "./runner.js";

function makeCtx(spawn?: WorkflowContext["spawn"]): WorkflowContext {
  return {
    input: undefined,
    tools: { execute: async () => [] } as never,
    provider: { stream: async () => ({ events: [] }), health: (() => "Healthy") as () => "Healthy", id: "s", model: "s" } as never,
    session: { id: "test", cwd: "." },
    spawn,
  };
}

const logs = (events: Array<{ kind: string; message?: string }>) =>
  events.filter((e) => e.kind === "log").map((e) => e.message ?? "").join("\n");

describe("workflow orchestration primitives (A1)", () => {
  it("parallel runs agents concurrently (max concurrency > 1)", async () => {
    let active = 0;
    let maxActive = 0;
    const spawn: WorkflowContext["spawn"] = async (goal) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 40));
      active--;
      return `done:${goal}`;
    };
    const script = `
      module.exports.default = async (ctx) => {
        return await parallel([() => agent("a"), () => agent("b"), () => agent("c")]);
      };`;
    const events = await runWorkflowSource(script, makeCtx(spawn), { timeoutMs: 5000 });
    expect(maxActive).toBe(3); // concurrency — all three ran at once
    expect(logs(events)).toMatch(/done:a.*done:b.*done:c/); // parallel preserves order
  });

  it("pipeline sequences stages (each receives previous output)", async () => {
    const spawn: WorkflowContext["spawn"] = async (goal) => `[${goal}]`;
    const script = `
      module.exports.default = async (ctx) => {
        return await pipeline([
          (x) => agent("s1:" + (x ?? "start")),
          (prev) => agent("s2:" + prev),
        ]);
      };`;
    const events = await runWorkflowSource(script, makeCtx(spawn), { timeoutMs: 5000 });
    // stage1 got "start" → "[s1:start]"; stage2 got that → "[s2:[s1:start]]"
    expect(logs(events)).toMatch(/s2:\[s1:start\]/);
  });

  it("phase emits checkpoint log events", async () => {
    const script = `
      module.exports.default = async (ctx) => {
        phase("setup");
        phase("run");
        return "ok";
      };`;
    const events = await runWorkflowSource(script, makeCtx(), { timeoutMs: 5000 });
    const phases = events.filter((e) => e.kind === "log" && /^\[phase\]/.test(e.message ?? ""));
    expect(phases.length).toBe(2);
  });

  it("agent() throws a clear 'unavailable' error when no spawn is bound", async () => {
    const script = `module.exports.default = async (ctx) => { return await agent("x"); };`;
    const events = await runWorkflowSource(script, makeCtx(/* no spawn */), { timeoutMs: 5000 });
    expect(events.some((e) => e.kind === "log" && e.level === "error" && /unavailable/.test(e.message ?? ""))).toBe(true);
  });

  it("passes ctx.input through to the workflow body", async () => {
    const script = `module.exports.default = async (ctx) => { return "got:" + ctx.input.key; };`;
    const ctx = makeCtx();
    ctx.input = { key: "value" };
    const events = await runWorkflowSource(script, ctx, { timeoutMs: 5000 });
    expect(logs(events)).toMatch(/got:value/);
  });
});

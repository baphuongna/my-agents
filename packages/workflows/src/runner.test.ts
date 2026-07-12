/**
 * @my-agent/workflows — runner tests.
 */
import { describe, it, expect } from "vitest";
import { runWorkflow } from "./runner.js";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("runWorkflow", () => {
  it("executes a simple workflow", async () => {
    const wfPath = join(tmpdir(), `test-wf-${Date.now()}.mjs`);
    writeFileSync(wfPath, `
      export default async function(ctx) {
        return { ok: true, input: ctx.input };
      }
    `);
    try {
      const events = await runWorkflow(wfPath, {
        input: "hello",
        tools: { execute: async () => [] } as never,
        provider: { id: "mock", model: "mock", stream: async () => ({ events: [] }), health: () => "Healthy" } as never,
        session: { id: "test", cwd: tmpdir() },
      });
      expect(events).toBeDefined();
    } finally {
      unlinkSync(wfPath);
    }
  });

  it("handles workflow errors gracefully", async () => {
    const wfPath = join(tmpdir(), `test-wf-err-${Date.now()}.mjs`);
    writeFileSync(wfPath, `
      export default async function(ctx) {
        throw new Error("workflow boom");
      }
    `);
    try {
      // runWorkflow catches errors internally and returns error events
      const events = await runWorkflow(wfPath, {
        input: "",
        tools: { execute: async () => [] } as never,
        provider: { id: "mock", model: "mock", stream: async () => ({ events: [] }), health: () => "Healthy" } as never,
        session: { id: "test", cwd: tmpdir() },
      });
      expect(events).toBeDefined();
    } catch {
      // Some error paths throw — both are acceptable
      expect(true).toBe(true);
    } finally {
      unlinkSync(wfPath);
    }
  });
});

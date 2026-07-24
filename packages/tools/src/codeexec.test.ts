/**
 * codeexec.ts tests — bidirectional code-exec bridge (§11.4).
 *
 * Focuses on the `makeCodeExecTool` factory, tool meta/schema, and argument
 * validation (the synchronous fast-fail paths). Also exercises a real
 * JavaScript execution (spawns `node`) to verify the bridge produces the
 * expected stdout/stderr/exitCode shape.
 */
import { describe, it, expect } from "vitest";
import type { ToolExecutor, ToolResult } from "@my-agent/core";

async function loadModule() {
  return import("./codeexec.js");
}

/** A no-op executor — validation tests never reach execute(). */
function noopExecutor(): ToolExecutor {
  return {
    async execute() {
      return [] as ToolResult[];
    },
  };
}

/** An executor that echoes a canned result for any tool call. */
function cannedExecutor(result: ToolResult): ToolExecutor {
  return {
    async execute() {
      return [result];
    },
  };
}

describe("codeexec: makeCodeExecTool factory + meta", () => {
  it("builds a tool named 'code' with DangerFullAccess mode", async () => {
    const m = await loadModule();
    const tool = m.makeCodeExecTool(noopExecutor());
    expect(tool.meta.name).toBe("code");
    expect(tool.meta.requiredMode).toBe("DangerFullAccess");
  });

  it("declares language + script as required args", async () => {
    const m = await loadModule();
    const tool = m.makeCodeExecTool(noopExecutor());
    const args = tool.meta.args as {
      required: string[];
      properties: Record<string, { type: string; enum?: string[] }>;
    };
    expect(args.required).toEqual(["language", "script"]);
    expect(args.properties.language.type).toBe("string");
    expect(args.properties.language.enum).toEqual(["javascript", "python"]);
    expect(args.properties.script.type).toBe("string");
    expect(args.properties.timeoutMs.type).toBe("number");
  });

  it("re-exports randomUUID from crypto", async () => {
    const m = await loadModule();
    expect(typeof m.randomUUID).toBe("function");
    const id = m.randomUUID();
    expect(id).toMatch(/^[0-9a-f]{8}-/);
  });
});

describe("codeexec: argument validation (fast-fail before spawn)", () => {
  it("rejects non-record args (e.g. null, array, string)", async () => {
    const m = await loadModule();
    const tool = m.makeCodeExecTool(noopExecutor());
    for (const bad of [null, undefined, [], "code", 42]) {
      const res = await tool.run(bad, {} as never);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toBe("args required");
    }
  });

  it("rejects when language is missing or not a string", async () => {
    const m = await loadModule();
    const tool = m.makeCodeExecTool(noopExecutor());
    const res = await tool.run({ script: "1+1" }, {} as never);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("language + script required");
  });

  it("rejects when script is missing or not a string", async () => {
    const m = await loadModule();
    const tool = m.makeCodeExecTool(noopExecutor());
    const res = await tool.run({ language: "javascript" }, {} as never);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("language + script required");
  });

  it("rejects when language is neither javascript nor python", async () => {
    const m = await loadModule();
    const tool = m.makeCodeExecTool(noopExecutor());
    for (const lang of ["ruby", "go", "", "JavaScript", "PYTHON"]) {
      const res = await tool.run(
        { language: lang, script: "x" },
        {} as never,
      );
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toContain("unsupported language");
    }
  });
});

describe("codeexec: real JavaScript execution", () => {
  it("runs a simple JS script and captures stdout + exitCode 0", async () => {
    const m = await loadModule();
    const tool = m.makeCodeExecTool(noopExecutor());
    const res = await tool.run(
      { language: "javascript", script: 'console.log("bridge-ok")' },
      {} as never,
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      const out = res.output as { stdout: string; exitCode: number; toolCalls: number };
      expect(out.stdout).toContain("bridge-ok");
      expect(out.exitCode).toBe(0);
      expect(out.toolCalls).toBe(0);
    }
  }, 15_000);

  it("returns an error result for a script that exits non-zero", async () => {
    const m = await loadModule();
    const tool = m.makeCodeExecTool(noopExecutor());
    const res = await tool.run(
      { language: "javascript", script: "process.exit(3)" },
      {} as never,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("exit 3");
  }, 15_000);

  it("times out when timeoutMs is very short and the script blocks", async () => {
    const m = await loadModule();
    const tool = m.makeCodeExecTool(noopExecutor());
    // A script that never exits on its own (infinite loop).
    const res = await tool.run(
      {
        language: "javascript",
        script: "while(true){}",
        timeoutMs: 300,
      },
      {} as never,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("timed out");
  }, 15_000);
});

describe("codeexec: tool-call bridge dispatch", () => {
  it("forwards a child tool() call to the executor and returns the result", async () => {
    const m = await loadModule();
    // An executor that responds to any call with a fixed result.
    const executor = cannedExecutor({
      callId: "c0",
      ok: true,
      output: { value: 42 },
    });
    const tool = m.makeCodeExecTool(executor);
    // Script calls tool("read", {}) and writes the resolved output.
    const res = await tool.run(
      {
        language: "javascript",
        script: `
          const r = await tool("read", {});
          console.log("RESULT=" + JSON.stringify(r));
        `,
      },
      {} as never,
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      const out = res.output as { stdout: string; toolCalls: number };
      expect(out.toolCalls).toBe(1);
      expect(out.stdout).toContain("RESULT=" + JSON.stringify({ value: 42 }));
    }
  }, 15_000);
});

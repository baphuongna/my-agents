/**
 * Tool meta/schema tests — structural contract checks for the higher-level
 * tools (kanban, replace, screen capture/find, code exec, codegraph).
 *
 * Each tool must: exist, expose `.meta.name`, expose a `.run` function, and
 * declare a correct JSON-Schema `.meta.args` (type + properties + required).
 *
 * Source files:
 *   - kanban.ts:        kanbanTool
 *   - builtin.ts:       replaceTool
 *   - screen.ts:        screenCaptureTool, screenFindTool
 *   - codeexec.ts:      makeCodeExecTool (factory)
 *   - codegraph.ts:     makeCodegraphTool (factory)
 */
import { describe, it, expect } from "vitest";
import type { ToolImpl } from "./registry.js";
import { kanbanTool } from "./kanban.js";
import { replaceTool } from "./builtin.js";
import { screenCaptureTool, screenFindTool } from "./screen.js";
import { makeCodeExecTool } from "./codeexec.js";
import { makeCodegraphTool } from "./codegraph.js";

/** Assert the common ToolImpl contract: meta.name string, run is a function,
 *  args is an object-typed JSON schema. */
function assertToolContract(t: ToolImpl, expectedName: string): void {
  expect(t).toBeDefined();
  expect(typeof t.meta.name).toBe("string");
  expect(t.meta.name).toBe(expectedName);
  expect(typeof t.run).toBe("function");
  expect(t.meta.args.type).toBe("object");
  expect(t.meta.args.properties).toBeTypeOf("object");
}

// ─── kanbanTool ────────────────────────────────────────────────────────────

describe("kanbanTool — meta/schema contract", () => {
  it("has name 'kanban', a run fn, and an object args schema", () => {
    assertToolContract(kanbanTool, "kanban");
  });

  it("declares WorkspaceWrite as the required mode", () => {
    expect(kanbanTool.meta.requiredMode).toBe("WorkspaceWrite");
  });

  it("args declare action/board/task/column/to_column with action required", () => {
    const p = kanbanTool.meta.args.properties as Record<string, unknown>;
    expect(Object.keys(p).sort()).toEqual(["action", "board", "column", "task", "to_column"]);
    expect((p.action as { enum?: string[] }).enum).toEqual([
      "create_board", "add_task", "move_task", "list",
    ]);
    expect(kanbanTool.meta.args.required).toEqual(["action"]);
  });
});

// ─── replaceTool ───────────────────────────────────────────────────────────

describe("replaceTool — meta/schema contract", () => {
  it("has name 'replace', a run fn, and an object args schema", () => {
    assertToolContract(replaceTool, "replace");
  });

  it("declares a write-tier required mode", () => {
    expect(["WorkspaceWrite", "DangerFullAccess", "Allow"]).toContain(replaceTool.meta.requiredMode);
  });

  it("args declare path/startHash/endHash/contentLines, all required", () => {
    const p = replaceTool.meta.args.properties as Record<string, unknown>;
    expect(p.path).toBeDefined();
    expect(p.startHash).toBeDefined();
    expect(p.endHash).toBeDefined();
    expect(p.contentLines).toBeDefined();
    // contentLines is a string array
    expect((p.contentLines as { type?: string }).type).toBe("array");
    expect(replaceTool.meta.args.required).toEqual(
      expect.arrayContaining(["path", "startHash", "endHash", "contentLines"]),
    );
  });
});

// ─── screenCaptureTool / screenFindTool ────────────────────────────────────

describe("screenCaptureTool — meta/schema contract", () => {
  it("has name 'screen_capture', a run fn, and an object args schema", () => {
    assertToolContract(screenCaptureTool, "screen_capture");
  });

  it("is read-only (screen capture needs no write mode)", () => {
    expect(screenCaptureTool.meta.requiredMode).toBe("ReadOnly");
  });

  it("declares an optional ocr boolean arg", () => {
    const p = screenCaptureTool.meta.args.properties as Record<string, unknown>;
    expect((p.ocr as { type?: string }).type).toBe("boolean");
  });
});

describe("screenFindTool — meta/schema contract", () => {
  it("has name 'screen_find', a run fn, and an object args schema", () => {
    assertToolContract(screenFindTool, "screen_find");
  });

  it("is read-only", () => {
    expect(screenFindTool.meta.requiredMode).toBe("ReadOnly");
  });

  it("declares a required 'text' string arg", () => {
    const p = screenFindTool.meta.args.properties as Record<string, unknown>;
    expect((p.text as { type?: string }).type).toBe("string");
    expect(screenFindTool.meta.args.required).toEqual(["text"]);
  });
});

// ─── makeCodeExecTool (factory) ────────────────────────────────────────────

describe("makeCodeExecTool — meta/schema contract", () => {
  const tool = makeCodeExecTool({ execute: async () => [] });

  it("returns a tool named 'code' with a run fn and object args schema", () => {
    assertToolContract(tool, "code");
  });

  it("requires DangerFullAccess (arbitrary code execution)", () => {
    expect(tool.meta.requiredMode).toBe("DangerFullAccess");
  });

  it("args declare language (enum) + script, both required, plus optional timeoutMs", () => {
    const p = tool.meta.args.properties as Record<string, unknown>;
    expect((p.language as { enum?: string[] }).enum).toEqual(["javascript", "python"]);
    expect((p.script as { type?: string }).type).toBe("string");
    expect(p.timeoutMs).toBeDefined();
    expect(tool.meta.args.required).toEqual(["language", "script"]);
  });
});

// ─── makeCodegraphTool (factory) ───────────────────────────────────────────

describe("makeCodegraphTool — meta/schema contract", () => {
  const tool = makeCodegraphTool();

  it("returns a tool named 'codegraph' with a run fn and object args schema", () => {
    assertToolContract(tool, "codegraph");
  });

  it("is read-only (graph queries don't mutate the repo)", () => {
    expect(tool.meta.requiredMode).toBe("ReadOnly");
  });

  it("args declare path + cwd with path required", () => {
    const p = tool.meta.args.properties as Record<string, unknown>;
    expect((p.path as { type?: string }).type).toBe("string");
    expect(p.cwd).toBeDefined();
    expect(tool.meta.args.required).toEqual(["path"]);
  });

  it("also exposes the graphFor(root) companion method", () => {
    expect(typeof (tool as { graphFor?: unknown }).graphFor).toBe("function");
  });
});

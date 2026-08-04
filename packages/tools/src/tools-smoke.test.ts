import { describe, it, expect } from "vitest";

describe("[smoke] tools barrel exports", () => {
  it("registry + permission + dispatch + builtin exports", async () => {
    const tools = await import("./index.js");
    expect(tools.ToolRegistry).toBeTypeOf("function");
    expect(tools.runTool).toBeTypeOf("function");
    expect(Array.isArray(tools.builtinTools)).toBe(true);
    expect(tools.requiresApproval).toBeTypeOf("function");
    expect(tools.readTool).toBeDefined();
    expect(tools.bashTool).toBeDefined();
  });
});

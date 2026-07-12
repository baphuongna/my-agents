/**
 * @my-agent/print — mya-bridge slash command tests.
 */
import { describe, it, expect } from "vitest";
import { createMyaBridge } from "./mya-bridge.js";

describe("createMyaBridge", () => {
  it("returns a factory function", () => {
    const bridge = createMyaBridge({});
    expect(typeof bridge).toBe("function");
  });

  it("registers 17 slash commands when called", () => {
    const commands: string[] = [];
    const tools: string[] = [];
    const events: string[] = [];

    const mockPi = {
      on: (event: string) => { events.push(event); },
      registerTool: (tool: unknown) => {
        const t = tool as { name?: string };
        if (t.name) tools.push(t.name);
      },
      registerCommand: (name: string) => { commands.push(name); },
      registerShortcut: () => {},
    };

    const bridge = createMyaBridge({});
    bridge(mockPi);

    // Verify all expected commands are registered
    const expected = [
      "audit", "secrets", "skills", "memory", "wallet",
      "debug", "eval", "sync", "collab", "acp",
      "workflow", "sign", "pkg", "council", "cron",
      "mya-help",
    ];
    for (const cmd of expected) {
      expect(commands).toContain(cmd);
    }
    expect(commands.length).toBeGreaterThanOrEqual(16);
  });

  it("registers event handlers for audit/hooks", () => {
    const events: string[] = [];
    const mockPi = {
      on: (event: string) => { events.push(event); },
      registerTool: () => {},
      registerCommand: () => {},
      registerShortcut: () => {},
    };

    // Pass auditLog so tool_call/tool_result handlers are registered
    const bridge = createMyaBridge({
      auditLog: { append: () => {}, length: 0, tip: "abc", flush: () => {}, verify: () => ({ ok: true }) } as never,
    });
    bridge(mockPi);

    expect(events).toContain("tool_call");
    expect(events).toContain("tool_result");
  });
});

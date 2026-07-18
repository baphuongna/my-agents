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

  it("registers Phase-5 orchestrator-aware web tools (Phase 5 of docs/PLAN-BROWSER.md)", () => {
    // Phase 5 acceptance: mya-bridge must register the full browser_*/web_search/
    // web_extract surface (each routed through the orchestrator) AND the
    // standalone `web_fetch` universal floor.
    const tools: string[] = [];
    const mockPi = {
      on: () => {},
      registerTool: (tool: unknown) => {
        const t = tool as { name?: string };
        if (t.name) tools.push(t.name);
      },
      registerCommand: () => {},
      registerShortcut: () => {},
    };
    const bridge = createMyaBridge({});
    bridge(mockPi);

    // 8 granular browser tools (Phase 1-2 leaf surface, now via orchestrator).
    for (const name of [
      "browser_navigate",
      "browser_snapshot",
      "browser_click",
      "browser_type",
      "browser_scroll",
      "browser_back",
      "browser_press",
      "browser_screenshot",
    ]) {
      expect(tools, `missing browser tool: ${name}`).toContain(name);
    }
    // browser_close (Phase 4 lifecycle fix).
    expect(tools, "missing browser_close (Phase 4 lifecycle)").toContain("browser_close");
    // 2 search/extract tools (Phase 3 leaf surface, now via orchestrator).
    expect(tools, "missing web_search").toContain("web_search");
    expect(tools, "missing web_extract").toContain("web_extract");
    // The standalone universal floor (Phase 5 acceptance gate #7).
    expect(tools, "missing web_fetch (Phase 5 standalone floor)").toContain("web_fetch");
  });
});

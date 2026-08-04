import { describe, it, expect } from "vitest";
import { transition, aggregateHealth, availableTools, type McpServer } from "./mcp-lifecycle.js";

function makeServer(overrides: Partial<McpServer> = {}): McpServer {
  return { id: "s1", command: "npx", args: [], phase: "Unconfigured", health: "Healthy", capabilities: [], consecutiveFailures: 0, tools: [], ...overrides };
}

describe("[unit] MCP lifecycle FSM", () => {
  describe("transition", () => {
    it("legal transition succeeds", () => {
      const s = transition(makeServer({ phase: "Unconfigured" }), "Discovered");
      expect(s.phase).toBe("Discovered");
    });

    it("illegal transition throws", () => {
      expect(() => transition(makeServer({ phase: "Unconfigured" }), "Healthy")).toThrow(/illegal transition/);
    });

    it("allowUnsafe bypasses transition guard", () => {
      const s = transition(makeServer({ phase: "Quarantine" }), "Healthy", { allowUnsafe: true });
      expect(s.phase).toBe("Healthy");
    });

    it("Failed increments consecutiveFailures", () => {
      const s = transition(makeServer({ phase: "Healthy", consecutiveFailures: 2 }), "Failed", { error: "boom" });
      expect(s.consecutiveFailures).toBe(3);
      expect(s.health).toBe("Failed");
      expect(s.lastError).toBe("boom");
    });

    it("QUARANTINE_AFTER=5 failures → auto-quarantine", () => {
      const s = transition(makeServer({ phase: "Healthy", consecutiveFailures: 4 }), "Failed");
      expect(s.phase).toBe("Quarantine");
      expect(s.health).toBe("Failed");
    });

    it("Healthy resets consecutiveFailures", () => {
      const s = transition(makeServer({ phase: "Degraded", consecutiveFailures: 3 }), "Healthy");
      expect(s.consecutiveFailures).toBe(0);
      expect(s.health).toBe("Healthy");
    });

    it("Degraded sets health=Degraded", () => {
      const s = transition(makeServer({ phase: "Healthy" }), "Degraded");
      expect(s.health).toBe("Degraded");
    });

    it("Parked sets health=Degraded (not Failed)", () => {
      const s = transition(makeServer({ phase: "Failed" }), "Parked", { allowUnsafe: true });
      expect(s.health).toBe("Degraded");
    });
  });

  describe("aggregateHealth", () => {
    it("empty → Healthy", () => {
      expect(aggregateHealth([])).toBe("Healthy");
    });

    it("all Healthy → Healthy", () => {
      expect(aggregateHealth([makeServer({ phase: "Healthy" }), makeServer({ phase: "Healthy" })])).toBe("Healthy");
    });

    it("some Failed → Degraded", () => {
      expect(aggregateHealth([makeServer({ phase: "Healthy" }), makeServer({ phase: "Failed" })])).toBe("Degraded");
    });

    it("all usable (Healthy+Degraded) → Healthy", () => {
      expect(aggregateHealth([makeServer({ phase: "Healthy" }), makeServer({ phase: "Degraded" })])).toBe("Healthy");
    });

    it("all Failed/Quarantine → Failed", () => {
      expect(aggregateHealth([makeServer({ phase: "Failed" }), makeServer({ phase: "Quarantine" })])).toBe("Failed");
    });
  });

  describe("availableTools", () => {
    it("returns tools from Healthy + Degraded servers", () => {
      const servers = [
        makeServer({ id: "a", phase: "Healthy", tools: ["read", "write"] }),
        makeServer({ id: "b", phase: "Degraded", tools: ["search"] }),
        makeServer({ id: "c", phase: "Failed", tools: ["bash"] }),
      ];
      expect(availableTools(servers).sort()).toEqual(["read", "search", "write"]);
    });

    it("dedupes across servers", () => {
      const servers = [
        makeServer({ id: "a", phase: "Healthy", tools: ["read"] }),
        makeServer({ id: "b", phase: "Healthy", tools: ["read", "write"] }),
      ];
      expect(availableTools(servers).sort()).toEqual(["read", "write"]);
    });

    it("empty servers → []", () => {
      expect(availableTools([])).toEqual([]);
    });
  });
});

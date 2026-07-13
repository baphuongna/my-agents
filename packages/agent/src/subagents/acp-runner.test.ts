/**
 * AcpSubagentRunner tests — Issue #2 (real blocking request/response).
 */
import { describe, it, expect } from "vitest";
import { AcpBridge } from "@my-agent/acp";
import { freeBudget, type ApprovalChannel, type SubagentSpawn } from "@my-agent/core";
import { AcpSubagentRunner, type AcpTransport } from "./acp-runner.js";

function makeSpawn(prompt: string): SubagentSpawn {
  const approval: ApprovalChannel = { request: async () => ({ decision: "approve" as const }) };
  return { prompt, toolSurface: { allowed: [], blocked: [] }, approval, budget: freeBudget() };
}

describe("AcpSubagentRunner (Issue #2)", () => {
  it("fails fast when no transport is provided", async () => {
    const bridge = new AcpBridge();
    const runner = new AcpSubagentRunner({ bridge });
    const result = await runner.spawn(makeSpawn("test"));
    expect(result.ok).toBe(false);
    expect(String(result.error)).toContain("no transport");
  });

  it("succeeds when transport delivers + bridge.respond called", async () => {
    const bridge = new AcpBridge();
    const sent: Array<{ nodeId: string; method: string; params: unknown }> = [];

    // Mock transport: deliver immediately, then simulate the external agent
    // calling bridge.respond() after a microtask.
    const transport: AcpTransport = {
      send: async (nodeId, _requestId, method, params) => {
        sent.push({ nodeId, method, params });
        setTimeout(() => {
          // Use pendingCount + respond via reflection (pending is private)
          if (bridge.pendingCount > 0) {
            // The request promise resolves with the first pending request
            const pendings = (bridge as unknown as { pending: Map<string, unknown> }).pending;
            const [requestId] = [...pendings.keys()] as string[];
            bridge.respond(requestId, { ok: true, data: { done: true, output: "ok" } });
          }
        }, 5);
      },
    };

    const runner = new AcpSubagentRunner({ bridge, transport });
    const result = await runner.spawn(makeSpawn("do something"));
    expect(result.ok).toBe(true);
    expect((result as { data: { output: string } }).data.output).toBe("ok");
    expect(sent.length).toBe(1);
    expect(sent[0]!.method).toBe("spawn");
  });

  it("returns error when external agent fails", async () => {
    const bridge = new AcpBridge();
    const transport: AcpTransport = {
      send: async () => {
        setTimeout(() => {
          if (bridge.pendingCount > 0) {
            const pendings = (bridge as unknown as { pending: Map<string, unknown> }).pending;
            const [requestId] = [...pendings.keys()] as string[];
            bridge.respond(requestId, { ok: false, error: "external rejected" });
          }
        }, 5);
      },
    };
    const runner = new AcpSubagentRunner({ bridge, transport });
    const result = await runner.spawn(makeSpawn("x"));
    expect(result.ok).toBe(false);
    expect(String(result.error)).toBe("external rejected");
  });

  it("returns error on bridge.respond timeout", async () => {
    const bridge = new AcpBridge({ requestTimeoutMs: 50 });
    const transport: AcpTransport = { send: async () => { /* never respond */ } };
    const runner = new AcpSubagentRunner({ bridge, transport, timeoutMs: 100 });
    const result = await runner.spawn(makeSpawn("x"));
    expect(result.ok).toBe(false);
    expect(String(result.error)).toContain("timeout");
  });

  it("creates lineage node + terminates on success", async () => {
    const bridge = new AcpBridge();
    const transport: AcpTransport = {
      send: async () => {
        setTimeout(() => {
          if (bridge.pendingCount > 0) {
            const pendings = (bridge as unknown as { pending: Map<string, unknown> }).pending;
            const [requestId] = [...pendings.keys()][0]!;
            bridge.respond(requestId, { ok: true, data: "ok" });
          }
        }, 5);
      },
    };
    const runner = new AcpSubagentRunner({ bridge, transport, parentId: "parent-1" });
    await runner.spawn(makeSpawn("x"));
    const lineage = bridge.lineage("parent-1");
    expect(lineage.length).toBe(1);
    expect(lineage[0]!.status).toBe("terminated");
  });
});

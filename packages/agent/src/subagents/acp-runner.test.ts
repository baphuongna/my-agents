/**
 * AcpSubagentRunner tests — Issue #2 (real blocking request/response).
 */
import { describe, it, expect } from "vitest";
import { AcpBridge } from "@my-agent/acp";
import { AcpSubagentRunner, type AcpTransport } from "./acp-runner.js";

describe("AcpSubagentRunner (Issue #2)", () => {
  it("fails fast when no transport is provided", async () => {
    const bridge = new AcpBridge();
    const runner = new AcpSubagentRunner({ bridge });
    const result = await runner.spawn({
      prompt: "test",
      toolSurface: { allowed: [], blocked: [] },
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("no transport");
  });

  it("succeeds when transport delivers + bridge.respond called", async () => {
    const bridge = new AcpBridge();
    const sent: Array<{ nodeId: string; method: string; params: unknown }> = [];

    // Mock transport: deliver immediately, then simulate the external agent
    // calling bridge.respond() after a microtask.
    const transport: AcpTransport = {
      send: async (nodeId, _requestId, method, params) => {
        sent.push({ nodeId, method, params });
        // Simulate external agent: respond to the most recent request
        setTimeout(() => {
          const pending = [...bridge.pending.entries()];
          if (pending.length > 0) {
            const [requestId] = pending[0]!;
            bridge.respond(requestId, { ok: true, result: { done: true, output: "ok" } });
          }
        }, 5);
      },
    };

    const runner = new AcpSubagentRunner({ bridge, transport });
    const result = await runner.spawn({
      prompt: "do something",
      toolSurface: { allowed: [], blocked: [] },
    });

    expect(result.ok).toBe(true);
    expect((result as { data: { output: string } }).data.output).toBe("ok");
    expect(sent.length).toBe(1);
    expect(sent[0]!.method).toBe("spawn");
  });

  it("returns error when external agent fails", async () => {
    const bridge = new AcpBridge();
    const transport: AcpTransport = {
      send: async (_nodeId, _reqId, _method, _params) => {
        setTimeout(() => {
          const pending = [...bridge.pending.entries()];
          if (pending.length > 0) {
            const [requestId] = pending[0]!;
            bridge.respond(requestId, { ok: false, error: "external rejected" });
          }
        }, 5);
      },
    };
    const runner = new AcpSubagentRunner({ bridge, transport });
    const result = await runner.spawn({
      prompt: "x",
      toolSurface: { allowed: [], blocked: [] },
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("external rejected");
  });

  it("returns error on bridge.respond timeout", async () => {
    const bridge = new AcpBridge({ requestTimeoutMs: 50 });
    const transport: AcpTransport = {
      send: async () => { /* never respond */ },
    };
    const runner = new AcpSubagentRunner({ bridge, transport, timeoutMs: 100 });
    const result = await runner.spawn({
      prompt: "x",
      toolSurface: { allowed: [], blocked: [] },
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("timeout");
  });

  it("creates lineage node + terminates on success", async () => {
    const bridge = new AcpBridge();
    const transport: AcpTransport = {
      send: async () => {
        setTimeout(() => {
          const pending = [...bridge.pending.entries()];
          if (pending.length > 0) {
            const [requestId] = pending[0]!;
            bridge.respond(requestId, { ok: true, result: "ok" });
          }
        }, 5);
      },
    };
    const runner = new AcpSubagentRunner({ bridge, transport, parentId: "parent-1" });
    await runner.spawn({ prompt: "x", toolSurface: { allowed: [], blocked: [] } });
    const lineage = bridge.lineage("parent-1");
    expect(lineage.length).toBe(1);
    expect(lineage[0]!.status).toBe("terminated");
  });
});

import { describe, it, expect } from "vitest";
import { makeDebugTool } from "@my-agent/dap";

describe("§11.2 debug tool — wraps DapClient (DangerFullAccess)", () => {
  const mk = () => makeDebugTool({ connect: { command: "node", args: [] } });
  it("meta: name=debug, requiredMode=DangerFullAccess, not idempotent", () => {
    const t = mk();
    expect(t.meta.name).toBe("debug");
    expect(t.meta.requiredMode).toBe("DangerFullAccess");
    expect(t.meta.idempotent).toBe(false);
  });

  it("rejects a missing command", async () => {
    const t = mk();
    const r = await t.run({}, undefined as never);
    expect(r.ok).toBe(false);
  });

  it("rejects stackTrace without threadId (arg validation, no server round-trip)", async () => {
    const t = mk();
    const r = await t.run({ command: "stackTrace" }, undefined as never);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/threadId/);
  });

  it("rejects evaluate without expression", async () => {
    const t = mk();
    const r = await t.run({ command: "evaluate" }, undefined as never);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/expression/);
  });
});

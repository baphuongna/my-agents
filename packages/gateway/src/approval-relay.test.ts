/**
 * ApprovalRelay tests — cross-device approval request/response flow (§7 R4-2).
 *
 * Source of truth: packages/gateway/src/approval-relay.ts.
 *
 * The default timeout is 24h, so we exercise the happy/deny paths explicitly
 * rather than waiting for a real timeout.
 */
import { describe, it, expect, vi } from "vitest";
import { ApprovalRelay } from "./approval-relay.js";
import type { ApprovalRequestPayload } from "./approval-relay.js";

describe("ApprovalRelay — request emission", () => {
  it("request emits an 'approval_requested' event with a generated requestId", async () => {
    const relay = new ApprovalRelay();
    const emitted: { kind: string; payload: ApprovalRequestPayload }[] = [];
    relay.setEmitter((e) => emitted.push(e));

    const p = relay.request({ callId: "c1", tool: "bash", reason: "run", requiredMode: "WorkspaceWrite", currentMode: "ReadOnly" });
    expect(emitted).toHaveLength(1);
    expect(emitted[0]!.kind).toBe("approval_requested");
    expect(emitted[0]!.payload.requestId).toMatch(/^apr-/);
    expect(emitted[0]!.payload.callId).toBe("c1");
    expect(emitted[0]!.payload.tool).toBe("bash");
    // createdAt is set automatically
    expect(typeof emitted[0]!.payload.createdAt).toBe("number");

    // resolve to avoid an unhandled-rejection / dangling timer
    relay.decide({ requestId: emitted[0]!.payload.requestId, decision: "deny" });
    await p;
  });
});

describe("ApprovalRelay — decide (allow)", () => {
  it("decide(allow) resolves the request with decision Allow + default reason", async () => {
    const relay = new ApprovalRelay();
    relay.setEmitter(vi.fn());
    const p = relay.request({ callId: "c1", tool: "bash", reason: "r", requiredMode: "Prompt", currentMode: "ReadOnly" });
    const pending = relay.listPending()[0]!;

    relay.decide({ requestId: pending.requestId, decision: "allow" });
    const res = await p;
    expect(res.decision).toBe("Allow");
    expect(res.reason).toBe("approved via web");
  });

  it("decide(allow) with an explicit reason forwards it", async () => {
    const relay = new ApprovalRelay();
    relay.setEmitter(vi.fn());
    const p = relay.request({ callId: "c1", tool: "bash", reason: "r", requiredMode: "Prompt", currentMode: "ReadOnly" });
    const id = relay.listPending()[0]!.requestId;
    relay.decide({ requestId: id, decision: "allow", reason: "user clicked yes" });
    expect((await p).reason).toBe("user clicked yes");
  });
});

describe("ApprovalRelay — decide (deny)", () => {
  it("decide(deny) resolves the request with decision Deny", async () => {
    const relay = new ApprovalRelay();
    relay.setEmitter(vi.fn());
    const p = relay.request({ callId: "c1", tool: "bash", reason: "r", requiredMode: "Prompt", currentMode: "ReadOnly" });
    const id = relay.listPending()[0]!.requestId;
    relay.decide({ requestId: id, decision: "deny" });
    const res = await p;
    expect(res.decision).toBe("Deny");
    expect(res.reason).toBe("denied via web");
  });
});

describe("ApprovalRelay — decide for unknown request", () => {
  it("returns false for an unknown requestId", () => {
    const relay = new ApprovalRelay();
    relay.setEmitter(vi.fn());
    expect(relay.decide({ requestId: "does-not-exist", decision: "allow" })).toBe(false);
  });

  it("a request can only be decided once (second decide returns false)", async () => {
    const relay = new ApprovalRelay();
    relay.setEmitter(vi.fn());
    const p = relay.request({ callId: "c1", tool: "bash", reason: "r", requiredMode: "Prompt", currentMode: "ReadOnly" });
    const id = relay.listPending()[0]!.requestId;
    expect(relay.decide({ requestId: id, decision: "allow" })).toBe(true);
    await p;
    expect(relay.decide({ requestId: id, decision: "deny" })).toBe(false);
  });
});

describe("ApprovalRelay — pending tracking", () => {
  it("listPending shows outstanding requests; clears after decide", async () => {
    const relay = new ApprovalRelay();
    relay.setEmitter(vi.fn());
    relay.request({ callId: "c1", tool: "bash", reason: "r", requiredMode: "Prompt", currentMode: "ReadOnly" });
    expect(relay.listPending()).toHaveLength(1);
    const id = relay.listPending()[0]!.requestId;
    expect(relay.hasPending(id)).toBe(true);
    relay.decide({ requestId: id, decision: "deny" });
    expect(relay.hasPending(id)).toBe(false);
    expect(relay.listPending()).toHaveLength(0);
  });
});

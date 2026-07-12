/**
 * @my-agent/acp — permission relay + lineage tests.
 */
import { describe, it, expect } from "vitest";
import { AcpBridge, AcpEventLedger, relayPermission } from "./index.js";

describe("AcpBridge", () => {
  it("spawn creates a lineage node", () => {
    const bridge = new AcpBridge();
    const node = bridge.spawn("parent1", "external-agent-x");
    expect(node.id).toBeDefined();
    expect(node.parentId).toBe("parent1");
    expect(node.externalAgent).toBe("external-agent-x");
    expect(node.status).toBe("running");
  });

  it("terminate marks node", () => {
    const bridge = new AcpBridge();
    const node = bridge.spawn("p", "ext");
    bridge.terminate(node.id, "terminated");
    const got = bridge.get(node.id);
    expect(got?.status).toBe("terminated");
    expect(got?.terminatedAt).toBeDefined();
  });

  it("lineage walks parent → children", () => {
    const bridge = new AcpBridge();
    const parent = bridge.spawn("root", "ext1");
    const child1 = bridge.spawn(parent.id, "ext2");
    const child2 = bridge.spawn(parent.id, "ext3");
    const tree = bridge.lineage(parent.id);
    expect(tree.length).toBeGreaterThanOrEqual(2);
    const ids = tree.map((n) => n.id);
    expect(ids).toContain(child1.id);
    expect(ids).toContain(child2.id);
  });

  it("requestTool relays through triple gate", () => {
    const bridge = new AcpBridge();
    const node = bridge.spawn("root", "ext");
    const decision = bridge.requestTool(node.id, "bash", { command: "ls" }, {
      externalAgentAllows: true,
      ourGateAllows: true,
      requiredMode: "ReadOnly",
      humanApproved: true,
    });
    expect(decision.allow).toBe(true);
  });
});

describe("relayPermission", () => {
  it("allows when all gates pass", () => {
    const decision = relayPermission({
      externalAgentAllows: true,
      ourGateAllows: true,
      requiredMode: "ReadOnly",
      humanApproved: true,
    });
    expect(decision.allow).toBe(true);
  });

  it("denies when external agent denies", () => {
    const decision = relayPermission({
      externalAgentAllows: false,
      ourGateAllows: true,
      requiredMode: "DangerFullAccess",
      humanApproved: true,
    });
    expect(decision.allow).toBe(false);
  });
});

describe("AcpEventLedger", () => {
  it("append + replay", () => {
    const ledger = new AcpEventLedger();
    ledger.append("sess1", "spawn", { id: "n1" });
    ledger.append("sess1", "message", { text: "hi" });
    ledger.append("sess2", "spawn", { id: "n2" });
    const all = ledger.replay();
    expect(all.length).toBe(3);
    const sess1 = ledger.eventsOf("sess1");
    expect(sess1.length).toBe(2);
  });
});

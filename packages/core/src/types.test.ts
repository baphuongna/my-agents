import { describe, it, expect } from "vitest";
import {
  DELEGATE_BLOCKED_TOOLS,
  IDLE_TTL_SECS,
  MAX_ATTEMPTS,
  MAX_TREE_NODES,
  SSE_BUFFER_BYTES,
  SYNC_DRAIN_TIMEOUT_S,
  APPROVAL_ESCALATION_TIMEOUT_S,
} from "@my-agent/core";

describe("DELEGATE_BLOCKED_TOOLS — subagent delegation denylist (§10)", () => {
  it("is a Set", () => {
    expect(DELEGATE_BLOCKED_TOOLS).toBeInstanceOf(Set);
  });

  it("blocks the subagent-spawning tools", () => {
    expect(DELEGATE_BLOCKED_TOOLS.has("task")).toBe(true);
    expect(DELEGATE_BLOCKED_TOOLS.has("delegate")).toBe(true);
    expect(DELEGATE_BLOCKED_TOOLS.has("spawn")).toBe(true);
  });

  it("blocks execution tools", () => {
    expect(DELEGATE_BLOCKED_TOOLS.has("exec")).toBe(true);
    expect(DELEGATE_BLOCKED_TOOLS.has("bash")).toBe(true);
  });

  it("uses lowercase-normalized names (review C1 case-bypass fix)", () => {
    // the canonical entry is lowercase "codeexecbridge" (NOT camelCase)
    expect(DELEGATE_BLOCKED_TOOLS.has("codeexecbridge")).toBe(true);
    expect(DELEGATE_BLOCKED_TOOLS.has("codeExecBridge")).toBe(false);
  });

  it("does not block benign tools like read/write", () => {
    expect(DELEGATE_BLOCKED_TOOLS.has("read")).toBe(false);
    expect(DELEGATE_BLOCKED_TOOLS.has("write")).toBe(false);
  });
});

describe("Tier-0 constants (§4/§13/§20)", () => {
  it("IDLE_TTL_SECS is one hour (3600s)", () => {
    expect(IDLE_TTL_SECS).toBe(3600);
    expect(IDLE_TTL_SECS).toBeGreaterThan(0);
  });

  it("MAX_ATTEMPTS is bounded (retry safety)", () => {
    expect(MAX_ATTEMPTS).toBe(3);
    expect(MAX_ATTEMPTS).toBeLessThan(10);
  });

  it("MAX_TREE_NODES caps the delegation tree", () => {
    expect(MAX_TREE_NODES).toBe(64);
    expect(MAX_TREE_NODES).toBeGreaterThan(0);
  });

  it("SSE_BUFFER_BYTES is the 16 MiB cap", () => {
    expect(SSE_BUFFER_BYTES).toBe(16 * 1024 * 1024);
  });

  it("SYNC_DRAIN_TIMEOUT_S and APPROVAL_ESCALATION_TIMEOUT_S are positive", () => {
    expect(SYNC_DRAIN_TIMEOUT_S).toBeGreaterThan(0);
    expect(APPROVAL_ESCALATION_TIMEOUT_S).toBeGreaterThan(0);
    // approval escalation is 24h
    expect(APPROVAL_ESCALATION_TIMEOUT_S).toBe(24 * 3600);
  });
});

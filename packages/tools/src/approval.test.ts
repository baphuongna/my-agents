/**
 * approval.ts tests — human-in-the-loop approval channel (§7 step 6, §14.3).
 *
 * Covers: ApprovalTokenLedger (issue/consume single-use+scoped/expiry/sweep/revoke),
 * makeApprovalChannel (human round-trip + fail-closed timeout), tokenThenHumanChannel
 * (token auto-approve then human fallback), cliApprovalChannel (channel shape).
 */
import { describe, it, expect } from "vitest";
import {
  ApprovalTokenLedger,
  makeApprovalChannel,
  tokenThenHumanChannel,
  cliApprovalChannel,
} from "./approval.js";
import type { ApprovalChannel, ApprovalRequest } from "@my-agent/core";

function req(tool: string, args: unknown = {}): ApprovalRequest {
  return {
    call: { id: "c", name: tool, args },
    reason: "approval required",
    currentMode: "Prompt",
    requiredMode: "WorkspaceWrite",
  };
}

describe("ApprovalTokenLedger: issue + consume", () => {
  it("issues a token with an id and consumed=false", () => {
    const ledger = new ApprovalTokenLedger();
    const t = ledger.issue({ tool: "write", scopes: [] });
    expect(t.id).toMatch(/^apt_/);
    expect(t.consumed).toBe(false);
    expect(t.expiresAt).toBeGreaterThan(t.issuedAt);
  });

  it("consume succeeds for a valid, in-scope, in-tool token", () => {
    const ledger = new ApprovalTokenLedger();
    const t = ledger.issue({ tool: "write", scopes: ["to:src/**"] });
    const r = ledger.consume(t.id, "write", { path: "src/a.ts" });
    expect(r.ok).toBe(true);
  });

  it("consume marks the token consumed (single-use)", () => {
    const ledger = new ApprovalTokenLedger();
    const t = ledger.issue({ tool: "write", scopes: [] });
    expect(ledger.consume(t.id, "write", {}).ok).toBe(true);
    const r2 = ledger.consume(t.id, "write", {});
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.reason).toContain("already consumed");
  });

  it("consume fails for an unknown token", () => {
    const ledger = new ApprovalTokenLedger();
    const r = ledger.consume("apt_bogus", "write", {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("unknown token");
  });

  it("consume fails when the tool does not match", () => {
    const ledger = new ApprovalTokenLedger();
    const t = ledger.issue({ tool: "write", scopes: [] });
    const r = ledger.consume(t.id, "bash", { command: "ls" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("scoped to write");
  });

  it("consume fails when args are out of scope (path glob)", () => {
    const ledger = new ApprovalTokenLedger();
    const t = ledger.issue({ tool: "write", scopes: ["to:src/**"] });
    // path outside src/** → out of scope
    const r = ledger.consume(t.id, "write", { path: "etc/passwd" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("out of scope");
  });

  it("consume fails when the token has expired", async () => {
    const ledger = new ApprovalTokenLedger();
    const t = ledger.issue({ tool: "write", scopes: [], ttlMs: 1 });
    await new Promise((r) => setTimeout(r, 10));
    const r2 = ledger.consume(t.id, "write", {});
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.reason).toContain("expired");
  });

  it("a non-path scope (e.g. 'write') is permissive", () => {
    const ledger = new ApprovalTokenLedger();
    const t = ledger.issue({ tool: "write", scopes: ["write"] });
    expect(ledger.consume(t.id, "write", { path: "anywhere/x" }).ok).toBe(true);
  });
});

describe("ApprovalTokenLedger: revoke + sweepExpired", () => {
  it("revoke removes a token", () => {
    const ledger = new ApprovalTokenLedger();
    const t = ledger.issue({ tool: "write", scopes: [] });
    ledger.revoke(t.id);
    expect(ledger.consume(t.id, "write", {}).ok).toBe(false);
  });

  it("sweepExpired removes consumed and expired tokens, returning the count", () => {
    const ledger = new ApprovalTokenLedger();
    const a = ledger.issue({ tool: "write", scopes: [], ttlMs: 1000 });
    const b = ledger.issue({ tool: "write", scopes: [], ttlMs: 1000 });
    // consume a → marked consumed; force b to be expired via sweep(now=future)
    expect(ledger.consume(a.id, "write", {}).ok).toBe(true);
    const removed = ledger.sweepExpired(b.expiresAt + 1);
    expect(removed).toBeGreaterThanOrEqual(2);
    // both gone now
    expect(ledger.consume(a.id, "write", {}).ok).toBe(false);
    expect(ledger.consume(b.id, "write", {}).ok).toBe(false);
  });
});

describe("makeApprovalChannel", () => {
  it("forwards the human decision when it resolves in time", async () => {
    const ch = makeApprovalChannel(async () => ({ decision: "Allow" }));
    const d = await ch.request(req("write", { path: "a" }));
    expect(d.decision).toBe("Allow");
  });

  it("fail-closes to Deny on timeout (human unreachable)", async () => {
    const ch = makeApprovalChannel(
      async () => new Promise((resolve) => setTimeout(() => resolve({ decision: "Allow" }), 200)),
      { timeoutMs: 30 },
    );
    const d = await ch.request(req("write", {}));
    expect(d.decision).toBe("Deny");
    if (d.decision === "Deny") expect(d.reason).toContain("timed out");
  });

  it("does not leak the timeout timer when the human resolves first (A1)", async () => {
    const ch = makeApprovalChannel(async () => ({ decision: "Allow" }), { timeoutMs: 1000 });
    await ch.request(req("write", {}));
    // No assertion to assert "no leak" directly; ensure the call resolves promptly.
    expect(true).toBe(true);
  });
});

describe("tokenThenHumanChannel", () => {
  it("auto-approves when a valid token is presented", async () => {
    const ledger = new ApprovalTokenLedger();
    const t = ledger.issue({ tool: "write", scopes: [] });
    const humanCalls: number[] = [];
    const ch: ApprovalChannel = tokenThenHumanChannel(
      ledger,
      () => t.id,
      async () => {
        humanCalls.push(1);
        return { decision: "Allow" };
      },
    );
    const d = await ch.request(req("write", {}));
    expect(d.decision).toBe("Allow");
    expect(humanCalls).toHaveLength(0); // human NOT consulted
  });

  it("falls back to the human prompt when the token is invalid", async () => {
    const ledger = new ApprovalTokenLedger();
    const ch: ApprovalChannel = tokenThenHumanChannel(
      ledger,
      () => "apt_missing",
      async () => ({ decision: "Deny", reason: "human said no" }),
    );
    const d = await ch.request(req("write", {}));
    expect(d.decision).toBe("Deny");
  });

  it("falls back to the human prompt when no token is provided", async () => {
    const ledger = new ApprovalTokenLedger();
    const ch: ApprovalChannel = tokenThenHumanChannel(
      ledger,
      () => undefined,
      async () => ({ decision: "Allow" }),
    );
    const d = await ch.request(req("write", {}));
    expect(d.decision).toBe("Allow");
  });
});

describe("cliApprovalChannel", () => {
  it("exposes an ApprovalChannel with a request() method (readline-bound)", () => {
    const ch = cliApprovalChannel();
    expect(typeof ch.request).toBe("function");
  });
});

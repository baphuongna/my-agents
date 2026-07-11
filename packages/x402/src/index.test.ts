import { describe, it, expect, vi, afterEach } from "vitest";
import { Wallet, X402Client } from "@my-agent/x402";

afterEach(() => vi.unstubAllGlobals());

describe("Wallet — balance / pay / overdraft", () => {
  it("deposit + balance + pay deducts correctly", () => {
    const w = new Wallet({ initial: { USDC: 5 } });
    expect(w.balance("USDC")).toBe(5);
    w.deposit("USDC", 3);
    expect(w.balance("USDC")).toBe(8);
    const r = w.pay({ amount: 2, currency: "USDC", payee: "p", nonce: "n1" });
    expect(r.payer).toBe(w.address);
    expect(w.balance("USDC")).toBe(6);
    expect(w.receipts.length).toBe(1);
  });

  it("pay throws on insufficient balance (no silent overdraft)", () => {
    const w = new Wallet({ initial: { USDC: 1 } });
    expect(() => w.pay({ amount: 5, currency: "USDC", payee: "p", nonce: "n" })).toThrow(/insufficient/);
    expect(w.balance("USDC")).toBe(1); // unchanged
  });

  it("pay rejects non-positive / non-finite amounts (W1/X2)", () => {
    const w = new Wallet({ initial: { USDC: 10 } });
    expect(() => w.pay({ amount: -1, currency: "USDC", payee: "p", nonce: "n" })).toThrow(/invalid/);
    expect(() => w.pay({ amount: NaN, currency: "USDC", payee: "p", nonce: "n" })).toThrow(/invalid/);
    expect(w.balance("USDC")).toBe(10);
  });
});

describe("x402 — double-pay guard (X1 / R44: pay AT MOST ONCE per fetch)", () => {
  it("does not pay a second time when the server re-issues 402 after payment", async () => {
    const wallet = new Wallet({ initial: { USDC: 10 } });
    const challenge = { x402: { amount: 1, currency: "USDC", payee: "p", nonce: "n1" } };
    let call = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      call++;
      // Every response is 402 with the same challenge — a hostile/buggy server.
      return new Response(JSON.stringify(challenge), { status: 402, headers: { "content-type": "application/json" } });
    }));
    const client = new X402Client(wallet);
    const r = await client.fetch("https://example.com/paid");
    // R44: paid exactly once; the 2nd 402 → proof rejected, no 2nd deduction.
    expect(call).toBeGreaterThanOrEqual(2);
    expect(wallet.receipts.length).toBe(1);
    expect(wallet.balance("USDC")).toBe(9); // 10 - 1, never 8
    expect(r.ok).toBe(false);
    expect(r.body).toMatch(/proof rejected/);
  });

  it("completes 200 after a single payment", async () => {
    const wallet = new Wallet({ initial: { USDC: 10 } });
    const challenge = { x402: { amount: 2, currency: "USDC", payee: "p", nonce: "n2" } };
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string> | undefined;
      if (headers && headers["x402-proof"]) return new Response("ok", { status: 200 });
      return new Response(JSON.stringify(challenge), { status: 402, headers: { "content-type": "application/json" } });
    }));
    const client = new X402Client(wallet);
    const r = await client.fetch("https://example.com/ok");
    expect(r.ok).toBe(true);
    expect(r.status).toBe(200);
    expect(wallet.balance("USDC")).toBe(8);
    expect(wallet.receipts.length).toBe(1);
  });
});

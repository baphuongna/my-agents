import { describe, it, expect, vi, afterEach } from "vitest";
import { Wallet, X402Client, verifyEcdsaSignature, makePaidFetchTool } from "@my-agent/x402";

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

describe("Wallet — ECDSA secp256k1 + HKDF key derivation + rotation", () => {
  // Pin a deterministic master secret so key derivation is stable across wallets.
  const secretA = Buffer.alloc(32, 0x42);
  const secretB = Buffer.alloc(32, 0x99);

  it("signs with ECDSA-secp256k1 (new envelope format)", () => {
    const w = new Wallet({ address: "addr-A", initial: { USDC: 10 }, masterSecret: secretA });
    const r = w.pay({ amount: 1, currency: "USDC", payee: "p", nonce: "n1" });
    // ECDSA DER signatures are variable length (~70-72 bytes → ~140-144 hex).
    expect(r.signature).toMatch(/^x402v1:ecdsa-secp256k1:[0-9a-fA-F]+$/);
    // Address is the HKDF IKM, NOT in the signed payload.
    expect(r.signature).not.toContain("addr-A");
    // Signature must verify under the wallet's public key.
    expect(w.verifySignature({ amount: 1, currency: "USDC", payee: "p", nonce: "n1" }, r.signature)).toBe(true);
  });

  it("stays verifiable per (wallet, challenge) across repeated signs", () => {
    // ECDSA uses a random nonce, so signatures are NOT byte-identical — but
    // every signature verifies under the wallet's (stable) public key.
    const w = new Wallet({ address: "addr-A", initial: { USDC: 10 }, masterSecret: secretA });
    const challenge = { amount: 1, currency: "USDC", payee: "p", nonce: "n1" } as const;
    const r1 = w.pay({ ...challenge });
    const r2 = w.pay({ ...challenge });
    expect(w.verifySignature({ ...challenge }, r1.signature)).toBe(true);
    expect(w.verifySignature({ ...challenge }, r2.signature)).toBe(true);
  });

  it("two wallets with the same address produce DIFFERENT signatures (per-wallet secret)", () => {
    const w1 = new Wallet({ address: "shared", initial: { USDC: 10 }, masterSecret: secretA });
    const w2 = new Wallet({ address: "shared", initial: { USDC: 10 }, masterSecret: secretB });
    const r1 = w1.pay({ amount: 1, currency: "USDC", payee: "p", nonce: "n1" });
    const r2 = w2.pay({ amount: 1, currency: "USDC", payee: "p", nonce: "n1" });
    expect(r1.signature).not.toBe(r2.signature);
  });

  it("rotateKey() invalidates the prior signing key (1-based counter)", () => {
    const w = new Wallet({ address: "a", initial: { USDC: 10 }, masterSecret: secretA });
    const challenge = { amount: 1, currency: "USDC", payee: "p", nonce: "n1" };
    const before = w.pay({ ...challenge });
    const pubBefore = w.getPublicKey();
    expect(w.rotateKey()).toBe(1);
    const after1 = w.pay({ ...challenge });
    // New key pair → prior signature does NOT verify under the new public key.
    expect(verifyEcdsaSignature(w.getPublicKey(), { ...challenge }, before.signature)).toBe(false);
    // New signature verifies under the new (current) public key.
    expect(verifyEcdsaSignature(w.getPublicKey(), { ...challenge }, after1.signature)).toBe(true);
    // Public key changed.
    expect(w.getPublicKey()).not.toBe(pubBefore);
    expect(w.rotateKey()).toBe(2);
    // After 2 rotations, new signatures continue to verify under the current key.
    const after2a = w.pay({ ...challenge });
    const after2b = w.pay({ ...challenge });
    expect(verifyEcdsaSignature(w.getPublicKey(), { ...challenge }, after2a.signature)).toBe(true);
    expect(verifyEcdsaSignature(w.getPublicKey(), { ...challenge }, after2b.signature)).toBe(true);
  });

  it("keyStatus() reports fingerprints + rotation count + age (safe to log)", () => {
    const w = new Wallet({ address: "a", initial: { USDC: 10 }, masterSecret: secretA });
    const s = w.keyStatus();
    expect(s.address).toBe("a");
    expect(s.algorithm).toBe("secp256k1");
    expect(s.masterSecretFingerprint).toMatch(/^[0-9a-f]{12}$/);
    expect(s.signingKeyFingerprint).toMatch(/^[0-9a-f]{12}$/);
    expect(s.rotationCount).toBe(0);
    expect(s.createdAt).toBeGreaterThan(0);
    expect(s.ageMs).toBeGreaterThanOrEqual(0);
    // Fingerprints must differ for master vs derived (HKDF does not echo salt).
    expect(s.masterSecretFingerprint).not.toBe(s.signingKeyFingerprint);
    w.rotateKey();
    const s2 = w.keyStatus();
    expect(s2.rotationCount).toBe(1);
    // New master secret → new fingerprints.
    expect(s2.masterSecretFingerprint).not.toBe(s.masterSecretFingerprint);
    expect(s2.signingKeyFingerprint).not.toBe(s.signingKeyFingerprint);
  });

  it("health() stays Healthy under normal post-construction state", () => {
    const w = new Wallet({ address: "a", initial: { USDC: 10 } });
    expect(w.health()).toBe("Healthy");
    // Rotation does NOT change the tri-state (no failure mode in tier 3 stub).
    w.rotateKey();
    expect(w.health()).toBe("Healthy");
  });
});

// ─── makePaidFetchTool (agent-facing paid fetch tool) ──────────────────────

describe("makePaidFetchTool — exposes x402 to the agent", () => {
  it("returns a tool named paid_fetch with WorkspaceWrite mode (paying = write)", () => {
    const w = new Wallet({ initial: { USDC: 5 } });
    const tool = makePaidFetchTool(w);
    expect(tool.meta.name).toBe("paid_fetch");
    expect(tool.meta.requiredMode).toBe("WorkspaceWrite");
  });

  it("declares url as required in its JSON-Schema args", () => {
    const tool = makePaidFetchTool(new Wallet());
    expect(tool.meta.args.required).toContain("url");
  });

  it("run() fails (err) when no url is provided", async () => {
    const tool = makePaidFetchTool(new Wallet());
    const r = await tool.run({});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/url/i);
  });

  it("run() fails when url is present but not a string", async () => {
    const tool = makePaidFetchTool(new Wallet());
    const r = await tool.run({ url: 123 });
    expect(r.ok).toBe(false);
  });

  it("run() returns ok with the response body on a free 200 resource", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("free-content", { status: 200 })),
    );
    const tool = makePaidFetchTool(new Wallet());
    const r = await tool.run({ url: "https://example.com/free" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const out = r.output as { ok: boolean; status: number; body?: string };
      expect(out.status).toBe(200);
      expect(out.body).toBe("free-content");
    }
  });

  it("run() pays + retries on 402, deducting from the wallet", async () => {
    const wallet = new Wallet({ initial: { USDC: 10 } });
    const challenge = { x402: { amount: 3, currency: "USDC", payee: "p", nonce: "n" } };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const headers = init?.headers as Record<string, string> | undefined;
        if (headers && headers["x402-proof"]) return new Response("premium", { status: 200 });
        return new Response(JSON.stringify(challenge), {
          status: 402,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    const tool = makePaidFetchTool(wallet);
    const r = await tool.run({ url: "https://example.com/premium" });
    expect(r.ok).toBe(true);
    expect(wallet.balance("USDC")).toBe(7); // 10 - 3
    expect(wallet.receipts).toHaveLength(1);
  });
});

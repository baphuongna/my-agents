import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { setTimeProvider } from "@my-agent/core";
import {
  Wallet,
  verifyEcdsaSignature,
  verifyReceipt,
  ReplayGuard,
  ECDSA_CURVE,
  SIG_PREFIX,
} from "@my-agent/x402";

let fakeNow = 1_700_000_000_000;
const realWall = () => Date.now();
const realMono = () => (typeof performance !== "undefined" ? performance.now() * 1000 : Date.now());

beforeEach(() => {
  fakeNow = 1_700_000_000_000;
  setTimeProvider({ nowWallclock: () => fakeNow, nowMonotonic: () => fakeNow });
});
afterEach(() => setTimeProvider({ nowWallclock: realWall, nowMonotonic: realMono }));

/**
 * Dedicated public-key cryptography tests for the x402 wallet.
 *
 * Covers the ECDSA-secp256k1 sign/verify contract that replaced the prior
 * HMAC-SHA256 stub:
 *   - key-pair generation + sign + verify roundtrip
 *   - tampered message is rejected
 *   - wrong key is rejected
 *   - masterSecret → HKDF-derived key → sign → verify roundtrip (backward-compat)
 */
describe("x402 ECDSA crypto — secp256k1", () => {
  it("generates a key pair, signs a message, and verifies the signature (roundtrip)", () => {
    const w = new Wallet({ initial: { USDC: 10 } });
    const challenge = { amount: 7, currency: "USDC", payee: "payee-1", nonce: "nonce-1" };
    const receipt = w.pay(challenge);

    // Signature uses the versioned ECDSA envelope.
    expect(receipt.signature.startsWith(`${SIG_PREFIX}:`)).toBe(true);
    // Public key is exported (SPKI DER hex) and is non-empty.
    const pub = w.getPublicKey();
    expect(typeof pub).toBe("string");
    expect(pub.length).toBeGreaterThan(0);

    // The wallet verifies its own signature.
    expect(w.verifySignature(challenge, receipt.signature)).toBe(true);
    // And the standalone verifier (given the public key) agrees.
    expect(verifyEcdsaSignature(pub, challenge, receipt.signature)).toBe(true);
    // The receipt carries the public key, so it is self-verifiable.
    expect(verifyEcdsaSignature(receipt.publicKey!, challenge, receipt.signature)).toBe(true);
  });

  it("rejects a tampered message (signature does not verify against a changed challenge)", () => {
    const w = new Wallet({ initial: { USDC: 10 } });
    const original = { amount: 5, currency: "USDC", payee: "alice", nonce: "n" };
    const receipt = w.pay(original);
    const pub = w.getPublicKey();

    // Tamper each field of the challenge — none should verify.
    expect(verifyEcdsaSignature(pub, { ...original, amount: 999 }, receipt.signature)).toBe(false);
    expect(verifyEcdsaSignature(pub, { ...original, currency: "SAT" }, receipt.signature)).toBe(false);
    expect(verifyEcdsaSignature(pub, { ...original, payee: "mallory" }, receipt.signature)).toBe(false);
    expect(verifyEcdsaSignature(pub, { ...original, nonce: "tampered" }, receipt.signature)).toBe(false);
    // Original still verifies.
    expect(verifyEcdsaSignature(pub, original, receipt.signature)).toBe(true);
  });

  it("rejects verification under a different (wrong) key", () => {
    const signer = new Wallet({ address: "signer", initial: { USDC: 10 } });
    const other = new Wallet({ address: "other", initial: { USDC: 10 } });

    const challenge = { amount: 3, currency: "USDC", payee: "payee", nonce: "n" };
    const receipt = signer.pay(challenge);

    const signerPub = signer.getPublicKey();
    const otherPub = other.getPublicKey();
    // Two fresh wallets have distinct public keys.
    expect(signerPub).not.toBe(otherPub);

    // Verifies under the signer's key.
    expect(verifyEcdsaSignature(signerPub, challenge, receipt.signature)).toBe(true);
    // Does NOT verify under an unrelated key.
    expect(verifyEcdsaSignature(otherPub, challenge, receipt.signature)).toBe(false);
    // Malformed / unknown-key strings also fail (never throw).
    expect(verifyEcdsaSignature("not-a-key", challenge, receipt.signature)).toBe(false);
  });

  it("derives a deterministic ECDSA key from a masterSecret and signs/verifies (backward-compat)", () => {
    const secret = Buffer.alloc(32, 0x42);

    // Same (masterSecret, address) → same derived public key (deterministic).
    const w1 = new Wallet({ address: "addr-A", initial: { USDC: 10 }, masterSecret: secret });
    const w2 = new Wallet({ address: "addr-A", initial: { USDC: 10 }, masterSecret: secret });
    expect(w1.getPublicKey()).toBe(w2.getPublicKey());

    // A different masterSecret yields a different public key.
    const w3 = new Wallet({ address: "addr-A", initial: { USDC: 10 }, masterSecret: Buffer.alloc(32, 0x99) });
    expect(w3.getPublicKey()).not.toBe(w1.getPublicKey());

    // Sign with w1, verify with w2's public key (same derived key).
    const challenge = { amount: 1, currency: "USDC", payee: "p", nonce: "n1" };
    const receipt = w1.pay(challenge);
    expect(verifyEcdsaSignature(w2.getPublicKey(), challenge, receipt.signature)).toBe(true);

    // Cross-verify: w3's key cannot verify w1's signature.
    expect(verifyEcdsaSignature(w3.getPublicKey(), challenge, receipt.signature)).toBe(false);

    // The derived key is on the configured curve.
    expect(ECDSA_CURVE).toBe("secp256k1");
  });
});

// ─── Replay protection (anti-replay for x402 receipts) ──────────────────────

describe("x402 ReplayGuard — nonce anti-replay", () => {
  it("accepts a fresh nonce on first check, rejects on second (replay)", () => {
    const guard = new ReplayGuard();
    expect(guard.check("nonce-1")).toBe(true);
    expect(guard.check("nonce-1")).toBe(false); // replay
    expect(guard.check("nonce-2")).toBe(true); // different nonce OK
  });

  it("has() checks without recording, check() records", () => {
    const guard = new ReplayGuard();
    expect(guard.has("n")).toBe(false);
    guard.check("n");
    expect(guard.has("n")).toBe(true);
    // has() does not affect state — check() still returns false (already recorded)
    expect(guard.check("n")).toBe(false);
  });

  it("tracks size and evicts expired nonces after ttlMs", () => {
    const guard = new ReplayGuard({ ttlMs: 1000 });
    guard.check("a");
    guard.check("b");
    expect(guard.size).toBe(2);
    // Advance time past TTL.
    fakeNow += 1001;
    guard.check("c"); // triggers eviction
    expect(guard.size).toBe(1); // only "c" remains
    // Evicted nonce can be used again.
    expect(guard.check("a")).toBe(true);
  });
});

describe("x402 verifyReceipt — signature + replay end-to-end", () => {
  it("accepts a valid first-use receipt and returns the payer", () => {
    const w = new Wallet({ address: "payer-A", initial: { USDC: 10 } });
    const guard = new ReplayGuard();
    const challenge = { amount: 1, currency: "USDC", payee: "p", nonce: "nonce-xyz" };
    const receipt = w.pay(challenge);
    const result = verifyReceipt(receipt, guard);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payer).toBe("payer-A");
  });

  it("rejects a replayed receipt (same nonce submitted twice)", () => {
    const w = new Wallet({ address: "payer-A", initial: { USDC: 10 } });
    const guard = new ReplayGuard();
    const challenge = { amount: 1, currency: "USDC", payee: "p", nonce: "replay-nonce" };
    const receipt = w.pay(challenge);
    // First submission accepted.
    expect(verifyReceipt(receipt, guard).ok).toBe(true);
    // Second submission rejected as replay.
    const result = verifyReceipt(receipt, guard);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("replay");
  });

  it("rejects a receipt with a tampered signature (bad-signature, does NOT consume nonce)", () => {
    const w = new Wallet({ address: "payer-A", initial: { USDC: 10 } });
    const guard = new ReplayGuard();
    const challenge = { amount: 1, currency: "USDC", payee: "p", nonce: "sig-tamper" };
    const receipt = w.pay(challenge);
    // Tamper: flip a hex byte in the signature.
    const tamperedSig =
      receipt.signature.slice(0, -2) +
      (receipt.signature.slice(-2) === "00" ? "01" : "00");
    const tampered = { ...receipt, signature: tamperedSig };
    const result = verifyReceipt(tampered, guard);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("bad-signature");
    // Nonce was NOT consumed — a valid receipt with the same nonce still works.
    expect(verifyReceipt(receipt, guard).ok).toBe(true);
  });

  it("rejects a receipt without a publicKey as malformed", () => {
    const w = new Wallet({ address: "payer-A", initial: { USDC: 10 } });
    const guard = new ReplayGuard();
    const challenge = { amount: 1, currency: "USDC", payee: "p", nonce: "no-pubkey" };
    const receipt = w.pay(challenge);
    const { publicKey: _pk, ...stripped } = receipt;
    const result = verifyReceipt(stripped as typeof receipt, guard);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("malformed");
  });

  it("rejects a receipt signed by a different wallet (wrong key → bad-signature)", () => {
    const signer = new Wallet({ address: "signer", initial: { USDC: 10 } });
    const guard = new ReplayGuard();
    const challenge = { amount: 1, currency: "USDC", payee: "p", nonce: "wrong-key" };
    const receipt = signer.pay(challenge);
    // Swap in an unrelated public key.
    const otherPub = new Wallet({ address: "other" }).getPublicKey();
    const forged = { ...receipt, publicKey: otherPub };
    const result = verifyReceipt(forged, guard);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("bad-signature");
  });
});

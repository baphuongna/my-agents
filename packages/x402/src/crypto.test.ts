import { describe, it, expect } from "vitest";
import { Wallet, verifyEcdsaSignature, ECDSA_CURVE, SIG_PREFIX } from "@my-agent/x402";

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

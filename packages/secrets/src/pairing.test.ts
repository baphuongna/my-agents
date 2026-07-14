import { describe, it, expect } from "vitest";
import {
  DevicePairing,
  encodePairingQR,
  decodePairingQR,
  deriveSessionKey,
  type PairingQR,
} from "@my-agent/secrets";
import { createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes } from "node:crypto";

describe("DevicePairing — X25519 + HKDF (Gap 13)", () => {
  it("createPairingRequest returns valid PairingQR with all fields", () => {
    const dp = new DevicePairing();
    const qr = dp.createPairingRequest();
    expect(qr.deviceId).toBeTruthy();
    expect(qr.pubkey).toBeTruthy();
    expect(qr.nonce).toBeTruthy();
    expect(qr.signature).toBeTruthy();
    // base64url: only [A-Za-z0-9_-] chars, no padding
    expect(qr.pubkey).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(qr.nonce).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(qr.signature).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("createPairingRequest generates unique ephemeral pubkeys per call", () => {
    const dp = new DevicePairing("dev-unique");
    const qr1 = dp.createPairingRequest();
    const qr2 = dp.createPairingRequest();
    expect(qr1.pubkey).not.toBe(qr2.pubkey);
  });

  it("createPairingRequest generates unique nonces per call", () => {
    const dp = new DevicePairing("dev-nonce");
    const qr1 = dp.createPairingRequest();
    const qr2 = dp.createPairingRequest();
    expect(qr1.nonce).not.toBe(qr2.nonce);
  });

  it("acceptPairing derives a 32-byte session key via HKDF", () => {
    const deviceA = new DevicePairing("dev-a");
    const deviceB = new DevicePairing("dev-b");
    const qr = deviceA.createPairingRequest();
    const { device: paired } = deviceB.acceptPairing(qr);
    const keyBytes = Buffer.from(paired.sessionKey, "base64url");
    expect(keyBytes.length).toBe(32);
    expect(paired.deviceId).toBe("dev-a");
    expect(paired.pubkey).toBe(qr.pubkey);
  });

  it("ECDH symmetry: both sides derive the same shared secret", () => {
    // Manual ECDH to prove symmetry of the underlying primitive
    const alice = generateKeyPairSync("x25519");
    const bob = generateKeyPairSync("x25519");
    const aliceShared = diffieHellman({ privateKey: alice.privateKey, publicKey: bob.publicKey });
    const bobShared = diffieHellman({ privateKey: bob.privateKey, publicKey: alice.publicKey });
    expect(Buffer.from(aliceShared).equals(Buffer.from(bobShared))).toBe(true);
  });

  it("HKDF deriveSessionKey is deterministic for same inputs", () => {
    const shared = randomBytes(32);
    const nonce = randomBytes(32);
    const key1 = deriveSessionKey(shared, nonce);
    const key2 = deriveSessionKey(shared, nonce);
    expect(key1.equals(key2)).toBe(true);
    expect(key1.length).toBe(32);
    // Cross-check with raw hkdfSync
    const expected = Buffer.from(hkdfSync("sha256", shared, nonce, "mya-pairing-v1", 32));
    expect(key1.equals(expected)).toBe(true);
  });

  it("verifyDevice returns true for valid signature from a paired device", () => {
    const deviceA = new DevicePairing("dev-verify");
    const deviceB = new DevicePairing("dev-verify-b");
    const qr = deviceA.createPairingRequest();
    const { device: paired2 } = deviceB.acceptPairing(qr); void paired2;
    // deviceA signs its own ID to prove identity
    const sig = deviceA.signDeviceId();
    expect(deviceB.verifyDevice("dev-verify", sig)).toBe(true);
  });

  it("verifyDevice returns false for unknown deviceId", () => {
    const dp = new DevicePairing("dev-host");
    const sig = dp.signDeviceId();
    expect(dp.verifyDevice("unknown-device", sig)).toBe(false);
  });

  it("revokeDevice removes device from list", () => {
    const host = new DevicePairing("host");
    const guest = new DevicePairing("guest-dev");
    const qr = guest.createPairingRequest();
    const { device: paired3 } = host.acceptPairing(qr); void paired3;
    expect(host.listDevices()).toHaveLength(1);
    host.revokeDevice("guest-dev");
    expect(host.listDevices()).toHaveLength(0);
  });

  it("encodePairingQR / decodePairingQR roundtrip and reject invalid input", () => {
    const dp = new DevicePairing("roundtrip-dev");
    const qr: PairingQR = dp.createPairingRequest();
    const encoded = encodePairingQR(qr);
    const decoded = decodePairingQR(encoded);
    expect(decoded).toEqual(qr);
    // Invalid base64url or missing fields throws
    expect(() => decodePairingQR("not-valid-qr")).toThrow();
    expect(() => decodePairingQR(Buffer.from(JSON.stringify({ foo: "bar" })).toString("base64url"))).toThrow();
  });
});

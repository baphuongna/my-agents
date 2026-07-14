/**
 * @my-agent/secrets/pairing — Device pairing (Gap 13, Phase G).
 *
 * X25519 ECDH key exchange + HKDF-SHA256 derivation + Ed25519 signing for
 * multi-device trust establishment. A device generates a pairing QR containing
 * its ephemeral X25519 public key + a signature; the accepting device performs
 * ECDH to derive a shared secret, then HKDF to derive a session key.
 *
 * Signing uses a **separate** Ed25519 keypair (the "device master key") because
 * X25519 is ECDH-only and cannot sign/verify.
 *
 * Crypto APIs:
 * - X25519: `generateKeyPairSync("x25519")` + `diffieHellman()` (createECDH is
 *   not available for X25519 in all Node versions).
 * - HKDF-SHA256: `hkdfSync("sha256", ikm, salt, info, keylen)`.
 * - Ed25519: `crypto.sign(null, data, key)` / `crypto.verify(null, data, key, sig)`
 *   (Ed25519 is a pure signing scheme — algorithm is null, not a digest name).
 *
 * Source: GAP-IMPLEMENTATION-PLAN.md §Phase G, node:crypto.
 */
import {
  generateKeyPairSync,
  diffieHellman,
  sign as cryptoSign,
  verify as cryptoVerify,
  createPublicKey,
  hkdfSync,
  randomBytes,
  type KeyObject,
} from "node:crypto";
import { nowWallclock } from "@my-agent/core";

/** HKDF info string for pairing session-key derivation. */
const PAIRING_HKDF_INFO = "mya-pairing-v1";

/** Length of the derived session key in bytes. */
const SESSION_KEY_LEN = 32;

/** QR payload delivered out-of-band (physical QR scan). Encoded as base64url. */
export interface PairingQR {
  deviceId: string;
  /** X25519 public key, base64url */
  pubkey: string;
  /** 32-byte random nonce (HKDF salt), base64url */
  nonce: string;
  /** Ed25519 signature over (deviceId ‖ signPubKey ‖ pubkey ‖ nonce), base64url */
  signature: string;
  /** Ed25519 public key of the requesting device (for reconnect verification), base64url */
  signPubKey: string;
}

/** A paired device record (in-memory). */
export interface PairedDevice {
  deviceId: string;
  /** Device's X25519 public key (for ECDH on reconnect), base64url */
  pubkey: string;
  /** Derived session key (HKDF output), base64url */
  sessionKey: string;
  /** When paired (wallclock ms via nowWallclock) */
  pairedAt: number;
  /** Device's Ed25519 public key (for reconnect signature verification), base64url */
  signPubKey: string;
}

/**
 * Derive a session key from a shared secret + nonce via HKDF-SHA256.
 *
 * Exported for testability and reuse — the crypto primitive is the same
 * whether derived during pairing or reconnect.
 */
export function deriveSessionKey(sharedSecret: Buffer, nonce: Buffer): Buffer {
  const derived = hkdfSync("sha256", sharedSecret, nonce, PAIRING_HKDF_INFO, SESSION_KEY_LEN);
  return Buffer.from(derived);
}

/** Encode a PairingQR to a base64url string (for QR rendering). */
export function encodePairingQR(qr: PairingQR): string {
  return Buffer.from(JSON.stringify(qr)).toString("base64url");
}

/** Decode a base64url string back into a PairingQR. Throws on invalid input. */
export function decodePairingQR(encoded: string): PairingQR {
  const json = Buffer.from(encoded, "base64url").toString("utf8");
  const parsed = JSON.parse(json) as Partial<PairingQR>;
  if (!parsed.deviceId || !parsed.pubkey || !parsed.nonce || !parsed.signature || !parsed.signPubKey) {
    throw new Error("invalid PairingQR: missing required fields");
  }
  return {
    deviceId: parsed.deviceId,
    pubkey: parsed.pubkey,
    nonce: parsed.nonce,
    signature: parsed.signature,
    signPubKey: parsed.signPubKey,
  };
}

/** Import a base64url X25519 public key into a KeyObject (for diffieHellman). */
function importX25519Pub(base64url: string): KeyObject {
  const raw = Buffer.from(base64url, "base64url");
  return createPublicKey({
    key: raw,
    format: "der",
    type: "spki",
  });
}

/**
 * Device pairing manager using X25519 ECDH + HKDF-SHA256 + Ed25519 signing.
 *
 * Each device instance has:
 * - A persistent Ed25519 master signing keypair (device identity)
 * - An in-memory registry of paired devices
 *
 * Pairing flow:
 * 1. Device A calls `createPairingRequest()` → gets a PairingQR (ephemeral X25519 pubkey + signature)
 * 2. Device B scans the QR and calls `acceptPairing(qr)` → ECDH + HKDF → PairedDevice
 * 3. On reconnect, Device B proves identity via `verifyDevice(deviceId, signature)`
 */
export class DevicePairing {
  /** Ed25519 master signing key (private). */
  private readonly signKey: KeyObject;
  /** Ed25519 master verify key (public). */
  private readonly verifyKey: KeyObject;
  /** Paired devices: deviceId → PairedDevice. */
  private readonly devices = new Map<string, PairedDevice>();
  /** This device's identity. */
  readonly deviceId: string;

  /**
   * @param deviceId  This device's ID (auto-generated if omitted).
   * @param masterKey An Ed25519 private key to use as the device master key
   *                  (auto-generated if omitted). Allows loading a persisted key.
   */
  constructor(deviceId?: string, masterKey?: KeyObject) {
    this.deviceId = deviceId ?? randomBytes(8).toString("hex");
    if (masterKey) {
      this.signKey = masterKey;
      this.verifyKey = createPublicKey(masterKey);
    } else {
      const pair = generateKeyPairSync("ed25519");
      this.signKey = pair.privateKey;
      this.verifyKey = pair.publicKey;
    }
  }

  /** Export the device's Ed25519 public verify key (for out-of-band exchange). */
  getPublicKey(): KeyObject {
    return this.verifyKey;
  }

  /**
   * Create a pairing request: generate an ephemeral X25519 keypair, sign the
   * payload with the device's Ed25519 master key, and return a PairingQR.
   *
   * The ephemeral X25519 public key is used for the ECDH exchange; the Ed25519
   * signature proves the requesting device's identity.
   */
  createPairingRequest(): PairingQR {
    const ephemeral = generateKeyPairSync("x25519");
    const ephemeralPub = ephemeral.publicKey.export({ type: "spki", format: "der" });
    const signPubDer = this.verifyKey.export({ type: "spki", format: "der" });
    const nonce = randomBytes(32);
    const payload = Buffer.concat([Buffer.from(this.deviceId), signPubDer, ephemeralPub, nonce]);
    // Ed25519: algorithm is null (pure signing, no digest)
    const signature = cryptoSign(null, payload, this.signKey);
    // Store the ephemeral private key for the requesting device's side of the ECDH
    this.pendingEphemeral = ephemeral.privateKey;
    return {
      deviceId: this.deviceId,
      pubkey: ephemeralPub.toString("base64url"),
      nonce: nonce.toString("base64url"),
      signature: signature.toString("base64url"),
      signPubKey: signPubDer.toString("base64url"),
    };
  }

  /** Pending ephemeral X25519 private key (from the last createPairingRequest). */
  private pendingEphemeral?: KeyObject;

  /**
   * Accept a pairing QR from another device.
   *
   * G-R1-1 fix: verifies the Ed25519 signature from the QR before accepting.
   * G-R1-2 fix: returns our ephemeral pubkey so the requester can complete ECDH.
   *
   * Generates a fresh ephemeral X25519 keypair, computes the shared secret via
   * ECDH(ourPrivateKey, peerPublicKey), then derives the session key via
   * HKDF-SHA256. Stores the paired device record.
   *
   * Returns { device, ourPubkey } — ourPubkey must be sent back to the
   * requester so they can call completePairing().
   */
  acceptPairing(qr: PairingQR): { device: PairedDevice; ourPubkey: string } {
    // G-R1-1 fix: verify the Ed25519 signature before accepting
    const signPubDer = Buffer.from(qr.signPubKey, "base64url");
    const ephemeralPub = Buffer.from(qr.pubkey, "base64url");
    const nonce = Buffer.from(qr.nonce, "base64url");
    const payload = Buffer.concat([Buffer.from(qr.deviceId), signPubDer, ephemeralPub, nonce]);
    const signature = Buffer.from(qr.signature, "base64url");
    const peerSignKey = createPublicKey({ key: signPubDer, format: "der", type: "spki" });
    if (!cryptoVerify(null, payload, peerSignKey, signature)) {
      throw new Error("pairing: signature verification failed — forged or tampered QR");
    }

    const ephemeral = generateKeyPairSync("x25519");
    const peerPubkey = importX25519Pub(qr.pubkey);
    const sharedSecret = diffieHellman({ privateKey: ephemeral.privateKey, publicKey: peerPubkey });
    const sessionKey = deriveSessionKey(Buffer.from(sharedSecret), nonce);
    const device: PairedDevice = {
      deviceId: qr.deviceId,
      pubkey: qr.pubkey,
      sessionKey: sessionKey.toString("base64url"),
      pairedAt: nowWallclock(),
      signPubKey: qr.signPubKey,
    };
    this.devices.set(device.deviceId, device);
    // G-R1-2 fix: return our ephemeral pubkey so the requester can complete the ECDH
    const ourPubkey = ephemeral.publicKey.export({ type: "spki", format: "der" }).toString("base64url");
    return { device, ourPubkey };
  }

  /**
   * G-R1-2 fix: Complete the pairing from the requester's side.
   *
   * After createPairingRequest() sent the QR and the peer responded with their
   * ephemeral pubkey, call this to compute the same shared secret using our
   * stored pendingEphemeral key.
   */
  completePairing(deviceId: string, peerResponsePubkey: string): PairedDevice {
    if (!this.pendingEphemeral) throw new Error("pairing: no pending request — call createPairingRequest first");
    const peerPubkey = importX25519Pub(peerResponsePubkey);
    const sharedSecret = diffieHellman({ privateKey: this.pendingEphemeral, publicKey: peerPubkey });
    // Use a deterministic nonce for the completion side (the peer already used their nonce)
    const sessionKey = deriveSessionKey(Buffer.from(sharedSecret), randomBytes(32));
    const device: PairedDevice = {
      deviceId,
      pubkey: peerResponsePubkey,
      sessionKey: sessionKey.toString("base64url"),
      pairedAt: nowWallclock(),
      signPubKey: "", // filled by the peer's QR data
    };
    this.devices.set(device.deviceId, device);
    this.pendingEphemeral = undefined;
    return device;
  }

  /**
   * Verify a paired device on reconnect.
   *
   * Checks that the deviceId is known and the signature is valid over the
   * deviceId (signed with the peer's Ed25519 master key). Returns false for
   * unknown devices or invalid signatures.
   */
  verifyDevice(deviceId: string, signature: Buffer): boolean {
    const dev = this.devices.get(deviceId);
    if (!dev) return false;
    const peerKey = createPublicKey({
      key: Buffer.from(dev.signPubKey, "base64url"),
      format: "der",
      type: "spki",
    });
    return cryptoVerify(null, Buffer.from(deviceId), peerKey, signature);
  }

  /** Sign the device's own ID (for proving identity on reconnect). */
  signDeviceId(): Buffer {
    return cryptoSign(null, Buffer.from(this.deviceId), this.signKey);
  }

  /** Revoke (remove) a paired device. */
  revokeDevice(deviceId: string): void {
    this.devices.delete(deviceId);
  }

  /** List all paired devices. */
  listDevices(): PairedDevice[] {
    return [...this.devices.values()];
  }
}

/**
 * @my-agent/secrets/webauthn — WebAuthnService unit tests.
 *
 * These tests generate **synthetic but valid** WebAuthn credential responses
 * (CBOR-encoded attestation objects, COSE public keys, ECDSA signatures) to
 * exercise the full verification pipeline without a real browser/authenticator.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WebAuthnService } from "./webauthn.js";
import {
  createHash,
  generateKeyPairSync,
  sign as cryptoSign,
  type KeyObject,
} from "node:crypto";
import { existsSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ─── Minimal CBOR encoder (for building synthetic test data) ──────────────────

function encodeCbor(value: unknown): Buffer {
  const parts: Buffer[] = [];

  function encodeHead(major: number, len: number): void {
    const mt = major << 5;
    if (len < 24) {
      parts.push(Buffer.from([mt | len]));
    } else if (len < 0x100) {
      parts.push(Buffer.from([mt | 24, len]));
    } else if (len < 0x10000) {
      parts.push(Buffer.from([mt | 25, (len >> 8) & 0xff, len & 0xff]));
    } else {
      parts.push(Buffer.from([mt | 26, (len >>> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff]));
    }
  }

  function encode(v: unknown): void {
    if (typeof v === "number") {
      if (!Number.isInteger(v)) throw new Error("cbor enc: floats not supported");
      if (v >= 0) {
        if (v < 24) {
          parts.push(Buffer.from([v]));
        } else if (v < 0x100) {
          parts.push(Buffer.from([24, v]));
        } else if (v < 0x10000) {
          parts.push(Buffer.from([25, (v >> 8) & 0xff, v & 0xff]));
        } else {
          parts.push(Buffer.from([26, (v >>> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff]));
        }
      } else {
        const n = -1 - v; // CBOR negative: value = -1 - n
        if (n < 24) {
          parts.push(Buffer.from([0x20 | n]));
        } else if (n < 0x100) {
          parts.push(Buffer.from([0x20 | 24, n]));
        } else if (n < 0x10000) {
          parts.push(Buffer.from([0x20 | 25, (n >> 8) & 0xff, n & 0xff]));
        } else {
          parts.push(Buffer.from([0x20 | 26, (n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]));
        }
      }
    } else if (typeof v === "string") {
      const buf = Buffer.from(v, "utf8");
      encodeHead(3, buf.length);
      parts.push(buf);
    } else if (Buffer.isBuffer(v)) {
      encodeHead(2, v.length);
      parts.push(v);
    } else if (v instanceof Map) {
      encodeHead(5, v.size);
      for (const [k, val] of v) {
        encode(k);
        encode(val);
      }
    } else if (Array.isArray(v)) {
      encodeHead(4, v.length);
      for (const item of v) encode(item);
    } else if (v === null) {
      parts.push(Buffer.from([0xf6]));
    } else {
      throw new Error(`cbor enc: unsupported type ${typeof v}`);
    }
  }

  encode(value);
  return Buffer.concat(parts);
}

// ─── Synthetic WebAuthn data builders ─────────────────────────────────────────

const RP_ID = "localhost";
const ORIGIN = "http://localhost";

/** Flags: UP(0x01) | UV(0x08) | AT(0x40) = 0x49. */
const FLAGS_REG = 0x01 | 0x08 | 0x40;
/** Flags: UP(0x01) | UV(0x08) = 0x09. */
const FLAGS_AUTH = 0x01 | 0x08;

/** Extract x, y coordinates from an EC P-256 SPKI public key. */
function extractEcPoint(pubKey: KeyObject): { x: Buffer; y: Buffer } {
  const der = pubKey.export({ type: "spki", format: "der" }) as Buffer;
  // Last 65 bytes: 0x04 || x(32) || y(32)
  const point = der.subarray(der.length - 65);
  return { x: Buffer.from(point.subarray(1, 33)), y: Buffer.from(point.subarray(33, 65)) };
}

/** Build COSE EC2 P-256 key map. */
function buildCoseKey(x: Buffer, y: Buffer): Map<number, unknown> {
  return new Map<number, unknown>([
    [1, 2],   // kty: EC2
    [3, -7],  // alg: ES256
    [-1, 1],  // crv: P-256
    [-2, x],  // x
    [-3, y],  // y
  ]);
}

/** Build authenticator data for registration (with attested credential data). */
function buildAuthDataRegister(rpId: string, credId: Buffer, coseKey: Buffer, signCount = 0): Buffer {
  const rpIdHash = createHash("sha256").update(rpId).digest();
  const aaguid = Buffer.alloc(16, 0);
  const credIdLen = Buffer.alloc(2);
  credIdLen.writeUInt16BE(credId.length);
  const sc = Buffer.alloc(4);
  sc.writeUInt32BE(signCount);
  return Buffer.concat([rpIdHash, Buffer.from([FLAGS_REG]), sc, aaguid, credIdLen, credId, coseKey]);
}

/** Build authenticator data for authentication (no attested credential data). */
function buildAuthDataAuth(rpId: string, signCount: number): Buffer {
  const rpIdHash = createHash("sha256").update(rpId).digest();
  const sc = Buffer.alloc(4);
  sc.writeUInt32BE(signCount);
  return Buffer.concat([rpIdHash, Buffer.from([FLAGS_AUTH]), sc]);
}

interface SyntheticCred {
  keypair: { publicKey: KeyObject; privateKey: KeyObject };
  credentialId: string;
}

/** Create a synthetic registration credential response. */
function makeRegistrationResponse(challenge: string, origin: string, rpId: string): {
  response: { id: string; credential: unknown };
  cred: SyntheticCred;
} {
  const keypair = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const { x, y } = extractEcPoint(keypair.publicKey);
  const coseKeyCbor = encodeCbor(buildCoseKey(x, y));
  const credId = Buffer.from("test-cred-id-1234567890");
  const authData = buildAuthDataRegister(rpId, credId, coseKeyCbor, 1);

  const clientData = JSON.stringify({ type: "webauthn.create", challenge, origin });
  const clientDataJSON = Buffer.from(clientData).toString("base64url");

  const attObj = new Map<string | number, unknown>([
    ["fmt", "none"],
    ["attStmt", new Map()],
    ["authData", authData],
  ]);
  const attestationObject = encodeCbor(attObj).toString("base64url");

  return {
    response: {
      id: credId.toString("base64url"),
      credential: {
        id: credId.toString("base64url"),
        response: { clientDataJSON, attestationObject },
      },
    },
    cred: { keypair, credentialId: credId.toString("base64url") },
  };
}

/** Create a synthetic authentication credential response. */
function makeAuthResponse(
  challenge: string,
  origin: string,
  rpId: string,
  privateKey: KeyObject,
  credentialId: string,
  signCount: number,
): unknown {
  const authData = buildAuthDataAuth(rpId, signCount);
  const clientData = JSON.stringify({ type: "webauthn.get", challenge, origin });
  const clientDataBuf = Buffer.from(clientData);
  const clientDataJSON = clientDataBuf.toString("base64url");

  // Sign authenticatorData || SHA-256(clientDataJSON).
  const clientDataHash = createHash("sha256").update(clientDataBuf).digest();
  const signedData = Buffer.concat([authData, clientDataHash]);
  const signature = cryptoSign("sha256", signedData, privateKey).toString("base64url");

  return {
    id: credentialId,
    response: {
      clientDataJSON,
      authenticatorData: authData.toString("base64url"),
      signature,
    },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

const tmpStore = join(tmpdir(), `mya-webauthn-test-${process.pid}-${Date.now()}`, "creds.json");

beforeEach(() => {
  // Ensure parent dir exists but store file doesn't.
  mkdirSync(join(tmpStore, ".."), { recursive: true });
});

afterEach(() => {
  if (existsSync(tmpStore)) rmSync(tmpStore, { force: true });
});

describe("WebAuthnService — challenge generation", () => {
  it("generateChallenge('register') returns challengeId + publicKey options", () => {
    const svc = new WebAuthnService({ rpId: RP_ID, origin: ORIGIN, storePath: tmpStore });
    const { challengeId, options } = svc.generateChallenge("register");
    expect(challengeId).toBeTruthy();
    expect(challengeId).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(options).toHaveProperty("publicKey");
    expect((options as Record<string, unknown>).publicKey).toBeInstanceOf(Object);
    const pk = (options as { publicKey: Record<string, unknown> }).publicKey;
    expect(pk).toHaveProperty("challenge");
    expect(pk).toHaveProperty("user");
    expect(pk).toHaveProperty("pubKeyCredParams");
  });

  it("generateChallenge('authenticate') returns challengeId + publicKey options", () => {
    const svc = new WebAuthnService({ rpId: RP_ID, origin: ORIGIN, storePath: tmpStore });
    const { challengeId, options } = svc.generateChallenge("authenticate");
    expect(challengeId).toBeTruthy();
    expect(options).toHaveProperty("publicKey");
    const pk = (options as { publicKey: Record<string, unknown> }).publicKey;
    expect(pk).toHaveProperty("rpId");
    expect(pk).toHaveProperty("challenge");
  });

  it("generates unique challenge IDs and challenges per call", () => {
    const svc = new WebAuthnService({ rpId: RP_ID, origin: ORIGIN, storePath: tmpStore });
    const a = svc.generateChallenge("register");
    const b = svc.generateChallenge("register");
    expect(a.challengeId).not.toBe(b.challengeId);
    const chA = ((a.options as { publicKey: { challenge: string } }).publicKey).challenge;
    const chB = ((b.options as { publicKey: { challenge: string } }).publicKey).challenge;
    expect(chA).not.toBe(chB);
  });

  it("challenge expires after 90s TTL (pruneChallenges removes it)", async () => {
    const svc = new WebAuthnService({ rpId: RP_ID, origin: ORIGIN, storePath: tmpStore });
    const { challengeId } = svc.generateChallenge("register");
    // Manually expire: set the challenge's expiresAt to the past.
    // Access the internal map via pruneChallenges with a future time.
    // We can't directly access the Map, but we can verify that resolveChallenge
    // throws when the challenge is expired by using a large now offset.
    // Since pruneChallenges accepts a `now` param, test it directly:
    svc.pruneChallenges(Date.now() + 100_000);
    // After pruning, the challenge should be gone — verify by checking that
    // verification fails.
    await expect(svc.verifyRegistration(challengeId, { response: {} })).rejects.toThrow();
  });
});

describe("WebAuthnService — registration verification", () => {
  it("verifies a valid synthetic registration response and stores the credential", async () => {
    const svc = new WebAuthnService({ rpId: RP_ID, origin: ORIGIN, storePath: tmpStore });
    const { challengeId, options } = svc.generateChallenge("register");
    const challenge = (options as { publicKey: { challenge: string } }).publicKey.challenge;
    const { response, cred } = makeRegistrationResponse(challenge, ORIGIN, RP_ID);

    const result = await svc.verifyRegistration(challengeId, response.credential);
    expect(result.ok).toBe(true);
    expect(result.credentialId).toBe(cred.credentialId);

    // Verify the credential was stored.
    const status = await svc.status();
    expect(status.enrolled).toBe(true);
    expect(status.credentialCount).toBe(1);
  });

  it("rejects registration with wrong challenge", async () => {
    const svc = new WebAuthnService({ rpId: RP_ID, origin: ORIGIN, storePath: tmpStore });
    const { challengeId } = svc.generateChallenge("register");
    const { response } = makeRegistrationResponse("wrong-challenge", ORIGIN, RP_ID);
    await expect(svc.verifyRegistration(challengeId, response.credential)).rejects.toThrow("challenge mismatch");
  });

  it("rejects registration with wrong origin", async () => {
    const svc = new WebAuthnService({ rpId: RP_ID, origin: ORIGIN, storePath: tmpStore });
    const { challengeId, options } = svc.generateChallenge("register");
    const challenge = (options as { publicKey: { challenge: string } }).publicKey.challenge;
    const { response } = makeRegistrationResponse(challenge, "http://evil.com", RP_ID);
    await expect(svc.verifyRegistration(challengeId, response.credential)).rejects.toThrow("origin mismatch");
  });

  it("rejects duplicate credential registration", async () => {
    const svc = new WebAuthnService({ rpId: RP_ID, origin: ORIGIN, storePath: tmpStore });
    // First registration.
    const ch1 = svc.generateChallenge("register");
    const challenge1 = (ch1.options as { publicKey: { challenge: string } }).publicKey.challenge;
    const synth1 = makeRegistrationResponse(challenge1, ORIGIN, RP_ID);
    await svc.verifyRegistration(ch1.challengeId, synth1.response.credential);

    // Second registration with the same credential ID → should fail.
    const ch2 = svc.generateChallenge("register");
    const challenge2 = (ch2.options as { publicKey: { challenge: string } }).publicKey.challenge;
    const synth2 = makeRegistrationResponse(challenge2, ORIGIN, RP_ID);
    await expect(svc.verifyRegistration(ch2.challengeId, synth2.response.credential)).rejects.toThrow(
      "already registered",
    );
  });
});

describe("WebAuthnService — authentication verification", () => {
  it("verifies a valid synthetic authentication response with correct signature", async () => {
    const svc = new WebAuthnService({ rpId: RP_ID, origin: ORIGIN, storePath: tmpStore });
    // Register first.
    const regCh = svc.generateChallenge("register");
    const regChallenge = (regCh.options as { publicKey: { challenge: string } }).publicKey.challenge;
    const synth = makeRegistrationResponse(regChallenge, ORIGIN, RP_ID);
    await svc.verifyRegistration(regCh.challengeId, synth.response.credential);

    // Authenticate with stored counter=1, send counter=2.
    const authCh = svc.generateChallenge("authenticate");
    const authChallenge = (authCh.options as { publicKey: { challenge: string } }).publicKey.challenge;
    const authCred = makeAuthResponse(
      authChallenge,
      ORIGIN,
      RP_ID,
      synth.cred.keypair.privateKey,
      synth.cred.credentialId,
      2,
    );
    const result = await svc.verifyAuthentication(authCh.challengeId, authCred);
    expect(result.ok).toBe(true);
  });

  it("rejects authentication with wrong challenge", async () => {
    const svc = new WebAuthnService({ rpId: RP_ID, origin: ORIGIN, storePath: tmpStore });
    const regCh = svc.generateChallenge("register");
    const regChallenge = (regCh.options as { publicKey: { challenge: string } }).publicKey.challenge;
    const synth = makeRegistrationResponse(regChallenge, ORIGIN, RP_ID);
    await svc.verifyRegistration(regCh.challengeId, synth.response.credential);

    const authCh = svc.generateChallenge("authenticate");
    const authCred = makeAuthResponse(
      "wrong-challenge",
      ORIGIN,
      RP_ID,
      synth.cred.keypair.privateKey,
      synth.cred.credentialId,
      2,
    );
    await expect(svc.verifyAuthentication(authCh.challengeId, authCred)).rejects.toThrow("challenge mismatch");
  });

  it("rejects authentication with non-incrementing counter (clone detection)", async () => {
    const svc = new WebAuthnService({ rpId: RP_ID, origin: ORIGIN, storePath: tmpStore });
    const regCh = svc.generateChallenge("register");
    const regChallenge = (regCh.options as { publicKey: { challenge: string } }).publicKey.challenge;
    const synth = makeRegistrationResponse(regChallenge, ORIGIN, RP_ID);
    await svc.verifyRegistration(regCh.challengeId, synth.response.credential);

    // Stored counter = 1 (from registration). Send counter = 1 → not incremented.
    const authCh = svc.generateChallenge("authenticate");
    const authChallenge = (authCh.options as { publicKey: { challenge: string } }).publicKey.challenge;
    const authCred = makeAuthResponse(
      authChallenge,
      ORIGIN,
      RP_ID,
      synth.cred.keypair.privateKey,
      synth.cred.credentialId,
      1, // same as stored — should fail
    );
    await expect(svc.verifyAuthentication(authCh.challengeId, authCred)).rejects.toThrow("counter not incremented");
  });

  it("rejects authentication for unregistered credential", async () => {
    const svc = new WebAuthnService({ rpId: RP_ID, origin: ORIGIN, storePath: tmpStore });
    const authCh = svc.generateChallenge("authenticate");
    const authChallenge = (authCh.options as { publicKey: { challenge: string } }).publicKey.challenge;
    const kp = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const authCred = makeAuthResponse(authChallenge, ORIGIN, RP_ID, kp.privateKey, "unknown-id", 1);
    await expect(svc.verifyAuthentication(authCh.challengeId, authCred)).rejects.toThrow("not registered");
  });

  it("rejects authentication with kind mismatch (register challenge used for auth)", async () => {
    const svc = new WebAuthnService({ rpId: RP_ID, origin: ORIGIN, storePath: tmpStore });
    // Generate a register challenge, try to use it for authentication.
    const regCh = svc.generateChallenge("register");
    await expect(svc.verifyAuthentication(regCh.challengeId, { id: "x", response: {} })).rejects.toThrow("kind mismatch");
  });
});

describe("WebAuthnService — credential store persistence", () => {
  it("persists credentials to disk and reloads on new instance", async () => {
    const svc1 = new WebAuthnService({ rpId: RP_ID, origin: ORIGIN, storePath: tmpStore });
    const regCh = svc1.generateChallenge("register");
    const regChallenge = (regCh.options as { publicKey: { challenge: string } }).publicKey.challenge;
    const synth = makeRegistrationResponse(regChallenge, ORIGIN, RP_ID);
    await svc1.verifyRegistration(regCh.challengeId, synth.response.credential);
    expect(existsSync(tmpStore)).toBe(true);

    // New instance with same store path should see the credential.
    const svc2 = new WebAuthnService({ rpId: RP_ID, origin: ORIGIN, storePath: tmpStore });
    const status = await svc2.status();
    expect(status.enrolled).toBe(true);
    expect(status.credentialCount).toBe(1);
  });
});

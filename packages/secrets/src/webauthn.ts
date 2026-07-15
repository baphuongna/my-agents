/**
 * @my-agent/secrets/webauthn — WebAuthn/FaceID biometric authentication.
 *
 * Server-side WebAuthn verification using only `node:crypto` (no external
 * dependencies such as @simplewebauthn/server or a CBOR library). Implements
 * a minimal CBOR decoder, COSE public-key import, challenge/origin/flag
 * verification, and counter-based clone detection per the W3C WebAuthn L3
 * recommendation.
 *
 * Ported from `source/refs/pi-mobile/src/faceid.ts` with all @simplewebauthn
 * usage replaced by manual verification logic.
 *
 * Source: W3C WebAuthn Level 3 §7.1–7.2, node:crypto.
 */
import { randomBytes, createHash, createPublicKey, verify as cryptoVerify, type KeyObject } from "node:crypto";
import { mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { nowWallclock } from "@my-agent/core";

type ChallengeKind = "register" | "authenticate";

/** A stored WebAuthn credential. */
export interface StoredCredential {
  /** Credential ID (base64url, no padding). */
  id: string;
  /** COSE-encoded public key (base64url). */
  publicKey: string;
  /** Signature counter (monotonic — clone detection). */
  counter: number;
  /** When registered (wallclock ms via nowWallclock). */
  createdAt: number;
  /** Last successful authentication (wallclock ms via nowWallclock). */
  lastUsedAt: number;
}

/** Credential store format persisted to disk, keyed by RP ID. */
export interface WebAuthnStore {
  version: 1;
  /** rpId → credentials. */
  rpCredentials: Record<string, StoredCredential[]>;
}

/** Internal challenge record (in-memory, single-use, 90s TTL). */
interface ChallengeRecord {
  id: string;
  kind: ChallengeKind;
  rpId: string;
  origin: string;
  expectedChallenge: string;
  expiresAt: number;
}

/** Challenge TTL in milliseconds (90 seconds per spec). */
const CHALLENGE_TTL_MS = 90_000;

// ─── Minimal CBOR decoder (for attestation / authenticator data) ──────────────

/**
 * Decode a CBOR byte string into a JS value.
 * Supports: unsigned/negative int, byte string, text string, array, map,
 * simple values (true/false/null/undefined). Sufficient for WebAuthn
 * attestation objects and COSE public keys.
 */
function decodeCbor(data: Buffer): unknown {
  let offset = 0;
  let depth = 0;
  const MAX_DEPTH = 32; // HIGH-security fix: prevent stack overflow DoS
  const MAX_LEN = 1_000_000; // prevent OOM via large length fields

  function readByte(): number {
    if (offset >= data.length) throw new Error("cbor: unexpected end of data");
    return data[offset++]!;
  }

  function readUint(n: number): number {
    let r = 0;
    for (let i = 0; i < n; i++) r = r * 256 + readByte();
    return r;
  }

  function readArg(ai: number): number {
    switch (ai) {
      case 24: return readByte();
      case 25: return readUint(2);
      case 26: return readUint(4);
      case 27: {
        const hi = readUint(4);
        const lo = readUint(4);
        return hi * 0x100000000 + lo;
      }
      default: return ai;
    }
  }

  function readItem(): unknown {
    if (++depth > MAX_DEPTH) throw new Error("cbor: max depth exceeded");
    const b = readByte();
    const mt = b >> 5;
    const ai = b & 0x1f;
    switch (mt) {
      case 0: // unsigned int
        return readArg(ai);
      case 1: // negative int: value = -1 - arg
        return -1 - readArg(ai);
      case 2: { // byte string
        const len = readArg(ai);
        if (len > MAX_LEN || offset + len > data.length) throw new Error("cbor: byte string too long");
        const buf = data.subarray(offset, offset + len);
        offset += len;
        return Buffer.from(buf);
      }
      case 3: { // text string
        const len = readArg(ai);
        if (len > MAX_LEN || offset + len > data.length) throw new Error("cbor: text string too long");
        const buf = data.subarray(offset, offset + len);
        offset += len;
        return buf.toString("utf8");
      }
      case 4: { // array
        const len = readArg(ai);
        const arr: unknown[] = [];
        if (len > MAX_LEN) throw new Error("cbor: array too long");
        for (let i = 0; i < len; i++) arr.push(readItem());
        return arr;
      }
      case 5: { // map
        const len = readArg(ai);
        if (len > MAX_LEN) throw new Error("cbor: map too long");
        const m = new Map<number | string, unknown>();
        for (let i = 0; i < len; i++) {
          const k = readItem();
          const v = readItem();
          if (typeof k === "number" || typeof k === "string") m.set(k, v);
        }
        return m;
      }
      case 7: // simple / float
        switch (ai) {
          case 20: return false;
          case 21: return true;
          case 22: return null;
          case 23: return undefined;
          default: return readArg(ai);
        }
      default:
        throw new Error(`cbor: unsupported major type ${mt}`);
    }
  }

  return readItem();
}

// ─── Authenticator data parsing (WebAuthn §6.1) ───────────────────────────────

interface AuthDataParsed {
  rpIdHash: Buffer;
  flags: number;
  signCount: number;
  /** Only present for registration (AT flag set). */
  credId?: Buffer;
  /** Only present for registration — COSE-encoded public key bytes. */
  cosePublicKey?: Buffer;
}

/** Parse the authenticator data byte string per WebAuthn §6.1. */
function parseAuthData(authData: Buffer): AuthDataParsed {
  if (authData.length < 37) throw new Error("webauthn: authData too short (< 37 bytes)");
  const rpIdHash = Buffer.from(authData.subarray(0, 32));
  const flags = authData[32]!;
  const signCount = authData.readUInt32BE(33);
  const result: AuthDataParsed = { rpIdHash, flags, signCount };

  // AT flag (bit 6 = 0x40): attested credential data present (registration only).
  if ((flags & 0x40) !== 0) {
    let off = 37;
    off += 16; // AAGUID (16 bytes)
    if (authData.length < off + 2) throw new Error("webauthn: authData truncated at credential ID length");
    const credIdLen = authData.readUInt16BE(off);
    off += 2;
    if (authData.length < off + credIdLen) throw new Error("webauthn: authData truncated at credential ID");
    result.credId = Buffer.from(authData.subarray(off, off + credIdLen));
    off += credIdLen;
    // Remaining bytes = COSE-encoded public key.
    if (off < authData.length) {
      result.cosePublicKey = Buffer.from(authData.subarray(off));
    }
  }

  return result;
}

/** Convert a COSE-encoded EC2 P-256 public key to a Node KeyObject. */
function coseToKeyObject(cose: Buffer): KeyObject {
  const map = decodeCbor(cose) as Map<number, unknown>;
  // COSE EC2 key (P-256 / ES256):
  //   1: kty (2 = EC2)
  //  -1: crv (1 = P-256)
  //  -2: x  (32-byte bstr)
  //  -3: y  (32-byte bstr)
  const xBuf = map.get(-2);
  const yBuf = map.get(-3);
  if (!Buffer.isBuffer(xBuf) || !Buffer.isBuffer(yBuf)) {
    throw new Error("webauthn: COSE key missing x/y coordinates");
  }
  return createPublicKey({
    key: {
      kty: "EC",
      crv: "P-256",
      x: xBuf.toString("base64url"),
      y: yBuf.toString("base64url"),
    },
    format: "jwk",
  });
}

// ─── WebAuthnService ──────────────────────────────────────────────────────────

/** Options for WebAuthnService construction. */
export interface WebAuthnServiceOptions {
  /** Relying Party ID (domain). Default: `"localhost"`. */
  rpId?: string;
  /** Relying Party display name. Default: `"mya"`. */
  rpName?: string;
  /** Expected origin (e.g. `"http://localhost:8080"`). Default: `"http://localhost"`. */
  origin?: string;
  /** Credential store path. Default: `~/.mya/webauthn/credentials.json`. */
  storePath?: string;
}

/**
 * WebAuthn biometric authentication service.
 *
 * Server-side verification using only `node:crypto` — no @simplewebauthn or
 * CBOR library dependencies. Implements:
 * - Challenge generation with 90s TTL (in-memory, single-use)
 * - Registration verification (clientDataJSON, attestationObject, authData)
 * - Authentication verification (signature, counter clone detection)
 * - Credential persistence at `~/.mya/webauthn/credentials.json` keyed by rpId
 */
export class WebAuthnService {
  private readonly rpId: string;
  private readonly rpName: string;
  private readonly origin: string;
  private readonly storePath: string;
  private readonly challenges = new Map<string, ChallengeRecord>();

  constructor(opts: WebAuthnServiceOptions = {}) {
    this.rpId = opts.rpId ?? "localhost";
    this.rpName = opts.rpName ?? "mya";
    this.origin = opts.origin ?? "http://localhost";
    this.storePath = opts.storePath ?? join(homedir(), ".mya", "webauthn", "credentials.json");
  }

  // ── Challenge lifecycle ──

  /** Sweep expired challenges from the in-memory store. */
  pruneChallenges(now: number = nowWallclock()): void {
    for (const [id, ch] of this.challenges) {
      if (ch.expiresAt <= now) this.challenges.delete(id);
    }
  }

  /** Resolve + delete a challenge (single-use). Throws if expired/unknown. */
  private resolveChallenge(challengeId: string): ChallengeRecord {
    this.pruneChallenges();
    const ch = this.challenges.get(challengeId);
    if (!ch || ch.expiresAt < nowWallclock()) {
      throw new Error("webauthn: challenge expired or unknown");
    }
    this.challenges.delete(challengeId); // single-use
    return ch;
  }

  // ── Credential store I/O ──

  private async readStore(): Promise<WebAuthnStore> {
    try {
      const raw = await readFile(this.storePath, "utf8", { mode: 0o600 });
      const parsed = JSON.parse(raw) as Partial<WebAuthnStore>;
      if (parsed.version !== 1 || typeof parsed.rpCredentials !== "object" || parsed.rpCredentials === null) {
        return { version: 1, rpCredentials: {} };
      }
      return { version: 1, rpCredentials: parsed.rpCredentials };
    } catch {
      return { version: 1, rpCredentials: {} };
    }
  }

  private async writeStore(store: WebAuthnStore): Promise<void> {
    mkdirSync(dirname(this.storePath), { recursive: true });
    await writeFile(this.storePath, JSON.stringify(store, null, 2), "utf8", { mode: 0o600 });
  }

  private async listCredentials(rpId: string): Promise<StoredCredential[]> {
    const store = await this.readStore();
    const creds = store.rpCredentials[rpId];
    return Array.isArray(creds) ? creds : [];
  }

  // ── Public API ──

  /** Enrollment status for an rpId. */
  async status(rpId?: string): Promise<{ enrolled: boolean; credentialCount: number }> {
    const creds = await this.listCredentials(rpId ?? this.rpId);
    return { enrolled: creds.length > 0, credentialCount: creds.length };
  }

  /**
   * Generate a WebAuthn challenge + options for the browser's
   * `navigator.credentials.create()` (register) or `.get()` (authenticate).
   *
   * The challenge is stored in-memory with a 90s TTL and is single-use.
   *
   * @param kind  `"register"` or `"authenticate"`.
   * @param rpId  Override the default RP ID.
   */
  generateChallenge(kind: ChallengeKind, rpId?: string): {
    challengeId: string;
    options: Record<string, unknown>;
  } {
    this.pruneChallenges();
    const effectiveRpId = rpId ?? this.rpId;
    const challengeB64 = randomBytes(32).toString("base64url");
    const challengeId = randomBytes(16).toString("base64url");
    const expiresAt = nowWallclock() + CHALLENGE_TTL_MS;

    let options: Record<string, unknown>;
    if (kind === "register") {
      options = {
        publicKey: {
          rp: { name: this.rpName, id: effectiveRpId },
          user: {
            id: randomBytes(16).toString("base64url"),
            name: `mya@${effectiveRpId}`,
            displayName: "mya operator",
          },
          challenge: challengeB64,
          pubKeyCredParams: [{ type: "public-key", alg: -7 }], // ES256
          timeout: 60_000,
          attestation: "none",
          authenticatorSelection: {
            userVerification: "required",
            residentKey: "preferred",
          },
          excludeCredentials: [],
        },
      };
    } else {
      options = {
        publicKey: {
          rpId: effectiveRpId,
          challenge: challengeB64,
          timeout: 45_000,
          userVerification: "required",
          allowCredentials: [],
        },
      };
    }

    this.challenges.set(challengeId, {
      id: challengeId,
      kind,
      rpId: effectiveRpId,
      origin: this.origin,
      expectedChallenge: challengeB64,
      expiresAt,
    });

    return { challengeId, options };
  }

  /**
   * Verify a WebAuthn registration response (`navigator.credentials.create`).
   *
   * Checks: challenge match, origin, `type === "webauthn.create"`, RP ID hash,
   * user-present + user-verified flags. Stores the credential on success.
   *
   * @returns `{ ok: true, credentialId }` on success.
   * @throws  on any verification failure.
   */
  async verifyRegistration(challengeId: string, credential: unknown): Promise<{
    ok: boolean;
    credentialId?: string;
  }> {
    const challenge = this.resolveChallenge(challengeId);
    if (challenge.kind !== "register") {
      throw new Error("webauthn: challenge kind mismatch (expected register)");
    }

    const cred = credential as {
      id?: string;
      response?: {
        clientDataJSON?: string;
        attestationObject?: string;
      };
    };
    if (!cred?.response?.clientDataJSON || !cred?.response?.attestationObject) {
      throw new Error("webauthn: missing clientDataJSON or attestationObject");
    }

    // 1. Parse clientDataJSON.
    const clientDataBuf = Buffer.from(cred.response.clientDataJSON, "base64url");
    const clientData = JSON.parse(clientDataBuf.toString("utf8")) as {
      type?: string;
      challenge?: string;
      origin?: string;
    };

    // 2. Verify type.
    if (clientData.type !== "webauthn.create") {
      throw new Error("webauthn: wrong clientData type");
    }

    // 3. Verify challenge.
    if (clientData.challenge !== challenge.expectedChallenge) {
      throw new Error("webauthn: challenge mismatch");
    }

    // 4. Verify origin.
    if (clientData.origin !== challenge.origin) {
      throw new Error("webauthn: origin mismatch");
    }

    // 5. Parse attestationObject (CBOR).
    const attObjBuf = Buffer.from(cred.response.attestationObject, "base64url");
    const attObj = decodeCbor(attObjBuf) as Map<string | number, unknown>;
    const authDataBuf = attObj.get("authData");
    if (!Buffer.isBuffer(authDataBuf)) {
      throw new Error("webauthn: missing or invalid authData in attestationObject");
    }

    // 6. Parse authData.
    const authData = parseAuthData(authDataBuf);

    // 7. Verify RP ID hash.
    const expectedRpHash = createHash("sha256").update(challenge.rpId).digest();
    if (!authData.rpIdHash.equals(expectedRpHash)) {
      throw new Error("webauthn: rpId hash mismatch");
    }

    // 8. Check flags: UP (bit 0) and UV (bit 3).
    if ((authData.flags & 0x01) === 0) throw new Error("webauthn: user not present");
    if ((authData.flags & 0x08) === 0) throw new Error("webauthn: user not verified");

    // 9. Extract credential ID + public key.
    if (!authData.credId || !authData.cosePublicKey) {
      throw new Error("webauthn: missing credential data in authData");
    }
    const credentialId = authData.credId.toString("base64url");
    const cosePubKeyB64 = authData.cosePublicKey.toString("base64url");

    // 10. Check for duplicate credential.
    const existing = await this.listCredentials(challenge.rpId);
    if (existing.some((c) => c.id === credentialId)) {
      throw new Error("webauthn: credential already registered");
    }

    // 11. Store credential.
    const now = nowWallclock();
    const store = await this.readStore();
    const list = store.rpCredentials[challenge.rpId] ?? [];
    list.push({
      id: credentialId,
      publicKey: cosePubKeyB64,
      counter: authData.signCount,
      createdAt: now,
      lastUsedAt: now,
    });
    store.rpCredentials[challenge.rpId] = list;
    await this.writeStore(store);

    return { ok: true, credentialId };
  }

  /**
   * Verify a WebAuthn authentication response (`navigator.credentials.get`).
   *
   * Checks: challenge match, origin, `type === "webauthn.get"`, RP ID hash,
   * user-present + user-verified flags, counter monotonicity (clone detection),
   * and cryptographic signature verification.
   *
   * @returns `{ ok: true }` on success.
   * @throws  on any verification failure.
   */
  async verifyAuthentication(challengeId: string, credential: unknown): Promise<{ ok: boolean }> {
    const challenge = this.resolveChallenge(challengeId);
    if (challenge.kind !== "authenticate") {
      throw new Error("webauthn: challenge kind mismatch (expected authenticate)");
    }

    const cred = credential as {
      id?: string;
      response?: {
        clientDataJSON?: string;
        authenticatorData?: string;
        signature?: string;
      };
    };
    if (!cred?.response?.clientDataJSON || !cred?.response?.authenticatorData || !cred?.response?.signature) {
      throw new Error("webauthn: missing authenticatorData, clientDataJSON, or signature");
    }

    // 1. Parse clientDataJSON.
    const clientDataBuf = Buffer.from(cred.response.clientDataJSON, "base64url");
    const clientData = JSON.parse(clientDataBuf.toString("utf8")) as {
      type?: string;
      challenge?: string;
      origin?: string;
    };

    // 2. Verify type.
    if (clientData.type !== "webauthn.get") {
      throw new Error("webauthn: wrong clientData type");
    }

    // 3. Verify challenge.
    if (clientData.challenge !== challenge.expectedChallenge) {
      throw new Error("webauthn: challenge mismatch");
    }

    // 4. Verify origin.
    if (clientData.origin !== challenge.origin) {
      throw new Error("webauthn: origin mismatch");
    }

    // 5. Parse authenticatorData.
    const authDataBuf = Buffer.from(cred.response.authenticatorData, "base64url");
    const authData = parseAuthData(authDataBuf);

    // 6. Verify RP ID hash.
    const expectedRpHash = createHash("sha256").update(challenge.rpId).digest();
    if (!authData.rpIdHash.equals(expectedRpHash)) {
      throw new Error("webauthn: rpId hash mismatch");
    }

    // 7. Check flags.
    if ((authData.flags & 0x01) === 0) throw new Error("webauthn: user not present");
    if ((authData.flags & 0x08) === 0) throw new Error("webauthn: user not verified");

    // 8. Look up stored credential.
    const credId = cred.id ?? "";
    const store = await this.readStore();
    const list = store.rpCredentials[challenge.rpId] ?? [];
    const idx = list.findIndex((c) => c.id === credId);
    if (idx < 0) throw new Error("webauthn: credential not registered");

    const stored = list[idx]!;

    // 9. Counter check (clone detection): if either counter is non-zero, the
    //    new counter must be strictly greater than the stored one.
    if (true) {
      if (authData.signCount <= stored.counter) {
        throw new Error("webauthn: counter not incremented (possible authenticator clone)");
      }
    }

    // 10. Signature verification over authenticatorData || SHA-256(clientDataJSON).
    const clientDataHash = createHash("sha256").update(clientDataBuf).digest();
    const signedData = Buffer.concat([authDataBuf, clientDataHash]);
    const signature = Buffer.from(cred.response.signature, "base64url");
    const pubKey = coseToKeyObject(Buffer.from(stored.publicKey, "base64url"));
    const valid = cryptoVerify("sha256", signedData, pubKey, signature);
    if (!valid) throw new Error("webauthn: signature verification failed");

    // 11. Update counter + lastUsedAt.
    list[idx] = {
      ...stored,
      counter: authData.signCount,
      lastUsedAt: nowWallclock(),
    };
    store.rpCredentials[challenge.rpId] = list;
    await this.writeStore(store);

    return { ok: true };
  }
}

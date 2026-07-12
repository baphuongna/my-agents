/**
 * x402 micropayments + wallet (Frontier §20).
 *
 * x402 = the "HTTP 402 Payment Required" status code repurposed for
 * crypto/agent micropayments: a service returns 402 with a payment challenge
 * (amount, currency, payee, nonce), the client signs + pays via its wallet,
 * then retries the request with a payment proof header. The service verifies
 * the proof and returns 200 + the resource.
 *
 * Tier 3 ships:
 *   - Wallet: an in-memory balance + sign/pay. A real wallet (signing
 *     blockchain txns) is Tier 4.
 *   - X402Client: fetch with automatic 402-payment handling (1 retry after pay).
 *   - paidFetch tool: exposes the pattern to the agent (WorkspaceWrite — the
 *     agent is paying, so it's a write-side action).
 *
 * Source: Frontier §20 "x402 micropayments + wallet"; the HTTP 402 pattern
 * used by cloudflare + others for paid APIs.
 *
 * ───────────────────────────────────────────────────────────────────────────
 *  NOT PRODUCTION-GRADE BLOCKCHAIN CRYPTO — TIER 3 STUB
 * ───────────────────────────────────────────────────────────────────────────
 * `Wallet.signingKey` and `signDeterministic` use HMAC-SHA256 with a signing
 * key derived per-wallet via HKDF-SHA256 (RFC 5869). Both primitives are
 * provided by `node:crypto` (no extra dep). The construction is:
 *
 *      masterSecret  = randomBytes(32)            // per-wallet, in memory
 *      signingKey    = HKDF-SHA256(
 *                         ikm    = address,
 *                         salt   = masterSecret,
 *                         info   = "x402v1:signing-key",
 *                         length = 32,
 *                      )
 *      signature     = HMAC-SHA256(signingKey, ${payee}|${currency}|${amount}|${nonce})
 *
 * Properties (sufficient for tier-3 testing):
 *   • Same (signingKey, challenge) → same signature (deterministic).
 *   • Different wallets with the same address produce DIFFERENT signatures
 *     (per-wallet master secret provides isolation).
 *   • Without `masterSecret`, the signature is unforgeable (HMAC security).
 *   • `rotateKey()` invalidates the prior signing key; prior receipts remain
 *     cryptographically valid under their original key.
 *
 * What this is NOT:
 *   • Not ECDSA / secp256k1 / Ed25519 — there is NO public-key verification
 *     and no on-chain signature semantics. A verifier in this tier relies on
 *     the same in-process wallet; remote attestation requires Tier 4.
 *   • Not persistent — `masterSecret` lives in memory only. On restart, the
 *     wallet is "fresh" (intentional; Tier 3 invariant).
 *   • Not a substitute for `Address` as a public key — `address` is a label
 *     that anchors `signingKey` derivation; rotation does NOT change it.
 *
 * Tier 4 will replace this module with real asymmetric crypto. DO NOT use this
 * against any real economic value.
 * ───────────────────────────────────────────────────────────────────────────
 */
import type { ComponentHealth, ToolExecutor } from "@my-agent/core";
import { err, isRecord, ok, type ToolImpl } from "@my-agent/tools";
import type { ToolResult } from "@my-agent/core";
import { createHmac, hkdfSync, randomBytes, createHash } from "node:crypto";
import { nowWallclock } from "@my-agent/core";

/** A payment challenge from a 402 response. */
export interface X402Challenge {
  amount: number; // smallest unit (e.g. satoshis / micro-USDC)
  currency: "USDC" | "SAT" | "FLOCK" | string;
  payee: string; // address / endpoint
  nonce: string;
  /** Human-readable resource description (for the agent's audit log). */
  memo?: string;
}

/** A signed payment authorization. */
export interface X402Receipt {
  challenge: X402Challenge;
  /** Deterministic HMAC-SHA256 signature (Tier 3 stub — see file header). */
  signature: string;
  /** Wallet address that paid. */
  payer: string;
  /** Epoch ms when signed. */
  signedAt: number;
}

/** Balance per currency (smallest unit). */
export type Balance = Record<string, number>;

/**
 * Rich key lifecycle status for the `Wallet`.
 *
 * `address` is the public label bound into HKDF IKM.
 * `masterSecretFingerprint` and `signingKeyFingerprint` are short SHA-256
 * fingerprints (first 12 hex chars) of the raw bytes — for audit logs only;
 * NEVER the secret itself. See {@link Wallet.keyStatus}.
 */
export interface KeyStatus {
  address: string;
  algorithm: "hmac-sha256+HKDF-SHA256";
  masterSecretFingerprint: string;
  signingKeyFingerprint: string;
  /** 1-based: 0 until first rotateKey() call. */
  rotationCount: number;
  /** Epoch ms at construction. */
  createdAt: number;
  /** Epoch ms - createdAt. */
  ageMs: number;
}

/** HKDF domain-separator for the signing key (versioned). */
const HKDF_INFO_SIGNING = Buffer.from("x402v1:signing-key", "utf8");
const MASTER_SECRET_BYTES = 32;
const SIGNING_KEY_BYTES = 32;

/**
 * Derive a per-wallet signing key from `(masterSecret, address)` using
 * HKDF-SHA256 (RFC 5869). Deterministic for fixed inputs.
 *
 * The same `address` with a different `masterSecret` yields a different
 * `signingKey` — this is how same-address wallets stay isolated.
 */
function deriveSigningKey(masterSecret: Buffer, address: string): Buffer {
  const ikm = Buffer.from(address, "utf8");
  const out = hkdfSync("sha256", ikm, masterSecret, HKDF_INFO_SIGNING, SIGNING_KEY_BYTES);
  return Buffer.from(out);
}

/** Short fingerprint of a secret for audit logs (never the secret itself). */
function fingerprintSecret(b: Buffer): string {
  return createHash("sha256").update(b).digest("hex").slice(0, 12);
}

/** A wallet holds a balance, a derived signing key, and signs payment
 * authorizations. Fail-closed: throws on insufficient balance, invalid
 * amounts, or uninitialized key state. */
export class Wallet {
  private readonly balances: Balance;
  /** Payer address (public label; Tier 3: not a cryptographic pubkey). */
  readonly address: string;
  /** 32-byte per-wallet secret. NEVER logged or persisted. */
  private masterSecret: Buffer;
  /** HKDF-SHA256-derive(masterSecret, address). */
  private signingKey: Buffer;
  /** # of rotateKey() calls since construction. */
  private rotationCount = 0;
  /** Wallclock at construction (for key-status reporting). */
  private readonly createdAt: number;
  /** Audit log of all payments. */
  readonly receipts: X402Receipt[] = [];

  constructor(opts: { address?: string; initial?: Balance; masterSecret?: Buffer } = {}) {
    this.address = opts.address ?? "my-agent-wallet";
    this.balances = { ...(opts.initial ?? {}) };
    this.masterSecret = opts.masterSecret ?? randomBytes(MASTER_SECRET_BYTES);
    this.signingKey = deriveSigningKey(this.masterSecret, this.address);
    this.createdAt = nowWallclock();
    // Defensive invariant: derivation must produce a non-empty key.
    if (this.signingKey.length === 0) {
      throw new Error("x402: signing key derivation produced empty buffer (HKDF failure)");
    }
  }

  /** Get the current balance for a currency. */
  balance(currency: string): number {
    return this.balances[currency] ?? 0;
  }

  /** Read-only snapshot of all non-zero balances (currency → amount). */
  get balancesSnapshot(): Balance {
    return { ...this.balances };
  }

  /** Top up the wallet (deposit / faucet). */
  deposit(currency: string, amount: number): void {
    this.balances[currency] = this.balance(currency) + amount;
  }

  /**
   * Rotate the wallet's signing key: fresh `masterSecret` → re-derived
   * `signingKey`. Existing receipts remain valid under their original key;
   * new `pay()` calls produce signatures only verifiable with the new key.
   *
   * Returns the new 1-based rotation index (1 = first rotation).
   */
  rotateKey(): number {
    this.masterSecret = randomBytes(MASTER_SECRET_BYTES);
    this.signingKey = deriveSigningKey(this.masterSecret, this.address);
    this.rotationCount += 1;
    return this.rotationCount;
  }

  /**
   * Sign a challenge (pay). Deducts the amount, appends a receipt, returns it.
   * Throws if the balance is insufficient or the amount is non-positive/non-finite.
   */
  pay(challenge: X402Challenge): X402Receipt {
    // R44: reject non-positive / non-finite amounts (a negative amount would
    // increase the balance; NaN makes it NaN permanently).
    if (!(challenge.amount > 0) || !Number.isFinite(challenge.amount)) {
      throw new Error(`x402: invalid payment amount ${challenge.amount} ${challenge.currency} (must be positive + finite)`);
    }
    const cur = this.balance(challenge.currency);
    if (cur < challenge.amount) {
      throw new Error(`x402: insufficient balance — have ${cur} ${challenge.currency}, need ${challenge.amount}`);
    }
    this.balances[challenge.currency] = cur - challenge.amount;
    const receipt: X402Receipt = {
      challenge,
      signature: signDeterministic(this.signingKey, challenge),
      payer: this.address,
      signedAt: nowWallclock(),
    };
    this.receipts.push(receipt);
    return receipt;
  }

  /**
   * Health tri-state. Returns `"Healthy"` while the key is initialized —
   * this is a Tier 3 stub and has no failure mode after construction.
   *
   * For key lifecycle detail (rotation count, age, fingerprints), see
   * {@link Wallet.keyStatus}. Rich detail is published separately via the
   * `health` runtime event (`detail` field) — the tri-state stays stable so
   * the laneboard aggregates cleanly.
   */
  health(): ComponentHealth {
    return this.signingKey.length === 0 ? "Failed" : "Healthy";
  }

  /**
   * Rich key lifecycle snapshot. SAFE to log / emit — fingerprints are short
   * SHA-256 hex prefixes of the raw bytes, not the bytes themselves.
   *
   * Use this to surface key status to observability (e.g. wire into the
   * `health` runtime event as `detail`).
   */
  keyStatus(): KeyStatus {
    return {
      address: this.address,
      algorithm: "hmac-sha256+HKDF-SHA256",
      masterSecretFingerprint: fingerprintSecret(this.masterSecret),
      signingKeyFingerprint: fingerprintSecret(this.signingKey),
      rotationCount: this.rotationCount,
      createdAt: this.createdAt,
      ageMs: nowWallclock() - this.createdAt,
    };
  }
}

/**
 * Deterministic HMAC-SHA256 signature over the challenge using the wallet's
 * derived signing key. Format: `x402v1:hmac-sha256:<64-hex>`.
 *
 * Not ECDSA — see file header for the full threat model + Tier 4 plan.
 */
function signDeterministic(signingKey: Buffer, c: X402Challenge): string {
  if (signingKey.length === 0) {
    throw new Error("x402: empty signing key (wallet not initialized)");
  }
  // Address is intentionally NOT in the payload — it is the IKM for key
  // derivation, not part of the message. This avoids address-key coupling
  // signature forgery if two wallets share an address.
  const payload = `${c.payee}|${c.currency}|${c.amount}|${c.nonce}`;
  const mac = createHmac("sha256", signingKey).update(payload).digest("hex");
  return `x402v1:hmac-sha256:${mac}`;
}

// ─── X402Client (fetch with 402-payment handling) ────────────────────────────

export interface X402FetchOptions {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  /** Max payment attempts (default 2: initial 402 → 1 pay → retry). */
  maxPaymentAttempts?: number;
}

/** Response from a paid fetch. */
export interface X402FetchResult {
  ok: boolean;
  status: number;
  body?: string;
  /** Payments made (audit trail for the agent). */
  receipts: X402Receipt[];
  /** If the final response was a 402, the unresolved challenge. */
  pendingChallenge?: X402Challenge;
}

/**
 * Parse a 402 challenge from a response.
 * Tier 3 expects a JSON body: `{ "x402": { amount, currency, payee, nonce, memo? } }`.
 */
function parse402(body: string, status: number): X402Challenge | null {
  if (status !== 402) return null;
  try {
    const obj = JSON.parse(body) as { x402?: X402Challenge };
    const c = obj.x402;
    if (!c || typeof c.amount !== "number" || typeof c.payee !== "string") return null;
    return c;
  } catch {
    return null;
  }
}

/**
 * X402Client — wraps `fetch` with automatic 402-payment handling.
 * On 402, the wallet pays + the request is retried with a payment-proof header.
 */
export class X402Client {
  constructor(private wallet: Wallet) {}

  async fetch(url: string, opts: X402FetchOptions = {}): Promise<X402FetchResult> {
    // R44: a fetch needs ≥2 attempts to complete a pay→retry cycle; clamp up.
    const maxAttempts = Math.max(2, opts.maxPaymentAttempts ?? 2);
    // R44: per-fetch timeout (default 30s) so a hung server can't stall the agent.
    const timeoutMs = 30_000;
    const receipts: X402Receipt[] = [];
    let pending: X402Challenge | undefined;
    let paid = false; // R44: pay AT MOST ONCE per fetch (a second 402 = proof rejected)

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const headers: Record<string, string> = { ...(opts.headers ?? {}) };
      // Attach the latest receipt as proof (if any).
      if (receipts.length > 0) {
        const last = receipts[receipts.length - 1]!;
        headers["x402-proof"] = JSON.stringify(last);
      }
      let resp: Response;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        resp = await fetch(url, {
          method: opts.method ?? "GET",
          headers,
          body: opts.body,
          signal: controller.signal,
        });
      } catch (e) {
        clearTimeout(timer);
        const aborted = (e as Error).name === "AbortError";
        return {
          ok: false,
          status: 0,
          receipts,
          pendingChallenge: pending,
          body: aborted
            ? `x402: fetch timed out after ${timeoutMs}ms`
            : `x402: network error: ${(e as Error).message}`,
        };
      }
      clearTimeout(timer);
      if (resp.status === 402) {
        const body = await resp.text();
        const challenge = parse402(body, resp.status);
        if (!challenge) {
          return { ok: false, status: 402, body, receipts, pendingChallenge: undefined };
        }
        // R44: if we've ALREADY paid and the server returns 402 again, the proof
        // was rejected (or it's a new challenge). Don't pay a second time — that
        // would drain the wallet for a resource we never get. Return unresolved.
        if (paid) {
          return {
            ok: false,
            status: 402,
            body: "x402: proof rejected (server returned 402 after payment)",
            receipts,
            pendingChallenge: challenge,
          };
        }
        try {
          const receipt = this.wallet.pay(challenge);
          receipts.push(receipt);
          paid = true;
        } catch (e) {
          // Insufficient balance — stop.
          return {
            ok: false,
            status: 402,
            body: (e as Error).message,
            receipts,
            pendingChallenge: challenge,
          };
        }
        pending = challenge;
        continue; // retry with proof
      }
      // Success (2xx) or other status — return.
      const body = await resp.text();
      return {
        ok: resp.ok,
        status: resp.status,
        body,
        receipts,
        pendingChallenge: undefined,
      };
    }
    // Loop exhausted without 2xx — return the last 402 challenge.
    return { ok: false, status: 402, receipts, pendingChallenge: pending };
  }
}

// ─── paidFetch tool (exposes the pattern to the agent) ───────────────────────

export function makePaidFetchTool(
  wallet: Wallet,
  _toolExecutor?: ToolExecutor,
): ToolImpl {
  const client = new X402Client(wallet);
  return {
    meta: {
      name: "paid_fetch",
      args: {
        type: "object",
        properties: {
          url: { type: "string" },
          method: { type: "string", enum: ["GET", "POST"] },
        },
        required: ["url"],
      },
      requiredMode: "WorkspaceWrite", // paying = write side
    },
    async run(args): Promise<ToolResult> {
      if (!isRecord(args) || typeof args.url !== "string") return err("paid_fetch", "url required");
      const result = await client.fetch(args.url, { method: (args.method === "POST" ? "POST" : "GET") as "GET" | "POST" });
      return ok("paid_fetch", result);
    },
  };
}

export type { ComponentHealth, ToolExecutor };

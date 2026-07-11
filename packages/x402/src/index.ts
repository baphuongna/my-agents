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
 */
import type { ComponentHealth, ToolExecutor } from "@my-agent/core";
import { err, isRecord, ok, type ToolImpl } from "@my-agent/tools";
import type { ToolResult } from "@my-agent/core";
import { nativeMac } from "@my-agent/natives";
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
  /** Deterministic signature for the in-memory wallet (Tier 3 stub). */
  signature: string;
  /** Wallet address that paid. */
  payer: string;
  /** Epoch ms when signed. */
  signedAt: number;
}

/** Balance per currency (smallest unit). */
export type Balance = Record<string, number>;

/** A wallet holds a balance and signs payment authorizations. */
export class Wallet {
  private readonly balances: Balance;
  /** Payer address (derived from a key, or a label). Tier 3: a label. */
  readonly address: string;
  /** Audit log of all payments. */
  readonly receipts: X402Receipt[] = [];

  constructor(opts: { address?: string; initial?: Balance } = {}) {
    this.address = opts.address ?? "my-agent-wallet";
    this.balances = { ...(opts.initial ?? {}) };
  }

  /** Get the current balance for a currency. */
  balance(currency: string): number {
    return this.balances[currency] ?? 0;
  }

  /** Top up the wallet (deposit / faucet). */
  deposit(currency: string, amount: number): void {
    this.balances[currency] = this.balance(currency) + amount;
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
      signature: signDeterministic(this.address, challenge),
      payer: this.address,
      signedAt: nowWallclock(),
    };
    this.receipts.push(receipt);
    return receipt;
  }

  health(): ComponentHealth {
    return "Healthy"; // Tier 3: the stub never fails
  }
}

/** Deterministic signature for the wallet.
 * M2 (security review): FAIL CLOSED. Uses keyed BLAKE3 (native) or HMAC-SHA256
 * (fallback). If BOTH fail, the payment is REJECTED (throw) — never signed with
 * the forgeable FNV-1a fallback (32-bit, unkeyed, trivially forgeable). */
function signDeterministic(address: string, c: X402Challenge): string {
  if (!address) throw new Error("x402: wallet address required (empty key would be forgeable)");
  const payload = `${address}|${c.payee}|${c.currency}|${c.amount}|${c.nonce}`;
  // Keyed BLAKE3 (native) or HMAC-SHA256 (fallback) — both 64 hex. Throws if
  // both native + node:crypto fail (fail-closed; the caller surfaces a pay error).
  const mac = nativeMac(address, payload);
  return `x402v1:blake3:${mac}`;
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

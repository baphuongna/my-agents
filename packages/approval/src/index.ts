/**
 * @my-agent/approval — real human-in-the-loop approval channel (§7 step 6, §13).
 *
 * Replaces the Tier-1 stub that denied every DangerFullAccess. A real
 * ApprovalChannel routes the escalation prompt to a human (CLI readline / rpc
 * approval event / TUI modal) and resolves Allow/Deny. The transport binds the
 * `humanPrompt` callback; this package provides:
 *   - makeApprovalChannel(humanPrompt, opts): the ApprovalChannel impl
 *   - cliApprovalChannel: a readline-based prompt (for the interactive/print
 *     transport)
 *   - ApprovalToken integration (§14.3): a short-lived, single-use, scoped token
 *     consumed against a ledger (auto-approves a declared subset)
 *
 * Source: §7 step 6 escalation prompt, §13 {kind:"approval"} event, §14.3.
 */
import { createInterface } from "node:readline";
import type { ApprovalChannel, ApprovalDecision, ApprovalRequest } from "@my-agent/core";

/** A human prompt callback: given the request, return Allow/Deny. The transport
 * binds this (CLI readline / rpc event round-trip / TUI modal). */
export type HumanPrompt = (req: ApprovalRequest) => Promise<ApprovalDecision>;

/** Timeout + caching options. */
export interface ApprovalOptions {
  /** Escalation timeout ms (default 24h, §4 approvalEscalationTimeoutS). */
  timeoutMs?: number;
}

/** Build an ApprovalChannel backed by a humanPrompt callback. On timeout →
 * fail-closed Deny (§7: "Default-Deny if human unreachable"). */
export function makeApprovalChannel(humanPrompt: HumanPrompt, opts: ApprovalOptions = {}): ApprovalChannel {
  const timeoutMs = opts.timeoutMs ?? 24 * 3600 * 1000;
  return {
    async request(req: ApprovalRequest): Promise<ApprovalDecision> {
      // A1: clear the timer when the human resolves, so we don't leak a 24h
      // timer per request (R42 timer-leak pattern).
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timerP = new Promise<ApprovalDecision>((resolve) => {
        timer = setTimeout(
          () => resolve({ decision: "Deny", reason: `approval timed out after ${timeoutMs}ms (fail-closed)` }),
          timeoutMs,
        );
      });
      try {
        return await Promise.race([humanPrompt(req), timerP]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
  };
}

/** A CLI readline approval channel (for interactive/print transport). Prompts
 * on stderr so it doesn't pollute --json stdout. y/enter = Allow, n = Deny,
 * else Deny. */
export function cliApprovalChannel(opts: ApprovalOptions = {}): ApprovalChannel {
  return makeApprovalChannel(async (req) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    const arg = req.call.args as Record<string, unknown> | undefined;
    const subject = arg?.command ?? arg?.path ?? arg?.url ?? JSON.stringify(req.call.args);
    return new Promise<ApprovalDecision>((resolve) => {
      rl.question(`\n[approval] ${req.call.name} (${req.requiredMode}): ${subject}\n  reason: ${req.reason}\nAllow? [y/N] `, (ans) => {
        rl.close();
        const a = ans.trim().toLowerCase();
        if (a === "y" || a === "yes") resolve({ decision: "Allow" });
        else resolve({ decision: "Deny", reason: `user denied ${req.call.name}` });
      });
    });
  }, opts);
}

// ─── ApprovalToken (§14.3) — short-lived, single-use, scoped ─────────────────

export interface ApprovalToken {
  id: string;
  tool: string;
  scopes: string[]; // e.g. {"write","to:src/**"}
  repo?: string;
  branch?: string;
  issuedAt: number;
  expiresAt: number; // short TTL (default 5m)
  consumed: boolean;
  parent?: string; // multi-hop chain
}

/** A token ledger: issue single-use scoped tokens; consume against a tool+args. */
export class ApprovalTokenLedger {
  private readonly tokens = new Map<string, ApprovalToken>();

  /** Issue a token (5m TTL default). */
  issue(opts: { tool: string; scopes: string[]; repo?: string; branch?: string; ttlMs?: number; parent?: string }): ApprovalToken {
    const id = `apt_${Math.random().toString(36).slice(2, 12)}`;
    const now = Date.now();
    const token: ApprovalToken = {
      id,
      tool: opts.tool,
      scopes: opts.scopes,
      repo: opts.repo,
      branch: opts.branch,
      issuedAt: now,
      expiresAt: now + (opts.ttlMs ?? 5 * 60 * 1000),
      consumed: false,
      parent: opts.parent,
    };
    this.tokens.set(id, token);
    return token;
  }

  /** Consume a token for a tool call. Succeeds (auto-approve) iff: token exists,
   * not consumed, not expired, tool matches, and args satisfy a scope. One-shot. */
  consume(tokenId: string, tool: string, args: unknown): { ok: true } | { ok: false; reason: string } {
    const t = this.tokens.get(tokenId);
    if (!t) return { ok: false, reason: "unknown token" };
    if (t.consumed) return { ok: false, reason: "token already consumed (single-use)" };
    if (Date.now() > t.expiresAt) return { ok: false, reason: "token expired" };
    if (t.tool !== tool) return { ok: false, reason: `token scoped to ${t.tool}, got ${tool}` };
    if (!this.matchesScope(t.scopes, args)) {
      return { ok: false, reason: `args out of scope ${JSON.stringify(t.scopes)}` };
    }
    t.consumed = true;
    return { ok: true };
  }

  /** Minimal scope match: scopes like "write" (any), "to:src/**" (glob path). */
  private matchesScope(scopes: string[], args: unknown): boolean {
    if (scopes.length === 0) return true; // no scope restriction
    const arg = args as Record<string, unknown> | undefined;
    const path = String(arg?.path ?? arg?.command ?? arg?.url ?? "");
    return scopes.some((s) => {
      if (!s.startsWith("to:")) return true; // non-path scope = permissive
      const pat = s.slice(3);
      // minimal glob: * = any, ** = any-incl-slash
      const re = new RegExp("^" + pat.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*") + "$");
      return re.test(path);
    });
  }

  revoke(tokenId: string): void {
    this.tokens.delete(tokenId);
  }

  /** A2: drop expired + consumed tokens (long-running-agent hygiene). Returns
   * the count removed. Safe to call periodically. */
  sweepExpired(now = Date.now()): number {
    let removed = 0;
    for (const [id, t] of this.tokens) {
      if (t.consumed || now > t.expiresAt) {
        this.tokens.delete(id);
        removed++;
      }
    }
    return removed;
  }
}

/** Build an ApprovalChannel that first checks the token ledger (auto-approve a
 * declared subset), then falls back to the human prompt. Enables delegated
 * multi-hop approval (§10 hierarchical forwarding). */
export function tokenThenHumanChannel(
  ledger: ApprovalTokenLedger,
  getToken: (req: ApprovalRequest) => string | undefined,
  human: HumanPrompt,
  opts: ApprovalOptions = {},
): ApprovalChannel {
  return makeApprovalChannel(async (req) => {
    const tokenId = getToken(req);
    if (tokenId) {
      const r = ledger.consume(tokenId, req.call.name, req.call.args);
      if (r.ok) return { decision: "Allow" };
      // token invalid → fall through to human (don't fail-closed silently)
    }
    return human(req);
  }, opts);
}

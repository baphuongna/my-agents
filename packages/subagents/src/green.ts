/**
 * @my-agent/green — GreenContract merge gate (§10.2).
 *
 * Every child subagent MUST reach its declared GreenLevel + produce matching
 * evidence before yield; the parent verifies. Fail-closed: missing/invalid
 * evidence ⇒ SubagentResult{ok:false; error:"green-violation"}.
 *
 *   GreenLevel scope of "green" before yield:
 *     TargetedTests < Package < Workspace < MergeReady
 *
 * Source: §10.2 GreenContract; claw-code green_contract.rs, MyAgents readiness-state.
 */

/** Scope of "green" a child must reach before merge-back. */
export type GreenLevel = "TargetedTests" | "Package" | "Workspace" | "MergeReady";

/** The scope of tests actually run. */
export type TestScope = GreenLevel;

export interface GreenEvidence {
  ran: TestScope;
  passed: boolean;
  coverageDelta?: number;
  /** Optional artifact (test report path / summary). */
  summary?: string;
}

export interface GreenContract {
  required: GreenLevel;
  evidence: GreenEvidence;
}

/** Rank: a higher level subsumes a lower one. */
const RANK: Record<GreenLevel, number> = {
  TargetedTests: 0,
  Package: 1,
  Workspace: 2,
  MergeReady: 3,
};

export type GreenVerifyResult =
  | { ok: true; satisfied: GreenLevel }
  | { ok: false; reason: "evidence-missing" | "evidence-failed" | "scope-insufficient"; detail: string };

/** A child builds its evidence; this asserts it satisfies the contract.
 * The evidence.ran scope MUST be ≥ the required level (a child can't claim
 * MergeReady having only run TargetedTests), AND evidence.passed must be true. */
export function verifyGreen(contract: GreenContract): GreenVerifyResult {
  if (!contract.evidence) {
    return { ok: false, reason: "evidence-missing", detail: "no evidence produced" };
  }
  if (!contract.evidence.passed) {
    return {
      ok: false,
      reason: "evidence-failed",
      detail: `evidence.ran=${contract.evidence.ran} did not pass${contract.evidence.summary ? `: ${contract.evidence.summary}` : ""}`,
    };
  }
  if (RANK[contract.evidence.ran] < RANK[contract.required]) {
    return {
      ok: false,
      reason: "scope-insufficient",
      detail: `evidence scope ${contract.evidence.ran} < required ${contract.required}`,
    };
  }
  return { ok: true, satisfied: contract.evidence.ran };
}

/** Helper: does scope `a` satisfy requirement `b`? */
export function scopeSatisfies(a: TestScope, b: GreenLevel): boolean {
  return RANK[a] >= RANK[b];
}

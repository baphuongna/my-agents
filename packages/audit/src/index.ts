/**
 * @my-agent/audit — Merkle/append-only audit log (§14.1).
 *
 * Tamper-evident hash-chain over RuntimeEvent-derived audit records. Every
 * `RuntimeEvent.kind in {"tool","approval","repair"}` + channel-message
 * receipts are logged (§13/§14.1). The chain lets a verifier detect any
 * in-place mutation or deletion: recompute from a checkpoint; the first
 * divergence yields `forksAt`.
 *
 * Chain (§14.1): serialization = deterministic JSON (keys sorted, no
 * whitespace, UTF-8 NFC); `hash_n = sha256(canonical(prevHash_{n-1} || record_n))`;
 * `prevHash_0 = 0x00..00`; Merkle root committed every `checkpointEvery`
 * records (default 100).
 *
 * Redaction-before-hash (§14.1 invariant): the redactor runs BEFORE
 * canonicalization, so hashed bytes never contain a secret/token (see §14.2).
 *
 * Source: §14 Security, claw-code mcp_audit + oh-my-pi hash-chain.
 */
import { createHash } from "node:crypto";
import { canonicalJson as canonicalJsonUtil } from "@my-agent/core";

/** Mirrors the RuntimeEvent.kind subset (§13/§14.1). */
export type AuditKind = "tool" | "approval" | "repair" | "channel";

export interface AuditRecord {
  seq: number; // monotonic, 1-based
  ts: number; // wallclock ms (epoch) — caller injects via core.time
  kind: AuditKind;
  actor: string; // identity that produced the event
  payload: Record<string, unknown>; // redacted body (post-§14.2 redaction)
}

export interface Checkpoint {
  atSeq: number;
  root: string; // Merkle root over records since the prior checkpoint
  prevRoot: string | null;
}

export type VerifyResult = { ok: true; checked: number } | { ok: false; forksAt: number; reason: string };

/** A redactor strips secrets from a payload BEFORE hashing (§14.1/§14.2). */
export type Redactor = (kind: AuditKind, payload: Record<string, unknown>) => Record<string, unknown>;

const ZERO_HASH = "0".repeat(64);

/** Re-export the canonical serializer from the shared util (§5/§14.1). */
export const canonicalJson = canonicalJsonUtil;

function sha256Hex(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

/** Append-only Merkle audit log. Not thread-safe externally — callers serialize
 * appends (the turn loop is single-threaded per session). */
export class AuditLog {
  private prevHash = ZERO_HASH;
  private readonly hashes: string[] = []; // hash_n per record (for verify)
  readonly checkpoints: Checkpoint[] = [];
  private checkpointPrevRoot: string | null = null;
  private checkpointBucket: string[] = []; // record-hashes since last checkpoint
  /** C1 (security review): store the redacted records so verify() can recompute
   * the chain from source (not just trust stored hashes). */
  private readonly records: AuditRecord[] = [];

  constructor(
    private readonly redactor: Redactor = (_k, p) => p,
    private readonly checkpointEvery = 100,
  ) {}

  /** Append a record; returns its seq + hash. Applies the redactor first. */
  append(rec: Omit<AuditRecord, "seq">): AuditRecord {
    const seq = this.hashes.length + 1;
    const payload = this.redactor(rec.kind, rec.payload);
    const full: AuditRecord = { seq, ts: rec.ts, kind: rec.kind, actor: rec.actor, payload };
    // hash_n = sha256(canonical(prevHash || record))
    const hash = sha256Hex(this.prevHash + canonicalJson(full));
    this.prevHash = hash;
    this.hashes.push(hash);
    this.records.push(full); // C1: retain for verification
    // accumulate into the merkle checkpoint bucket
    this.checkpointBucket.push(hash);
    if (this.checkpointBucket.length >= this.checkpointEvery) {
      this.commitCheckpoint();
    }
    return full;
  }

  /** Compute + store a Merkle root over the records since the last checkpoint. */
  private commitCheckpoint(): void {
    if (this.checkpointBucket.length === 0) return;
    const root = merkleRoot(this.checkpointBucket);
    const atSeq = this.hashes.length;
    this.checkpoints.push({ atSeq, root, prevRoot: this.checkpointPrevRoot });
    this.checkpointPrevRoot = root;
    this.checkpointBucket = [];
  }

  /** Flush a partial checkpoint (e.g. at shutdown). */
  flush(): void {
    this.commitCheckpoint();
  }

  /** Verify the chain from a starting seq (1-based). C1 (security review):
   * RECOMPUTE each hash_n = sha256(prevHash || canonical(record_n)) from the
   * stored records (not the stored hashes) and compare against the stored
   * hashes — the first divergence yields `forksAt`. Also re-verify every
   * checkpoint root. Returns ok + count checked. */
  verify(since = 1): VerifyResult {
    const start = Math.max(1, since);
    let prev = start === 1 ? ZERO_HASH : this.hashes[start - 2] ?? ZERO_HASH;
    for (let i = start - 1; i < this.records.length; i++) {
      const rec = this.records[i]!;
      const expected = this.hashes[i]!;
      const recomputed = sha256Hex(prev + canonicalJson(rec));
      if (recomputed !== expected) {
        return { ok: false, forksAt: rec.seq, reason: `hash mismatch at seq ${rec.seq} (record tampered or chain forked)` };
      }
      prev = expected; // chain advances via the stored (committed) hash
    }
    // Re-verify EVERY checkpoint root from the recomputed record-hashes.
    let cpStart = 0;
    for (const cp of this.checkpoints) {
      const bucket = this.hashes.slice(cpStart, cp.atSeq);
      if (merkleRoot(bucket) !== cp.root) {
        return { ok: false, forksAt: cpStart + 1, reason: "checkpoint root mismatch" };
      }
      cpStart = cp.atSeq;
    }
    return { ok: true, checked: this.records.length - start + 1 };
  }

  /** Number of records appended. */
  get length(): number {
    return this.hashes.length;
  }

  /** The current chain tip hash (for external anchoring / witnesses). */
  get tip(): string {
    return this.prevHash;
  }
}

/** Binary Merkle root over a list of leaf hashes (hex). Empty → zero hash. */
export function merkleRoot(leaves: string[]): string {
  if (leaves.length === 0) return ZERO_HASH;
  let layer = [...leaves];
  while (layer.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      const left = layer[i]!;
      const right = i + 1 < layer.length ? layer[i + 1]! : left; // duplicate last if odd
      next.push(sha256Hex(left + right));
    }
    layer = next;
  }
  return layer[0]!;
}

// §14.3 RecoveryRecipe FSM + ProjectTrust
export { defaultRecoveryRecipes, runRecovery } from "./recovery.js";
export type { RecoveryRecipe, RecoveryStep, FailureScenario, EscalationPolicy, RecoveryAttempt } from "./recovery.js";
export { loadTrust, saveTrust, promoteTrust, safeContextOnly, canAutoApprove, shouldPromptFirstRun } from "./trust.js";
export type { ProjectTrust, TrustLevel } from "./trust.js";

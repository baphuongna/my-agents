/**
 * @my-agent/memory/domains/types — Brain-delegate interface (Phase A Gap 2).
 *
 * A `MemoryDomain` is a Brain-delegate concern that owns ONE slice of the
 * dream-cycle pipeline. It is distinct from `MemoryRole` (in `./roles.ts`)
 * which is a LIFECYCLE-ON-BACKEND role (prefetch/syncTurn/systemPromptBlock).
 *
 * Domains wrap existing Brain APIs where possible (archivist wraps `purge`,
 * diff wraps `schemaSuggest`, search wraps `rrfRetrieve`, etc.). Thin wrappers
 * keep Brain as the lowest-level primitive (so the 477-test baseline is frozen).
 *
 * Source: source/.learned/GAP-IMPLEMENTATION-PLAN.md Phase A Gap 2.
 */
import type { Fact } from "../brain.js";
import type { MemoryHit, MemoryRoleId } from "@my-agent/core";

/** A single domain's recall slice. */
export interface MemoryDomainEntry {
  domain: string;
  hits: MemoryHit[];
}

/** Recall options a domain may consult. */
export interface MemoryDomainOpts {
  topK?: number;
  tier?: "L0" | "L1" | "L2";
  role?: MemoryRoleId;
}

/** Per-domain consolidation accounting. */
export interface ConsolidationReport {
  /** Number of records promoted up one tier (or otherwise "compacted"). */
  promoted: number;
  /** Number of records consumed (deleted/purged/merged). */
  consumed: number;
}

/** A Brain-delegate concern. Owns one slice of the dream-cycle pipeline. */
export interface MemoryDomain {
  readonly name: string;
  /** Wire up the domain to its backing Brain (e.g. capture references). */
  init(brain: import("../brain.js").Brain): void;
  /** Called AFTER `brain.recordFact` returns the persisted Fact. */
  onRecord(fact: Fact): void;
  /** Domain-scoped recall. Returns hits scoped to this concern. */
  recall(query: string, opts?: MemoryDomainOpts): MemoryHit[];
  /** Called after `MemoryTree.promote()` / `.compile()`. */
  onConsolidate(now: number): ConsolidationReport;
}

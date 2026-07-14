/**
 * @my-agent/memory/domains/sync — HLC + LWW stub (Phase A Gap 2).
 *
 * Sync is genuinely new code (HLC timestamps + last-write-wins resolution).
 * Out of scope for Phase A "thin wrappers"; this stub satisfies the 13-of-13
 * file count + the minimal MemoryDomain contract.
 *
 * TODO(hlc): implement HLC class (`{ wallMs, counter, nodeId }`) + LWW comparator
 * that compares (wallMs, counter) pairs across remote SyncEndpoint payloads.
 */
import type { MemoryHit } from "@my-agent/core";
import type { Brain, Fact } from "../brain.js";
import type { ConsolidationReport, MemoryDomain, MemoryDomainOpts } from "./types.js";

export class SyncDomain implements MemoryDomain {
  readonly name = "sync";
  private brain: Brain | undefined;
  init(brain: Brain): void { this.brain = brain; }
  onRecord(_fact: Fact): void { /* TODO(hlc): tag the fact with an HLC timestamp */ }
  recall(_query: string, _opts?: MemoryDomainOpts): MemoryHit[] { return []; }
  onConsolidate(_now: number): ConsolidationReport { return { promoted: 0, consumed: 0 }; }
}
export const syncDomain = new SyncDomain();

/**
 * @my-agent/memory/domains/sync — HLC (Hybrid Logical Clock) + LWW (Tier-2 M-1).
 *
 * SyncDomain attaches HLC timestamps to facts for deterministic ordering across
 * distributed replicas. Last-write-wins resolution compares (wall, counter, node)
 * tuples. Pending sync entries are tracked until a consolidation flushes them.
 *
 * Source: source/.learned/TIER2-DEEP-DESIGN.md §M-1.
 */
import { randomUUID } from "node:crypto";
import { nowWallclock } from "@my-agent/core";
import type { MemoryHit } from "@my-agent/core";
import type { Brain, Fact } from "../brain.js";
import type { ConsolidationReport, MemoryDomain, MemoryDomainOpts } from "./types.js";

export interface HlcTimestamp {
  wall: number;
  counter: number;
  node: string;
}

/** Compare two HLC timestamps: >0 if a>b, <0 if a<b, 0 if equal. */
export function compareHlc(a: HlcTimestamp, b: HlcTimestamp): number {
  if (a.wall !== b.wall) return a.wall - b.wall;
  if (a.counter !== b.counter) return a.counter - b.counter;
  return a.node.localeCompare(b.node);
}

export class SyncDomain implements MemoryDomain {
  readonly name = "sync";
  private brain: Brain | undefined;
  private hlc: HlcTimestamp;
  private readonly node: string;
  private readonly pendingSync = new Map<string, Fact>();

  constructor(node?: string) {
    this.node = node ?? randomUUID();
    this.hlc = { wall: nowWallclock(), counter: 0, node: this.node };
  }

  init(brain: Brain): void {
    this.brain = brain;
  }

  /** Tick the HLC — called on every local event. */
  tick(): HlcTimestamp {
    const now = nowWallclock();
    if (now > this.hlc.wall) {
      this.hlc = { wall: now, counter: 0, node: this.node };
    } else {
      this.hlc = { ...this.hlc, counter: this.hlc.counter + 1 };
    }
    return { ...this.hlc };
  }

  /** Receive a remote HLC — merge into local. */
  receive(remote: HlcTimestamp): void {
    const now = nowWallclock();
    if (now > this.hlc.wall && now > remote.wall) {
      this.hlc = { wall: now, counter: 0, node: this.node };
    } else if (remote.wall > this.hlc.wall) {
      this.hlc = { ...remote };
    } else if (remote.wall === this.hlc.wall) {
      this.hlc = {
        wall: this.hlc.wall,
        counter: Math.max(this.hlc.counter, remote.counter) + 1,
        node: this.node,
      };
    } else {
      this.hlc = { ...this.hlc, counter: this.hlc.counter + 1 };
    }
  }

  /** Extract HLC metadata from a fact, defaulting to (createdAt, 0, "unknown"). */
  private extractHlc(fact: Fact): HlcTimestamp {
    return (
      (fact as Fact & { hlc?: HlcTimestamp }).hlc
      ?? { wall: fact.createdAt, counter: 0, node: "unknown" }
    );
  }

  /** LWW resolution: returns the winning fact (remote wins on strict greater). */
  resolveConflict(local: Fact, remote: Fact): Fact {
    const localHlc = this.extractHlc(local);
    const remoteHlc = this.extractHlc(remote);
    return compareHlc(remoteHlc, localHlc) > 0 ? remote : local;
  }

  onRecord(fact: Fact): void {
    const ts = this.tick();
    this.pendingSync.set(fact.id, fact);
    // Attach HLC as metadata.
    (fact as Fact & { hlc?: HlcTimestamp }).hlc = ts;
  }

  recall(_query: string, _opts?: MemoryDomainOpts): MemoryHit[] {
    return this.pendingSync.size > 0
      ? [{ id: "sync-pending", role: "sync", content: `${this.pendingSync.size} pending`, score: 1 }]
      : [];
  }

  onConsolidate(_now: number): ConsolidationReport {
    const count = this.pendingSync.size;
    this.pendingSync.clear();
    return { promoted: 0, consumed: count };
  }
}

export const syncDomain = new SyncDomain();

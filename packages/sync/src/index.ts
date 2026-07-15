/**
 * @my-agent/sync — multi-agent / multi-device shared-state convergence (§23 #5).
 *
 * §23 open question #5: "Multi-device sync transport: CRDT, last-writer-wins, or
 * server-authoritative?" This package picks a concrete, testable choice:
 * **last-writer-wins per key with hybrid-logical timestamps (HLC)** + a
 * server-authoritative push/pull protocol. Two replicas that sync converge to
 * identical state; concurrent writes are resolved by HLC order (deterministic).
 *
 * Why LWW+HLC over CRDT: the shared state here is agent memory/session keys
 * (string→value), not a rich document — LWW is simple, deterministic, and
 * conflict-free. A full CRDT is reserved for future rich-text session merge.
 *
 * Source: §8 Memory frontier (multi-device sync), §23 #5; Lamport HLC.
 */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { nowWallclock } from "@my-agent/core";

/** A hybrid logical clock entry — wall + counter + node id. Orders events
 * deterministically even when wall clocks skew. */
export interface Hlc {
  wall: number; // epoch ms
  counter: number;
  node: string;
}

/** Compare two HLC timestamps: 1 = a after b, -1 = a before b, 0 = equal. */
export function compareHlc(a: Hlc, b: Hlc): number {
  if (a.wall !== b.wall) return a.wall < b.wall ? -1 : 1;
  if (a.counter !== b.counter) return a.counter < b.counter ? -1 : 1;
  if (a.node !== b.node) return a.node < b.node ? -1 : 1;
  return 0;
}

/** Tick the local HLC (call before producing an event). Returns a new HLC. */
export function hlcTick(local: Hlc, now = nowWallclock()): Hlc {
  if (now > local.wall) return { wall: now, counter: 0, node: local.node };
  return { wall: local.wall, counter: local.counter + 1, node: local.node };
}

/** Receive a remote HLC (updates the local clock to stay ahead). */
export function hlcReceive(local: Hlc, remote: Hlc, now = nowWallclock()): Hlc {
  if (remote.wall > local.wall && remote.wall > now) {
    return { wall: remote.wall, counter: remote.counter + 1, node: local.node };
  }
  if (now > local.wall && now > remote.wall) {
    return { wall: now, counter: 0, node: local.node };
  }
  const base = Math.max(local.wall, remote.wall);
  const lc = local.wall === base ? local.counter : 0;
  const rc = remote.wall === base ? remote.counter : 0;
  return { wall: base, counter: Math.max(lc, rc) + 1, node: local.node };
}

/** A versioned value (LWW entry). */
export interface Versioned {
  key: string;
  value: unknown;
  hlc: Hlc;
  /** Tombstone (deleted) markers win over older puts. */
  deleted?: boolean;
}

/** A local replica of the shared key→value store. */
export class SyncReplica {
  readonly nodeId: string;
  private clock: Hlc;
  private readonly entries = new Map<string, Versioned>();

  constructor(nodeId: string = randomUUID(), seed?: Hlc) {
    this.nodeId = nodeId;
    this.clock = seed ?? { wall: 0, counter: 0, node: nodeId };
  }

  /** Set a key locally (LWW — stamps with the local HLC). */
  set(key: string, value: unknown): Versioned {
    this.clock = hlcTick(this.clock);
    const v: Versioned = { key, value, hlc: this.clock };
    this.entries.set(key, v);
    return v;
  }

  /** Delete a key (tombstone — wins over older puts). */
  delete(key: string): Versioned {
    this.clock = hlcTick(this.clock);
    const v: Versioned = { key, value: null, hlc: this.clock, deleted: true };
    this.entries.set(key, v);
    return v;
  }

  get(key: string): unknown {
    const e = this.entries.get(key);
    return e && !e.deleted ? e.value : undefined;
  }

  /** Snapshot all live entries (for push). */
  export(): Versioned[] {
    return [...this.entries.values()];
  }

  /** Merge remote entries (LWW by HLC). Returns the keys that changed. */
  merge(remote: Versioned[]): string[] {
    const changed: string[] = [];
    for (const r of remote) {
      // advance the local clock from the remote (causality)
      this.clock = hlcReceive(this.clock, r.hlc);
      const local = this.entries.get(r.key);
      if (!local || compareHlc(r.hlc, local.hlc) > 0) {
        this.entries.set(r.key, r);
        changed.push(r.key);
      }
    }
    return changed;
  }

  /** Convergence check: do two replicas have identical live state? */
  equals(other: SyncReplica): boolean {
    const a = this.liveMap();
    const b = other.liveMap();
    if (a.size !== b.size) return false;
    for (const [k, v] of a) {
      if (b.get(k) !== v) return false;
    }
    return true;
  }

  private liveMap(): Map<string, unknown> {
    const m = new Map<string, unknown>();
    for (const [k, v] of this.entries) {
      if (!v.deleted) m.set(k, v.value);
    }
    return m;
  }

  get hlc(): Hlc {
    return this.clock;
  }
  get size(): number {
    return this.liveMap().size;
  }
}

// ─── Server-authoritative push/pull protocol ─────────────────────────────────

/** A pull response: the server's current state for the requested keys. */
export interface PullResponse {
  entries: Versioned[];
  serverClock: Hlc;
}

/** A push response: which keys the server accepted/changed. */
export interface PushResponse {
  accepted: string[];
  conflicts: { key: string; resolved: "remote-wins" | "local-wins" }[];
}

/** Options for {@link SyncServer.start}. */
export interface SyncServerStartOptions {
  /** Periodic exchange/persist interval (ms). Default: 30_000 (30 s). */
  exchangeIntervalMs?: number;
  /** Persisted state path. Default: ~/.mya/sync/state.json. */
  persistPath?: string;
  /** Disable persistence (useful for tests). */
  disablePersistence?: boolean;
}

/** On-disk snapshot shape: the LWW entries + lastSync heartbeat. */
interface SyncSnapshot {
  lastSync: number;
  entries: Versioned[];
}

/** A server-authoritative sync endpoint. Clients push their local writes; the
 * server is the source of truth (LWW merge). Clients pull to converge. */
export class SyncServer {
  private readonly replica = new SyncReplica("server");
  /** Wall-clock timestamp (ms) of the most recent push / pull / heartbeat. */
  private lastSyncValue: number = 0;
  /** Periodic exchange timer (Phase 3-6 — active mode). */
  private exchangeTimer: ReturnType<typeof setInterval> | null = null;
  /** Active exchange interval (ms). */
  private exchangeIntervalMs = 30_000;
  /** Active persist path (set on start). */
  private persistPath: string | null = null;
  /** Whether persistence is enabled this run. */
  private persistenceEnabled = false;

  pull(since?: Hlc): PullResponse {
    const entries = since
      ? this.replica.export().filter((v) => compareHlc(v.hlc, since) > 0)
      : this.replica.export();
    // A successful pull counts as a sync heartbeat.
    this.lastSyncValue = nowWallclock();
    return { entries, serverClock: this.replica.hlc };
  }

  push(clientEntries: Versioned[]): PushResponse {
    const accepted = this.replica.merge(clientEntries);
    const conflicts = accepted.map((key) => ({ key, resolved: "remote-wins" as const }));
    if (accepted.length > 0) this.lastSyncValue = nowWallclock();
    return { accepted, conflicts };
  }

  get replicaState(): SyncReplica {
    return this.replica;
  }

  // ── Phase 3-6: lifecycle (active mode) ─────────────────────────────────────

  /** Whether the periodic exchange timer is armed. */
  get running(): boolean {
    return this.exchangeTimer !== null;
  }

  /** Timestamp (ms) of the most recent push / pull / periodic tick. */
  get lastSync(): number {
    return this.lastSyncValue;
  }

  /** Begin periodic state exchange + persistence. Idempotent. */
  start(opts: SyncServerStartOptions = {}): void {
    if (this.exchangeTimer !== null) return;
    this.exchangeIntervalMs = opts.exchangeIntervalMs ?? 30_000;
    this.persistenceEnabled = !opts.disablePersistence;
    this.persistPath = this.persistenceEnabled
      ? (opts.persistPath ?? join(homedir(), ".mya", "sync", "state.json"))
      : null;
    if (this.persistenceEnabled) {
      this.loadSnapshot();
      this.persistSnapshot();
    }
    this.exchangeTimer = setInterval(() => this.heartbeat(), this.exchangeIntervalMs);
    // Background nicety: never keep the process alive for the sync heartbeat.
    (this.exchangeTimer as unknown as { unref?: () => void }).unref?.();
    // Mark as active the moment we start (was zero before).
    this.lastSyncValue = nowWallclock();
    if (this.persistenceEnabled) this.persistSnapshot();
  }

  /** Stop the periodic timer + persist a final snapshot. Idempotent. */
  stop(): void {
    if (this.exchangeTimer !== null) {
      clearInterval(this.exchangeTimer);
      this.exchangeTimer = null;
    }
    this.persistSnapshot();
  }

  /** One periodic tick: update lastSync + persist (best-effort). Tests can
   *  drive this directly without fake timers. */
  heartbeat(): void {
    this.lastSyncValue = nowWallclock();
    if (this.persistenceEnabled) this.persistSnapshot();
  }

  /** Persist current entries + lastSync to disk. No-op when persistence is
   *  disabled. */
  persistSnapshot(): void {
    if (!this.persistenceEnabled || !this.persistPath) return;
    const snap: SyncSnapshot = {
      lastSync: this.lastSyncValue,
      entries: this.replica.export(),
    };
    try {
      mkdirSync(dirname(this.persistPath), { recursive: true });
      writeFileSync(this.persistPath, JSON.stringify(snap, null, 2), "utf8");
    } catch {
      /* best-effort — sync persistence must never throw to callers */
    }
  }

  /** Load entries from the snapshot file (if present) into the server's
   *  replica. */
  private loadSnapshot(): void {
    if (!this.persistPath || !existsSync(this.persistPath)) return;
    try {
      const raw = readFileSync(this.persistPath, "utf8");
      const parsed = JSON.parse(raw) as SyncSnapshot;
      if (!parsed || !Array.isArray(parsed.entries)) return;
      this.replica.merge(parsed.entries);
      if (typeof parsed.lastSync === "number") this.lastSyncValue = parsed.lastSync;
    } catch {
      /* malformed snapshot → start fresh */
    }
  }
}

/** One full sync round: a client pushes its diff + pulls the server's state.
 * After this, client + server are converged on the pushed keys. */
export async function syncRound(client: SyncReplica, server: SyncServer, since?: Hlc): Promise<{ pushed: number; pulled: number }> {
  const pushed = client.export();
  const pushResp = server.push(pushed);
  const pullResp = server.pull(since);
  const pulled = client.merge(pullResp.entries);
  return { pushed: pushResp.accepted.length, pulled: pulled.length };
}

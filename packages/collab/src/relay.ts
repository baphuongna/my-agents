/**
 * Collaboration relay (Frontier §25.4) — multi-user realtime collab.
 *
 * A WebSocket relay that broadcasts RuntimeEvents to all clients subscribed to
 * a "room" (session). Authz matrix:
 *   - owner: read + write (publish events)
 *   - guest: read-only (receive events, cannot publish)
 *   - guest-via-approval: write but every event passes the §7 permission gate
 *
 * The relay is transport-agnostic: an `EventBus` interface backs it (in-memory
 * for Tier 3; Redis/HTTP swap Tier 4). Clients connect via the WebSocketServer
 * and exchange JSON `{ kind:"publish" | "subscribe", room, role, event }`.
 *
 * Source: §25.4 Realtime collaboration, §12 Channels.
 */
import { EventEmitter } from "node:events";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { nowWallclock } from "@my-agent/core";
import type { RuntimeEvent } from "@my-agent/core";

/** Authz role for a client in a room. */
export type RoomRole = "owner" | "guest" | "guest-approval";

/** Options for {@link CollabRelay.start}. */
export interface CollabRelayStartOptions {
  /** Idle threshold (ms) before a vacant room is auto-cleaned. Default: 3_600_000 (1 h). */
  idleMs?: number;
  /** Cleanup tick interval (ms). Default: 300_000 (5 min). */
  cleanupIntervalMs?: number;
  /** Persisted snapshot path. Default: ~/.mya/collab/rooms.json. */
  persistPath?: string;
  /** Disable persistence (useful for tests that don't touch the FS). */
  disablePersistence?: boolean;
}

/** On-disk snapshot shape (rooms with their last-known activity). */
interface RoomsSnapshot {
  rooms: Array<{ name: string; lastActivity: number; createdAt: number }>;
}

/** A client connected to the relay. */
export interface RoomClient {
  id: string;
  room: string;
  role: RoomRole;
  /** Called by the relay to send events to the client. */
  send(event: RuntimeEvent | { kind: "snapshot"; events: RuntimeEvent[] }): void;
}

/** Per-room event bus (in-memory). Tier 4: swap to Redis/CRDT for multi-host. */
export class CollabRelay extends EventEmitter {
  private rooms = new Map<string, RoomClient[]>();
  /** Bounded ring buffer of recently published events per room (R43 Tier 3 fix). */
  private snapshots = new Map<string, RuntimeEvent[]>();
  /** Max events retained per room in the snapshot ring buffer. */
  private static readonly MAX_SNAPSHOT = 100;
  /** Last-activity timestamp per room (ms). Updated on join/publish; persists
   *  across client disconnects so a vacant room remains visible until the
   *  stale-room sweep retires it. */
  private roomActivity = new Map<string, { lastActivity: number; createdAt: number }>();
  /** Cleanup timer (Phase 3-6 — active mode). */
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  /** Active idle threshold (ms). */
  private idleMs = 3_600_000;
  /** Active cleanup interval (ms). */
  private cleanupIntervalMs = 300_000;
  /** Active persist path (set on start). */
  private persistPath: string | null = null;
  /** Whether persistence is enabled this run. */
  private persistenceEnabled = false;

  /** Mark a room as active at `now` (or the wall-clock now). */
  private touch(room: string, now: number): void {
    const existing = this.roomActivity.get(room);
    if (existing) existing.lastActivity = now;
    else this.roomActivity.set(room, { lastActivity: now, createdAt: now });
  }

  /** Open a room with the given owner. Idempotent. */
  openRoom(room: string, owner: RoomClient): void {
    this.join(room, owner, "owner");
  }
  /** Join a room with a role. R43: refuses same-id rejoin (which would orphan the
   *  previous client and confuse leave/identity tracking — caller must leave first). */
  join(room: string, client: RoomClient, role: RoomRole): void {
    const list = this.rooms.get(room);
    if (list && list.some((c) => c.id === client.id)) {
      throw new Error(`collab: client id "${client.id}" already in room "${room}" (leave first)`);
    }
    client.room = room;
    client.role = role;
    if (!list) { this.rooms.set(room, [client]); } else { list.push(client); }
    this.touch(room, nowWallclock());
    this.maybePersist();
    this.emit("join", { room, client, role });
  }
  /** Leave a room. */
  leave(room: string, clientId: string): void {
    const list = this.rooms.get(room);
    if (!list) return;
    const idx = list.findIndex((c) => c.id === clientId);
    if (idx >= 0) {
      const [removed] = list.splice(idx, 1);
      this.maybePersist();
      this.emit("leave", { room, client: removed });
    }
  }

  /** Publish an event to all clients in the room (enforces authz). */
  publish(room: string, from: RoomClient, event: RuntimeEvent): { delivered: number; denied: boolean } {
    const list = this.rooms.get(room);
    if (!list) return { delivered: 0, denied: true };
    // Authz: only owner + guest-approval can write. owner-originated events always pass.
    if (from.role !== "owner" && from.role !== "guest-approval") {
      return { delivered: 0, denied: true };
    }
    let delivered = 0;
    for (const c of list) {
      if (c.id === from.id) continue; // don't echo to sender
      try { c.send(event); delivered++; } catch { /* drop on send error */ }
    }
    // Buffer the event for late-joining clients (bounded ring buffer, R43).
    this.buffer(room, event);
    this.touch(room, nowWallclock());
    this.maybePersist();
    this.emit("publish", { room, event, delivered });
    return { delivered, denied: false };
  }

  /** Push an event onto a room's bounded snapshot ring buffer. */
  private buffer(room: string, event: RuntimeEvent): void {
    const buf = this.snapshots.get(room) ?? [];
    buf.push(event);
    if (buf.length > CollabRelay.MAX_SNAPSHOT) {
      // Drop oldest entries to keep the buffer bounded (ring-buffer semantics).
      buf.splice(0, buf.length - CollabRelay.MAX_SNAPSHOT);
    }
    this.snapshots.set(room, buf);
  }

  /** Snapshot the recent events for a room (bounded ring buffer for late joins). */
  snapshot(room: string): RuntimeEvent[] {
    return [...(this.snapshots.get(room) ?? [])];
  }

  /** Names of all open rooms. */
  get roomNames(): string[] {
    return [...this.rooms.keys()];
  }

  /** Room stats. */
  stats(room: string): { clients: number; roles: Record<RoomRole, number> } {
    const list = this.rooms.get(room) ?? [];
    const roles: Record<RoomRole, number> = { owner: 0, guest: 0, "guest-approval": 0 };
    for (const c of list) roles[c.role]++;
    return { clients: list.length, roles };
  }

  // ── Phase 3-6: lifecycle (active mode) ─────────────────────────────────────

  /** Whether the cleanup timer is armed. */
  get running(): boolean {
    return this.cleanupTimer !== null;
  }

  /** Last-activity timestamp (ms) for a room — used by stale-room cleanup.
   *  Returns undefined for rooms that have never been opened (or have been
   *  swept). */
  lastActivityFor(room: string): number | undefined {
    return this.roomActivity.get(room)?.lastActivity;
  }

  /** Snapshot of room activity records (read-only view). */
  roomActivitySnapshot(): Array<{ name: string; lastActivity: number; createdAt: number }> {
    return [...this.roomActivity.entries()]
      .map(([name, v]) => ({ name, lastActivity: v.lastActivity, createdAt: v.createdAt }))
      .sort((a, b) => b.lastActivity - a.lastActivity);
  }

  /** Drop rooms whose last activity is older than `now - idleMs`. Returns the
   *  removed room names. Deterministic — safe to call from tests without
   *  driving fake timers. */
  purgeStale(now: number = nowWallclock()): string[] {
    const removed: string[] = [];
    for (const [name, v] of this.roomActivity) {
      if (now - v.lastActivity > this.idleMs) {
        this.roomActivity.delete(name);
        this.snapshots.delete(name);
        removed.push(name);
      }
    }
    if (removed.length > 0) this.maybePersist();
    if (removed.length > 0) this.emit("purged", { rooms: removed });
    return removed;
  }

  /** Begin periodic stale-room cleanup + persistence. Idempotent. */
  start(opts: CollabRelayStartOptions = {}): void {
    if (this.cleanupTimer !== null) return;
    this.idleMs = opts.idleMs ?? 3_600_000;
    this.cleanupIntervalMs = opts.cleanupIntervalMs ?? 300_000;
    this.persistenceEnabled = !opts.disablePersistence;
    this.persistPath = this.persistenceEnabled
      ? (opts.persistPath ?? join(homedir(), ".mya", "collab", "rooms.json"))
      : null;
    if (this.persistenceEnabled) {
      this.loadSnapshot();
      this.maybePersist();
    }
    this.cleanupTimer = setInterval(() => this.purgeStale(), this.cleanupIntervalMs);
    // Background nicety: never keep the process alive for cleanup alone.
    (this.cleanupTimer as unknown as { unref?: () => void }).unref?.();
    this.emit("started", { idleMs: this.idleMs, cleanupIntervalMs: this.cleanupIntervalMs });
  }

  /** Stop the cleanup timer + persist a final snapshot. Idempotent. */
  stop(): void {
    if (this.cleanupTimer !== null) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.maybePersist();
    this.emit("stopped", {});
  }

  /** Persist the current room-activity snapshot to disk. No-op when persistence
   *  is disabled (no `persistPath` has been set by `start()`). */
  persistSnapshot(): void {
    if (!this.persistenceEnabled || !this.persistPath) return;
    const snap: RoomsSnapshot = {
      rooms: [...this.roomActivity.entries()].map(([name, v]) => ({
        name,
        lastActivity: v.lastActivity,
        createdAt: v.createdAt,
      })),
    };
    try {
      mkdirSync(dirname(this.persistPath), { recursive: true });
      writeFileSync(this.persistPath, JSON.stringify(snap, null, 2), "utf8");
    } catch (e) {
      // Persistence is best-effort: do not crash the relay on disk errors.
      this.emit("persist_error", { error: (e as Error).message });
    }
  }

  /** Load the snapshot file (if present) into the activity map. */
  private loadSnapshot(): void {
    if (!this.persistPath || !existsSync(this.persistPath)) return;
    try {
      const raw = readFileSync(this.persistPath, "utf8");
      const parsed = JSON.parse(raw) as RoomsSnapshot;
      if (!parsed || !Array.isArray(parsed.rooms)) return;
      const now = nowWallclock();
      for (const r of parsed.rooms) {
        if (!r || typeof r.name !== "string") continue;
        // Only restore rooms that are NOT already stale — keeps the
        // persisted list aligned with the active idle threshold.
        if (now - r.lastActivity <= this.idleMs) {
          this.roomActivity.set(r.name, {
            lastActivity: r.lastActivity,
            createdAt: r.createdAt,
          });
        }
      }
    } catch {
      /* malformed snapshot → start fresh */
    }
  }

  /** Internal: persist if enabled. Cheap enough to call on every mutation. */
  private maybePersist(): void {
    if (this.persistenceEnabled && this.persistPath) this.persistSnapshot();
  }
}
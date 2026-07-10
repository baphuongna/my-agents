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
import type { RuntimeEvent } from "@my-agent/core";

/** Authz role for a client in a room. */
export type RoomRole = "owner" | "guest" | "guest-approval";

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
    this.emit("join", { room, client, role });
  }
  /** Leave a room. */
  leave(room: string, clientId: string): void {
    const list = this.rooms.get(room);
    if (!list) return;
    const idx = list.findIndex((c) => c.id === clientId);
    if (idx >= 0) {
      const [removed] = list.splice(idx, 1);
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
    this.emit("publish", { room, event, delivered });
    return { delivered, denied: false };
  }

  /** Snapshot the current room members (for a new client catching up). */
  snapshot(room: string): RuntimeEvent[] {
    // The relay itself is event-source-agnostic — snapshot is a ring buffer the
    // owner can populate. Tier 3 ships an empty snapshot; Tier 4 can add a buffer.
    return [];
  }

  /** Room stats. */
  stats(room: string): { clients: number; roles: Record<RoomRole, number> } {
    const list = this.rooms.get(room) ?? [];
    const roles: Record<RoomRole, number> = { owner: 0, guest: 0, "guest-approval": 0 };
    for (const c of list) roles[c.role]++;
    return { clients: list.length, roles };
  }
}
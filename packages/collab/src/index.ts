/**
 * @my-agent/collab — collaboration relay (Frontier §25.4).
 *
 * CollabRelay: in-memory event bus with per-room authz (owner RW / guest RO /
 * guest-approval RW via the §7 gate). Transport-agnostic (WebSocket glue lands
 * in a separate file). Tier 4: swap to Redis/CRDT for multi-host.
 */
export { CollabRelay } from "./relay.js";
export type { RoomClient, RoomRole } from "./relay.js";
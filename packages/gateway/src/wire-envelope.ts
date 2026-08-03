/**
 * §25.6 UI ↔ Runtime wire envelope — the single core UI contract.
 *
 * The wire envelope is the only shape a UI surface (desktop dashboard, web
 * SPA, mobile client) consumes from the typed RuntimeEvent bus. UI surfaces
 * never scrape stdout (invariant #11).
 *
 * Source: §25.6 contract.
 */
import { nowWallclock } from "@my-agent/core";

/** §25.6 wire envelope framing a RuntimeEvent for UI subscribers. */
export interface WireEnvelope {
  version: 1;
  sessionId: string;
  runId?: string;
  laneId?: string;
  seq: number;
  event: unknown; // a RuntimeEvent (§13) — opaque here to avoid a core import cycle
  ts: number;
}

/** Frame a RuntimeEvent into the wire envelope. */
export function frame(opts: {
  sessionId: string;
  seq: number;
  event: unknown;
  runId?: string;
  laneId?: string;
  ts?: number;
}): WireEnvelope {
  return { version: 1, sessionId: opts.sessionId, runId: opts.runId, laneId: opts.laneId, seq: opts.seq, event: opts.event, ts: opts.ts ?? nowWallclock() };
}

import { describe, it, expect } from "vitest";
import { CollabRelay, type RoomClient } from "./relay.js";
import type { RuntimeEvent } from "@my-agent/core";

/** Helper: build a minimal RoomClient that records received events. */
function makeClient(id: string): RoomClient & { received: unknown[] } {
  const received: unknown[] = [];
  return {
    id,
    room: "",
    role: "owner",
    send: (e: unknown) => { received.push(e); },
    received,
  };
}

/** Helper: build a trivial log RuntimeEvent. */
function logEvent(message: string): RuntimeEvent {
  return { kind: "log", level: "info", message };
}

describe("CollabRelay snapshot ring buffer", () => {
  it("returns [] for an unknown room", () => {
    const relay = new CollabRelay();
    expect(relay.snapshot("nope")).toEqual([]);
  });

  it("buffers published events and snapshots them in order", () => {
    const relay = new CollabRelay();
    const owner = makeClient("owner");
    const guest = makeClient("guest");
    relay.join("room1", owner, "owner");
    relay.join("room1", guest, "guest");

    const a = logEvent("a");
    const b = logEvent("b");
    relay.publish("room1", owner, a);
    relay.publish("room1", owner, b);

    expect(relay.snapshot("room1")).toEqual([a, b]);
  });

  it("denied publishes (guest role) are not buffered", () => {
    const relay = new CollabRelay();
    const owner = makeClient("owner");
    const guest = makeClient("guest");
    relay.join("room1", owner, "owner");
    relay.join("room1", guest, "guest");

    // guest cannot publish → denied, nothing buffered.
    const res = relay.publish("room1", guest, logEvent("x"));
    expect(res.denied).toBe(true);
    expect(relay.snapshot("room1")).toEqual([]);
  });

  it("bounds the buffer to 100 events (drops oldest)", () => {
    const relay = new CollabRelay();
    const owner = makeClient("owner");
    relay.join("room1", owner, "owner");

    for (let i = 0; i < 120; i++) {
      relay.publish("room1", owner, logEvent(`ev-${i}`));
    }

    const snap = relay.snapshot("room1");
    expect(snap).toHaveLength(100);
    // Oldest 20 dropped; first retained is ev-20.
    expect((snap[0] as { message: string }).message).toBe("ev-20");
    expect((snap[99] as { message: string }).message).toBe("ev-119");
  });

  it("keeps per-room buffers independent", () => {
    const relay = new CollabRelay();
    const o1 = makeClient("o1");
    const o2 = makeClient("o2");
    relay.join("r1", o1, "owner");
    relay.join("r2", o2, "owner");

    relay.publish("r1", o1, logEvent("only-r1"));
    expect(relay.snapshot("r1")).toHaveLength(1);
    expect(relay.snapshot("r2")).toEqual([]);
  });
});

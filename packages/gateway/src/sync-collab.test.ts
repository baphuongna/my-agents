/**
 * @my-agent/gateway — sync + collab binding tests (Phase 3).
 */
import { describe, it, expect } from "vitest";
import { Gateway } from "./index.js";
import { SyncServer } from "@my-agent/sync";
import { CollabRelay } from "@my-agent/collab";

describe("Gateway sync + collab binding", () => {
  it("exposes syncServer getter", () => {
    const sync = new SyncServer();
    const gw = new Gateway({ sync });
    expect(gw.syncServer).toBe(sync);
  });

  it("exposes collabRelay getter", () => {
    const collab = new CollabRelay();
    const gw = new Gateway({ collab });
    expect(gw.collabRelay).toBe(collab);
  });

  it("sync /sync/state endpoint returns replica state", async () => {
    const sync = new SyncServer();
    sync.replicaState.set("key1", "value1");
    const gw = new Gateway({ sync });
    const { port } = await gw.start();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/sync/state`);
      const data = (await res.json()) as Array<{ key: string; value: string }>;
      expect(data.some((e) => e.key === "key1" && e.value === "value1")).toBe(true);
    } finally {
      await gw.stop();
    }
  });

  it("sync /sync/pull returns pull response", async () => {
    const sync = new SyncServer();
    sync.replicaState.set("foo", "bar");
    const gw = new Gateway({ sync });
    const { port } = await gw.start();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/sync/pull`);
      const data = (await res.json()) as { entries?: unknown };
      expect(data).toBeDefined();
      expect(data.entries).toBeDefined();
    } finally {
      await gw.stop();
    }
  });

  it("sync /sync/push accepts entries and returns merge result", async () => {
    const sync = new SyncServer();
    const gw = new Gateway({ sync });
    const { port } = await gw.start();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/sync/push`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify([
          { key: "pushed", value: "val", hlc: { wall: 1, counter: 0, node: "test" } },
        ]),
      });
      const data = await res.json() as Record<string, unknown>;
      expect(data).toBeDefined();
    } finally {
      await gw.stop();
    }
  });

  it("sync /sync/pull returns 400 on malformed since param", async () => {
    const sync = new SyncServer();
    const gw = new Gateway({ sync });
    const { port } = await gw.start();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/sync/pull?since=not-json`);
      expect(res.status).toBe(400);
    } finally {
      await gw.stop();
    }
  });

  it("collab relay owner can publish to room", () => {
    const collab = new CollabRelay();
    const gw = new Gateway({ collab });
    expect(gw.collabRelay).toBe(collab);
    // Verify relay works standalone
    const ownerClient = { id: "c1", room: "room1", role: "owner" as const, send: () => {} };
    collab.openRoom("room1", ownerClient);
    const guestClient = { id: "c2", room: "room1", role: "guest" as const, send: () => {} };
    collab.join("room1", guestClient, "guest");
    const result = collab.publish("room1", ownerClient, { kind: "test" } as never);
    expect(result.delivered).toBe(1);
    expect(result.denied).toBe(false);
  });

  it("collab relay guest cannot publish", () => {
    const collab = new CollabRelay();
    const ownerClient = { id: "c1", room: "room1", role: "owner" as const, send: () => {} };
    collab.openRoom("room1", ownerClient);
    const guestClient = { id: "c2", room: "room1", role: "guest" as const, send: () => {} };
    collab.join("room1", guestClient, "guest");
    // Guest tries to publish — should be denied
    const result = collab.publish("room1", guestClient, { kind: "test" } as never);
    expect(result.denied).toBe(true);
    expect(result.delivered).toBe(0);
  });
});

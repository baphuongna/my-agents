/**
 * @my-agent/sync — HLC + replica convergence tests.
 */
import { describe, it, expect } from "vitest";
import { compareHlc, hlcTick, hlcReceive, SyncReplica, SyncServer, syncRound } from "./index.js";

describe("HLC", () => {
  it("compareHlc orders by wall then counter then node", () => {
    const a = { wall: 1, counter: 0, node: "a" };
    const b = { wall: 2, counter: 0, node: "a" };
    expect(compareHlc(a, b)).toBe(-1);
    expect(compareHlc(b, a)).toBe(1);
    expect(compareHlc(a, a)).toBe(0);
  });

  it("hlcTick produces monotonic timestamps", () => {
    const t0 = { wall: 100, counter: 0, node: "x" };
    const t1 = hlcTick(t0, 100);
    const t2 = hlcTick(t1, 100);
    expect(t2.counter).toBe(t1.counter! + 1);
    expect(compareHlc(t2, t1)).toBe(1);
  });

  it("hlcReceive handles remote clocks", () => {
    const local = { wall: 100, counter: 0, node: "x" };
    const remote = { wall: 200, counter: 5, node: "y" };
    const received = hlcReceive(local, remote, 100);
    expect(received.wall).toBeGreaterThanOrEqual(remote.wall);
  });
});

describe("SyncReplica", () => {
  it("set/get/delete/export", () => {
    const r = new SyncReplica("node1");
    r.set("key1", "val1");
    expect(r.get("key1")).toBe("val1");
    r.delete("key1");
    expect(r.get("key1")).toBeUndefined();
    expect(r.export().length).toBe(1);
    expect(r.export()[0]?.deleted).toBe(true);
  });

  it("merge applies LWW by HLC", () => {
    const a = new SyncReplica("a");
    const b = new SyncReplica("b");
    a.set("k", "from-a");
    const exported = a.export();
    const changed = b.merge(exported);
    expect(changed.length).toBe(1);
    expect(b.get("k")).toBe("from-a");
  });

  it("equals after sync", () => {
    const a = new SyncReplica("a");
    const b = new SyncReplica("b");
    a.set("k1", "v1");
    a.set("k2", "v2");
    b.merge(a.export());
    expect(a.equals(b)).toBe(true);
  });
});

describe("SyncServer", () => {
  it("pull/push round-trip", () => {
    const server = new SyncServer();
    const client = new SyncReplica("client");
    client.set("foo", "bar");

    const pushRes = server.push(client.export());
    expect(pushRes).toBeDefined();

    const pullRes = server.pull();
    expect(pullRes).toBeDefined();
  });
});

describe("syncRound convergence", () => {
  it("two replicas converge", async () => {
    const server = new SyncServer();
    const client = new SyncReplica("client");
    client.set("shared", "value");

    const result = await syncRound(client, server);
    expect(result.pushed).toBeGreaterThan(0);
  });
});

import { describe, it, expect } from "vitest";
import {
  LaneBoard,
  classifyFreshness,
  laneBoardHealth,
} from "@my-agent/core";
import type {
  LaneBoardEntry,
  LaneHeartbeat,
  ComponentHealth,
} from "@my-agent/core";

// STALLED_AFTER_MS is an unexported module constant == 60_000 in laneboard.ts.
const STALLED_AFTER_MS = 60_000;

/** Build a heartbeat with sensible defaults; override any field. */
function hb(over: Partial<LaneHeartbeat> = {}): LaneHeartbeat {
  return {
    observedAt: over.observedAt ?? 0,
    transportAlive: over.transportAlive ?? true,
    status: over.status ?? "running",
    blockedOn: over.blockedOn,
  };
}

/** Build a LaneBoardEntry. */
function entry(over: Partial<LaneBoardEntry> = {}): LaneBoardEntry {
  return {
    taskId: over.taskId ?? "task-1",
    prompt: over.prompt ?? "do thing",
    status: over.status ?? "running",
    teamId: over.teamId ?? "team-a",
    heartbeat: over.heartbeat ?? hb({ observedAt: 1000 }),
    freshness: over.freshness ?? "Healthy",
  };
}

describe("classifyFreshness — the single liveness classifier (§13)", () => {
  it("approval-blocked → AwaitingHuman", () => {
    expect(classifyFreshness(hb({ blockedOn: "approval" }), 1_000)).toBe(
      "AwaitingHuman",
    );
  });

  it("approval takes priority even when transport is dead", () => {
    expect(
      classifyFreshness(
        hb({ blockedOn: "approval", transportAlive: false }),
        1_000,
      ),
    ).toBe("AwaitingHuman");
  });

  it("transport dead (no approval) → TransportDead", () => {
    expect(classifyFreshness(hb({ transportAlive: false }), 1_000)).toBe(
      "TransportDead",
    );
  });

  it("age beyond STALLED_AFTER_MS → Stalled", () => {
    // observedAt = 0, now = 60_001 → age 60_001 > 60_000
    expect(classifyFreshness(hb({ observedAt: 0 }), 60_001)).toBe("Stalled");
  });

  it("age exactly at the boundary is still Healthy (> is strict)", () => {
    expect(classifyFreshness(hb({ observedAt: 0 }), STALLED_AFTER_MS)).toBe(
      "Healthy",
    );
  });

  it("fresh heartbeat → Healthy", () => {
    expect(classifyFreshness(hb({ observedAt: 5_000 }), 6_000)).toBe("Healthy");
  });

  it("default `now` uses the live wallclock (recent heartbeat is Healthy)", () => {
    const now = Date.now();
    const f = classifyFreshness(hb({ observedAt: now }));
    expect(f).toBe("Healthy");
  });

  it("a future observedAt (clock skew) is still Healthy (negative age)", () => {
    expect(classifyFreshness(hb({ observedAt: 10_000 }), 1_000)).toBe("Healthy");
  });
});

describe("LaneBoard — the liveness board FSM", () => {
  it("upsert stores an entry retrievable via all()", () => {
    const board = new LaneBoard();
    board.upsert(entry({ taskId: "t1" }));
    expect(board.all()).toHaveLength(1);
    expect(board.all()[0]!.taskId).toBe("t1");
  });

  it("upsert is idempotent by taskId (same id replaces)", () => {
    const board = new LaneBoard();
    board.upsert(entry({ taskId: "t1", prompt: "v1" }));
    board.upsert(entry({ taskId: "t1", prompt: "v2" }));
    expect(board.all()).toHaveLength(1);
    expect(board.all()[0]!.prompt).toBe("v2");
  });

  it("all() returns a fresh array snapshot (mutation isolation)", () => {
    const board = new LaneBoard();
    board.upsert(entry({ taskId: "t1" }));
    const snap = board.all();
    snap.pop();
    expect(board.all()).toHaveLength(1); // internal map untouched
  });

  it("observe updates an existing entry's heartbeat + freshness", () => {
    const board = new LaneBoard();
    board.upsert(entry({ taskId: "t1", freshness: "Stalled" }));
    // observe() re-classifies with the live wallclock, so use a recent stamp.
    board.observe("t1", hb({ observedAt: Date.now(), transportAlive: true }));
    const e = board.all()[0]!;
    expect(e.heartbeat.transportAlive).toBe(true);
    expect(e.freshness).toBe("Healthy");
  });

  it("observe re-classifies to TransportDead when the transport dies", () => {
    const board = new LaneBoard();
    board.upsert(entry({ taskId: "t1" }));
    board.observe("t1", hb({ transportAlive: false }));
    expect(board.all()[0]!.freshness).toBe("TransportDead");
  });

  it("observe is a no-op when the taskId is not on the board", () => {
    const board = new LaneBoard();
    board.upsert(entry({ taskId: "t1" }));
    board.observe("unknown", hb({ transportAlive: false }));
    expect(board.all()).toHaveLength(1);
    expect(board.all()[0]!.freshness).toBe("Healthy");
  });

  it("stuck() returns only non-Healthy lanes", () => {
    const board = new LaneBoard();
    board.upsert(entry({ taskId: "h", freshness: "Healthy" }));
    board.upsert(entry({ taskId: "s", freshness: "Stalled" }));
    board.upsert(entry({ taskId: "d", freshness: "TransportDead" }));
    const stuck = board.stuck();
    expect(stuck).toHaveLength(2);
    expect(stuck.map((e) => e.taskId).sort()).toEqual(["d", "s"]);
  });

  it("stuck() is empty when every lane is Healthy", () => {
    const board = new LaneBoard();
    board.upsert(entry({ taskId: "h1", freshness: "Healthy" }));
    board.upsert(entry({ taskId: "h2", freshness: "Healthy" }));
    expect(board.stuck()).toHaveLength(0);
  });
});

describe("laneBoardHealth — aggregate tri-state (Healthy/Degraded/Failed)", () => {
  it("empty board → Healthy", () => {
    expect(laneBoardHealth(new LaneBoard())).toBe<ComponentHealth>("Healthy");
  });

  it("all lanes healthy → Healthy", () => {
    const board = new LaneBoard();
    board.upsert(entry({ taskId: "h", freshness: "Healthy" }));
    expect(laneBoardHealth(board)).toBe("Healthy");
  });

  it("a Stalled lane (not TransportDead) → Degraded", () => {
    const board = new LaneBoard();
    board.upsert(entry({ taskId: "h", freshness: "Healthy" }));
    board.upsert(entry({ taskId: "s", freshness: "Stalled" }));
    expect(laneBoardHealth(board)).toBe("Degraded");
  });

  it("any TransportDead lane → Failed", () => {
    const board = new LaneBoard();
    board.upsert(entry({ taskId: "s", freshness: "Stalled" }));
    board.upsert(entry({ taskId: "d", freshness: "TransportDead" }));
    expect(laneBoardHealth(board)).toBe("Failed");
  });

  it("TransportDead dominates Stalled even when Stalled comes first in iteration", () => {
    const board = new LaneBoard();
    board.upsert(entry({ taskId: "s", freshness: "Stalled" }));
    board.upsert(entry({ taskId: "d", freshness: "TransportDead" }));
    board.upsert(entry({ taskId: "s2", freshness: "Stalled" }));
    expect(laneBoardHealth(board)).toBe("Failed");
  });
});

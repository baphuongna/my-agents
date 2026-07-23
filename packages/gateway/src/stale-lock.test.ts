import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readLock,
  isPidAlive,
  isLockStale,
  removeStaleLockAtomic,
  acquireOrReplaceStaleLock,
  type LockInfo,
} from "./stale-lock.js";

/** TTL constant must match the module (120 s). */
const LOCK_STALE_TTL_MS = 120_000;

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "stale-lock-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function lockPath(name = "gateway.lock"): string {
  return join(dir, name);
}

function writeLock(path: string, info: LockInfo): void {
  writeFileSync(path, JSON.stringify(info));
}

// ─── readLock ─────────────────────────────────────────────────────────────────

describe("readLock", () => {
  it("reads a valid lock file", () => {
    const p = lockPath();
    writeLock(p, { pid: 12345, createdAt: 1000 });
    expect(readLock(p)).toEqual({ pid: 12345, createdAt: 1000 });
  });

  it("returns null when the file does not exist", () => {
    expect(readLock(lockPath("missing.lock"))).toBe(null);
  });

  it("returns null for malformed JSON", () => {
    const p = lockPath();
    writeFileSync(p, "not json");
    expect(readLock(p)).toBe(null);
  });

  it("returns null when fields are missing or wrong type", () => {
    const p = lockPath();
    writeFileSync(p, JSON.stringify({ pid: "not-a-number", createdAt: 1000 }));
    expect(readLock(p)).toBe(null);
  });
});

// ─── isPidAlive ───────────────────────────────────────────────────────────────

describe("isPidAlive", () => {
  it("returns true for the current process PID", () => {
    expect(isPidAlive(process.pid)).toBe(true);
  });

  it("returns false for a non-existent PID", () => {
    // PID 0x7FFFFFFF is extremely unlikely to exist.
    expect(isPidAlive(2_000_000)).toBe(false);
  });
});

// ─── isLockStale ──────────────────────────────────────────────────────────────

describe("isLockStale", () => {
  it("returns false when no lock file exists", () => {
    expect(isLockStale(lockPath("missing.lock"), 10_000)).toBe(false);
  });

  it("returns true when TTL is exceeded", () => {
    const p = lockPath();
    writeLock(p, { pid: 2_000_000, createdAt: 0 });
    // now is 200 s later → exceeds 120 s TTL.
    expect(isLockStale(p, LOCK_STALE_TTL_MS + 80_000)).toBe(true);
  });

  it("returns false when TTL is exactly at the boundary (just under)", () => {
    const p = lockPath();
    // Use current PID so it's alive.
    writeLock(p, { pid: process.pid, createdAt: 0 });
    // now = TTL - 1 → still within TTL, PID alive.
    expect(isLockStale(p, LOCK_STALE_TTL_MS - 1)).toBe(false);
  });

  it("returns false for a recent lock with a live PID", () => {
    const p = lockPath();
    writeLock(p, { pid: process.pid, createdAt: 10_000 });
    expect(isLockStale(p, 11_000)).toBe(false); // 1 s old, PID alive
  });

  it("returns true within TTL if the PID is dead (crashed)", () => {
    const p = lockPath();
    writeLock(p, { pid: 2_000_000, createdAt: 10_000 });
    // Only 1 s old (within TTL) but PID is dead → stale.
    expect(isLockStale(p, 11_000)).toBe(true);
  });
});

// ─── removeStaleLockAtomic ────────────────────────────────────────────────────

describe("removeStaleLockAtomic", () => {
  it("removes the lock file and returns true", () => {
    const p = lockPath();
    writeLock(p, { pid: 2_000_000, createdAt: 0 });
    expect(removeStaleLockAtomic(p)).toBe(true);
    expect(existsSync(p)).toBe(false);
  });

  it("cleans up the tombstone file", () => {
    const p = lockPath();
    writeLock(p, { pid: 2_000_000, createdAt: 0 });
    removeStaleLockAtomic(p);
    expect(existsSync(`${p}.stale`)).toBe(false);
  });

  it("returns false when the lock does not exist (another racer won)", () => {
    expect(removeStaleLockAtomic(lockPath("never-existed.lock"))).toBe(false);
  });

  it("returns false on the second call (already removed)", () => {
    const p = lockPath();
    writeLock(p, { pid: 2_000_000, createdAt: 0 });
    expect(removeStaleLockAtomic(p)).toBe(true);
    expect(removeStaleLockAtomic(p)).toBe(false); // already gone
  });
});

// ─── acquireOrReplaceStaleLock ────────────────────────────────────────────────

describe("acquireOrReplaceStaleLock", () => {
  it("acquires when no lock exists", () => {
    const p = lockPath();
    expect(acquireOrReplaceStaleLock(p, process.pid)).toBe(true);
    const lock = readLock(p);
    expect(lock).not.toBeNull();
    expect(lock!.pid).toBe(process.pid);
  });

  it("fails when the lock is held by a live process", () => {
    const p = lockPath();
    writeLock(p, { pid: process.pid, createdAt: 1 }); // live PID
    expect(acquireOrReplaceStaleLock(p, 99_999)).toBe(false);
    // Original lock unchanged.
    expect(readLock(p)?.pid).toBe(process.pid);
  });

  it("replaces a stale lock held by a dead process", () => {
    const p = lockPath();
    writeLock(p, { pid: 2_000_000, createdAt: 0 }); // dead PID
    expect(acquireOrReplaceStaleLock(p, process.pid)).toBe(true);
    const lock = readLock(p);
    expect(lock).not.toBeNull();
    expect(lock!.pid).toBe(process.pid);
  });

  it("writes a valid createdAt timestamp on acquire", () => {
    const p = lockPath();
    acquireOrReplaceStaleLock(p, process.pid);
    const lock = readLock(p);
    expect(lock).not.toBeNull();
    expect(typeof lock!.createdAt).toBe("number");
    expect(lock!.createdAt).toBeGreaterThan(0);
  });
});

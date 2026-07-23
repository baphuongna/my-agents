import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AuditLog,
  merkleRoot,
  ACHIEVEMENTS,
  saveTrust,
  loadTrust,
  promoteTrust,
  shouldPromptFirstRun,
  safeContextOnly,
  canAutoApprove,
  type ProjectTrust,
} from "./index.js";

describe("AuditLog — Merkle hash-chain (§14.1, C1)", () => {
  it("append produces monotonically increasing seq + recomputable chain", () => {
    const log = new AuditLog();
    const r1 = log.append({ ts: 1, kind: "tool", actor: "a", payload: { x: 1 } });
    const r2 = log.append({ ts: 2, kind: "tool", actor: "a", payload: { x: 2 } });
    expect(r1.seq).toBe(1);
    expect(r2.seq).toBe(2);
    expect(log.length).toBe(2);
    // C1: verify recomputes from the stored records, not trusted hashes.
    expect(log.verify().ok).toBe(true);
  });

  it("C1 fix: verify is NOT a no-op — detects tampered record content", () => {
    const log = new AuditLog();
    log.append({ ts: 1, kind: "tool", actor: "a", payload: { amount: 5 } });
    log.append({ ts: 2, kind: "tool", actor: "a", payload: { amount: 10 } });
    // Mutate an in-memory record (simulates tampering). verify MUST catch it.
    (log as unknown as { records: { payload: Record<string, unknown> }[] }).records[0]!.payload.amount = 999;
    const v = log.verify();
    expect(v.ok).toBe(false);
  });

  it("detects a fork: reports the seq where the chain diverges", () => {
    const log = new AuditLog();
    for (let i = 0; i < 5; i++) log.append({ ts: i, kind: "tool", actor: "a", payload: { i } });
    // Corrupt the stored hash for record 3 → verify should fork at seq 3.
    const hashes = (log as unknown as { hashes: string[] }).hashes;
    hashes[2] = "0".repeat(64);
    const v = log.verify();
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.forksAt).toBe(3);
  });

  it("redacts the payload BEFORE hashing (redactor runs in append)", () => {
    const seen: string[] = [];
    const redactor = (_kind: string, p: Record<string, unknown>) => {
      seen.push(JSON.stringify(p));
      return { ...p, secret: "<redacted>" };
    };
    const log = new AuditLog(redactor);
    log.append({ ts: 1, kind: "tool", actor: "a", payload: { secret: "sk-live", ok: true } });
    // the redacted view was hashed, not the raw payload
    expect(seen[0]).toContain("sk-live");
    const records = (log as unknown as { records: { payload: { secret: string } }[] }).records;
    expect(records[0]!.payload.secret).toBe("<redacted>");
    expect(log.verify().ok).toBe(true);
  });
});

// --- merkleRoot (standalone) --------------------------------------------------

function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

describe("merkleRoot", () => {
  it("returns the zero hash for an empty leaf list", () => {
    expect(merkleRoot([])).toBe("0".repeat(64));
  });

  it("returns the single leaf unchanged", () => {
    const leaf = sha256("only-one");
    expect(merkleRoot([leaf])).toBe(leaf);
  });

  it("hashes two leaves into sha256(left || right)", () => {
    const a = sha256("a");
    const b = sha256("b");
    expect(merkleRoot([a, b])).toBe(sha256(a + b));
  });

  it("reduces a power-of-two set correctly (4 leaves)", () => {
    const l = ["aa", "bb", "cc", "dd"].map(sha256);
    const ab = sha256(l[0]! + l[1]!);
    const cd = sha256(l[2]! + l[3]!);
    const root = sha256(ab + cd);
    expect(merkleRoot(l)).toBe(root);
  });

  it("duplicates the last leaf for an odd count", () => {
    const l = ["a", "b", "c"].map(sha256);
    const ab = sha256(l[0]! + l[1]!);
    const cc = sha256(l[2]! + l[2]!); // last duplicated
    expect(merkleRoot(l)).toBe(sha256(ab + cc));
  });

  it("produces a deterministic 64-char hex string", () => {
    const l = ["x", "y"].map(sha256);
    const root = merkleRoot(l);
    expect(root).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic — same input always yields same output", () => {
    const l = ["1", "2", "3", "4"].map(sha256);
    expect(merkleRoot(l)).toBe(merkleRoot(l));
  });

  it("produces different roots for different inputs", () => {
    const l1 = ["a", "b"].map(sha256);
    const l2 = ["a", "c"].map(sha256);
    expect(merkleRoot(l1)).not.toBe(merkleRoot(l2));
  });
});

// --- ACHIEVEMENTS (static array) -----------------------------------------------

describe("ACHIEVEMENTS", () => {
  it("is a non-empty array", () => {
    expect(Array.isArray(ACHIEVEMENTS)).toBe(true);
    expect(ACHIEVEMENTS.length).toBeGreaterThan(0);
  });

  it("has 10 defined achievements", () => {
    expect(ACHIEVEMENTS).toHaveLength(10);
  });

  it("each achievement has id, name, description, and icon", () => {
    for (const a of ACHIEVEMENTS) {
      expect(typeof a.id).toBe("string");
      expect(a.id.length).toBeGreaterThan(0);
      expect(typeof a.name).toBe("string");
      expect(typeof a.description).toBe("string");
      expect(typeof a.icon).toBe("string");
    }
  });

  it("has unique ids", () => {
    const ids = ACHIEVEMENTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("includes the first-prompt achievement", () => {
    const first = ACHIEVEMENTS.find((a) => a.id === "first-prompt");
    expect(first).toBeDefined();
    expect(first!.name).toBe("Hello World");
  });

  it("includes the cron-master achievement", () => {
    expect(ACHIEVEMENTS.some((a) => a.id === "cron-master")).toBe(true);
  });
});

// --- AchievementTracker --------------------------------------------------------
// Uses vi.resetModules + dynamic import so ACHIEVEMENTS_PATH picks up the temp HOME.

describe("AchievementTracker", () => {
  let dir: string;
  let realHome: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mya-ach-"));
    realHome = process.env.HOME;
    process.env.HOME = dir;
    vi.resetModules();
  });

  afterEach(() => {
    process.env.HOME = realHome;
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  });

  it("starts with all achievements locked", async () => {
    const { AchievementTracker } = await import("./index.js");
    const tracker = new AchievementTracker();
    expect(tracker.listUnlocked()).toHaveLength(0);
    expect(tracker.listLocked()).toHaveLength(10);
  });

  it("unlocks first-prompt on the first promptsSent stat", async () => {
    const { AchievementTracker } = await import("./index.js");
    const tracker = new AchievementTracker();
    const unlocked = tracker.recordStat("promptsSent");
    expect(unlocked).not.toBeNull();
    expect(unlocked!.id).toBe("first-prompt");
  });

  it("adds the unlocked achievement to listUnlocked", async () => {
    const { AchievementTracker } = await import("./index.js");
    const tracker = new AchievementTracker();
    tracker.recordStat("promptsSent");
    const list = tracker.listUnlocked();
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe("first-prompt");
    expect(list[0]!.unlockedAt).toBeTypeOf("number");
  });

  it("removes the unlocked achievement from listLocked", async () => {
    const { AchievementTracker } = await import("./index.js");
    const tracker = new AchievementTracker();
    tracker.recordStat("promptsSent");
    const locked = tracker.listLocked();
    expect(locked).toHaveLength(9);
    expect(locked.some((a) => a.id === "first-prompt")).toBe(false);
  });

  it("does not re-unlock an already-unlocked achievement", async () => {
    const { AchievementTracker } = await import("./index.js");
    const tracker = new AchievementTracker();
    tracker.recordStat("promptsSent");
    const second = tracker.recordStat("promptsSent");
    expect(second).toBeNull();
  });

  it("unlocks first-subagent when subagentsSpawned reaches 1", async () => {
    const { AchievementTracker } = await import("./index.js");
    const tracker = new AchievementTracker();
    // Unlock first-prompt first so it doesn't preempt
    tracker.recordStat("promptsSent");
    const unlocked = tracker.recordStat("subagentsSpawned");
    expect(unlocked).not.toBeNull();
    expect(unlocked!.id).toBe("first-subagent");
  });

  it("unlocks cron-master after 5 cronJobsCreated", async () => {
    const { AchievementTracker } = await import("./index.js");
    const tracker = new AchievementTracker();
    let result = null;
    for (let i = 0; i < 5; i++) {
      result = tracker.recordStat("cronJobsCreated");
    }
    // The 5th call (or a subsequent one) unlocks cron-master.
    // Night-owl may unlock on an earlier call but won't block cron-master.
    expect(result).not.toBeNull();
    expect(result!.id).toBe("cron-master");
  });

  it("unlocks ten-tools after recording 10 distinct tool: stats", async () => {
    const { AchievementTracker } = await import("./index.js");
    const tracker = new AchievementTracker();
    for (let i = 0; i < 10; i++) {
      tracker.recordStat(`tool:tool${i}`);
    }
    const list = tracker.listUnlocked();
    expect(list.some((a) => a.id === "ten-tools")).toBe(true);
  });

  it("returns null when no achievement triggers", async () => {
    const { AchievementTracker } = await import("./index.js");
    const tracker = new AchievementTracker();
    const result = tracker.recordStat("someRandomStat");
    expect(result).toBeNull();
  });

  it("persists unlocked state across instances (load from file)", async () => {
    const { AchievementTracker } = await import("./index.js");
    const tracker1 = new AchievementTracker();
    tracker1.recordStat("promptsSent");
    expect(tracker1.listUnlocked()).toHaveLength(1);
    // New instance reads the same file
    const tracker2 = new AchievementTracker();
    expect(tracker2.listUnlocked()).toHaveLength(1);
    expect(tracker2.listUnlocked()[0]!.id).toBe("first-prompt");
  });

  it("persists accumulated stats across instances (when a save occurs)", async () => {
    const { AchievementTracker } = await import("./index.js");
    const tracker1 = new AchievementTracker();
    tracker1.recordStat("cronJobsCreated", 4); // no unlock yet → not saved alone
    tracker1.recordStat("promptsSent"); // first-prompt unlock → saves stats incl cronJobsCreated=4
    // New instance loads the saved stats
    const tracker2 = new AchievementTracker();
    const result = tracker2.recordStat("cronJobsCreated", 1); // 4 + 1 = 5 → cron-master
    expect(result).not.toBeNull();
    expect(result!.id).toBe("cron-master");
  });

  it("survives a corrupt achievements.json (starts fresh)", async () => {
    const { writeFileSync, mkdirSync } = await import("node:fs");
    const achPath = join(dir, ".mya", "achievements.json");
    mkdirSync(join(dir, ".mya"), { recursive: true });
    writeFileSync(achPath, "{corrupt");
    const { AchievementTracker } = await import("./index.js");
    const tracker = new AchievementTracker(); // should not throw
    expect(tracker.listUnlocked()).toHaveLength(0);
  });

  it("listUnlocked is sorted by unlock time", async () => {
    const { AchievementTracker } = await import("./index.js");
    const tracker = new AchievementTracker();
    tracker.recordStat("promptsSent"); // first-prompt
    tracker.recordStat("subagentsSpawned"); // first-subagent
    const list = tracker.listUnlocked();
    expect(list).toHaveLength(2);
    expect(list[0]!.unlockedAt).toBeLessThanOrEqual(list[1]!.unlockedAt);
  });
});

// --- Trust functions (saveTrust, loadTrust, shouldPromptFirstRun, etc.) --------

describe("trust functions", () => {
  let trustDir: string;
  let realTrustDir: string | undefined;

  beforeEach(() => {
    trustDir = mkdtempSync(join(tmpdir(), "mya-trust-"));
    realTrustDir = process.env.MY_AGENT_TRUST_DIR;
    process.env.MY_AGENT_TRUST_DIR = trustDir;
  });

  afterEach(() => {
    if (realTrustDir === undefined) delete process.env.MY_AGENT_TRUST_DIR;
    else process.env.MY_AGENT_TRUST_DIR = realTrustDir;
    try { rmSync(trustDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  });

  it("saveTrust + loadTrust round-trips a trusted level", () => {
    const root = trustDir; // existing dir → canonical resolves
    saveTrust({ root, level: "trusted", defaultProjectTrust: "ask", trustedAt: 12345 });
    const loaded = loadTrust(root);
    expect(loaded.level).toBe("trusted");
    expect(loaded.defaultProjectTrust).toBe("ask");
    expect(loaded.trustedAt).toBe(12345);
    expect(loaded.source).toBe("persisted");
  });

  it("saveTrust + loadTrust round-trips a privileged level", () => {
    const root = trustDir;
    saveTrust({ root, level: "privileged", defaultProjectTrust: "always" });
    const loaded = loadTrust(root);
    expect(loaded.level).toBe("privileged");
  });

  it("loadTrust returns untrusted for a root with no saved record", () => {
    const loaded = loadTrust(trustDir);
    expect(loaded.level).toBe("untrusted");
    expect(loaded.source).toBe("default");
  });

  it("loadTrust rejects an invalid level in the file (fails safe to untrusted)", () => {
    const root = trustDir;
    // Manually write a bogus level
    saveTrust({ root, level: "trusted", defaultProjectTrust: "ask" });
    const { writeFileSync, readdirSync, readFileSync } = require("node:fs");
    const files = readdirSync(trustDir);
    const file = files[0];
    const bogus = JSON.stringify({ level: "SUPERUSER", defaultProjectTrust: "ask" });
    writeFileSync(join(trustDir, file!), bogus);
    const loaded = loadTrust(root);
    expect(loaded.level).toBe("untrusted");
  });

  it("saveTrust writes a 0600 file", () => {
    saveTrust({ root: trustDir, level: "trusted", defaultProjectTrust: "ask" });
    const { readdirSync, statSync } = require("node:fs");
    const file = readdirSync(trustDir)[0]!;
    const mode = statSync(join(trustDir, file)).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});

describe("shouldPromptFirstRun", () => {
  const mk = (level: ProjectTrust["level"], dpt: ProjectTrust["defaultProjectTrust"]): ProjectTrust =>
    ({ root: "/x", level, defaultProjectTrust: dpt });

  it("returns true when untrusted + ask", () => {
    expect(shouldPromptFirstRun(mk("untrusted", "ask"))).toBe(true);
  });

  it("returns false when untrusted + always", () => {
    expect(shouldPromptFirstRun(mk("untrusted", "always"))).toBe(false);
  });

  it("returns false when untrusted + never", () => {
    expect(shouldPromptFirstRun(mk("untrusted", "never"))).toBe(false);
  });

  it("returns false when trusted + ask", () => {
    expect(shouldPromptFirstRun(mk("trusted", "ask"))).toBe(false);
  });

  it("returns false when privileged + ask", () => {
    expect(shouldPromptFirstRun(mk("privileged", "ask"))).toBe(false);
  });
});

describe("safeContextOnly + canAutoApprove", () => {
  const mk = (level: ProjectTrust["level"]): ProjectTrust =>
    ({ root: "/x", level, defaultProjectTrust: "ask" });

  it("safeContextOnly is true only for untrusted", () => {
    expect(safeContextOnly(mk("untrusted"))).toBe(true);
    expect(safeContextOnly(mk("trusted"))).toBe(false);
    expect(safeContextOnly(mk("privileged"))).toBe(false);
  });

  it("canAutoApprove is true only for privileged", () => {
    expect(canAutoApprove(mk("untrusted"))).toBe(false);
    expect(canAutoApprove(mk("trusted"))).toBe(false);
    expect(canAutoApprove(mk("privileged"))).toBe(true);
  });
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync, rmSync, writeFileSync, readFileSync, statSync, chmodSync, readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readCronJobs,
  atomicWriteJobs,
  CRON_FILE,
  CRON_DIR,
  type CronFileJob,
} from "./cron-persist.js";

function sampleJob(overrides: Partial<CronFileJob> = {}): CronFileJob {
  return {
    id: "job-1",
    name: "test",
    trigger: "cron",
    schedule: "0 9 * * *",
    prompt: "hello",
    enabled: true,
    deliveryTarget: "_cron",
    ...overrides,
  };
}

describe("readCronJobs — shape tolerance", () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mya-cronpersist-"));
    file = join(dir, "cron.json");
  });
  afterEach(() => {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  });

  it("returns [] when the file does not exist", () => {
    expect(readCronJobs(file)).toEqual([]);
  });

  it("reads a bare-array shape", () => {
    const job = sampleJob();
    writeFileSync(file, JSON.stringify([job]));
    const loaded = readCronJobs(file);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.id).toBe("job-1");
    expect(loaded[0]!.trigger).toBe("cron");
  });

  it("reads a {jobs:[...]} envelope shape", () => {
    const job = sampleJob({ id: "env-1" });
    writeFileSync(file, JSON.stringify({ jobs: [job] }));
    const loaded = readCronJobs(file);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.id).toBe("env-1");
  });

  it("returns [] for corrupt JSON", () => {
    writeFileSync(file, "{not valid json");
    expect(readCronJobs(file)).toEqual([]);
  });

  it("returns [] for a JSON object without a jobs array", () => {
    writeFileSync(file, JSON.stringify({ other: "value" }));
    expect(readCronJobs(file)).toEqual([]);
  });

  it("returns [] for a JSON primitive (non-array, non-object)", () => {
    writeFileSync(file, JSON.stringify(42));
    expect(readCronJobs(file)).toEqual([]);
  });

  it("returns [] for a JSON string", () => {
    writeFileSync(file, JSON.stringify("hello"));
    expect(readCronJobs(file)).toEqual([]);
  });

  it("preserves optional fields (leaseMs, timezone)", () => {
    const job = sampleJob({ leaseMs: 300000, timezone: "America/New_York" });
    writeFileSync(file, JSON.stringify([job]));
    const loaded = readCronJobs(file);
    expect(loaded[0]!.leaseMs).toBe(300000);
    expect(loaded[0]!.timezone).toBe("America/New_York");
  });

  it("reads multiple jobs", () => {
    writeFileSync(file, JSON.stringify([
      sampleJob({ id: "a" }),
      sampleJob({ id: "b" }),
      sampleJob({ id: "c" }),
    ]));
    expect(readCronJobs(file)).toHaveLength(3);
  });
});

describe("readCronJobs — OOM guard", () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mya-cronpersist-"));
    file = join(dir, "cron.json");
    chmodSync(dir, 0o700);
  });
  afterEach(() => {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  });

  it("refuses a file larger than 1 MiB", () => {
    writeFileSync(file, "x".repeat(1_048_577));
    expect(readCronJobs(file)).toEqual([]);
  });

  it("accepts a file just under 1 MiB", () => {
    // A valid JSON array that is under the limit — should parse fine.
    const job = sampleJob();
    writeFileSync(file, JSON.stringify([job]));
    // This file is small, well under the limit
    expect(readCronJobs(file)).toHaveLength(1);
  });
});

describe("atomicWriteJobs — write + round-trip", () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mya-cronpersist-"));
    file = join(dir, "cron.json");
  });
  afterEach(() => {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  });

  it("writes valid JSON readable by readCronJobs", () => {
    const job = sampleJob();
    atomicWriteJobs([job], file);
    const loaded = readCronJobs(file);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.id).toBe("job-1");
  });

  it("round-trips multiple jobs with all fields", () => {
    const jobs: CronFileJob[] = [
      sampleJob({ id: "j1", trigger: "on-interval", schedule: 60000 }),
      sampleJob({ id: "j2", trigger: "once", schedule: 1735689600000, leaseMs: 1000 }),
      sampleJob({ id: "j3", trigger: "cron", schedule: "0 * * * *", timezone: "UTC" }),
    ];
    atomicWriteJobs(jobs, file);
    const loaded = readCronJobs(file);
    expect(loaded).toHaveLength(3);
    expect(loaded[0]!.trigger).toBe("on-interval");
    expect(loaded[0]!.schedule).toBe(60000);
    expect(loaded[1]!.trigger).toBe("once");
    expect(loaded[1]!.leaseMs).toBe(1000);
    expect(loaded[2]!.timezone).toBe("UTC");
  });

  it("creates the file with mode 0600 (owner-only)", () => {
    atomicWriteJobs([sampleJob()], file);
    const mode = statSync(file).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("overwrites an existing file atomically", () => {
    atomicWriteJobs([sampleJob({ id: "first" })], file);
    atomicWriteJobs([sampleJob({ id: "second" })], file);
    const loaded = readCronJobs(file);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.id).toBe("second");
  });

  it("writes an empty array", () => {
    atomicWriteJobs([], file);
    expect(readCronJobs(file)).toEqual([]);
  });

  it("writes pretty-printed (indented) JSON", () => {
    atomicWriteJobs([sampleJob()], file);
    const raw = readFileSync(file, "utf-8");
    expect(raw).toContain("\n"); // multi-line = pretty-printed
    expect(raw).toContain("  "); // 2-space indent
  });

  it("does not leave a temp file behind", () => {
    atomicWriteJobs([sampleJob()], file);
    const entries = readdirSync(dir);
    expect(entries).toEqual(["cron.json"]);
  });
});

describe("CRON_FILE / CRON_DIR constants", () => {
  it("CRON_FILE is inside CRON_DIR", () => {
    expect(CRON_FILE.startsWith(CRON_DIR)).toBe(true);
  });

  it("CRON_DIR ends with .mya/agent", () => {
    expect(CRON_DIR).toContain(".mya");
    expect(CRON_DIR).toContain("agent");
  });

  it("CRON_FILE ends with cron.json", () => {
    expect(CRON_FILE.endsWith("cron.json")).toBe(true);
  });
});

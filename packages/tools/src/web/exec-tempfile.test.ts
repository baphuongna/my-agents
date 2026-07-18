/**
 * exec-tempfile tests — real subprocess execution (no mocks).
 *
 * Each test spawns an actual `node -e` child to verify the temp-file stdio
 * path, timeout/kill, cleanup, and env filtering end-to-end.
 */
import { describe, it, expect } from "vitest";
import { execTempfile } from "./exec-tempfile.js";
import { tmpdir } from "node:os";
import { readdirSync } from "node:fs";

/** Count leftover temp dirs with our prefix (cleanup verification). */
function countTempDirs(): number {
  try {
    return readdirSync(tmpdir()).filter((n) =>
      n.startsWith("mya-exec-"),
    ).length;
  } catch {
    return 0;
  }
}

describe("execTempfile", () => {
  // ── Happy path ───────────────────────────────────────────────────────────

  it("captures stdout from a child process", async () => {
    const r = await execTempfile("node", [
      "-e",
      'process.stdout.write("hello")',
    ]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("hello");
    expect(r.timedOut).toBe(false);
    expect(r.signal).toBe(null);
  });

  // ── stderr capture ───────────────────────────────────────────────────────

  it("captures stderr from a child process", async () => {
    const r = await execTempfile("node", [
      "-e",
      'process.stderr.write("err")',
    ]);
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toBe("err");
    expect(r.timedOut).toBe(false);
  });

  // ── Non-zero exit ─────────────────────────────────────────────────────────

  it("returns the correct exit code for non-zero exit", async () => {
    const r = await execTempfile("node", ["-e", "process.exit(3)"]);
    expect(r.exitCode).toBe(3);
    expect(r.timedOut).toBe(false);
  });

  // ── Timeout ───────────────────────────────────────────────────────────────

  it(
    "times out and reports timedOut=true with exitCode=null",
    async () => {
      const r = await execTempfile(
        "node",
        ["-e", "setInterval(()=>{},1000)"],
        { timeoutMs: 200 },
      );
      expect(r.timedOut).toBe(true);
      expect(r.exitCode).toBe(null);
    },
    10_000,
  );

  // ── Env passing ───────────────────────────────────────────────────────────

  it("passes non-secret env vars to the child process", async () => {
    const r = await execTempfile(
      "node",
      ["-e", "process.stdout.write(process.env.TEST_VAR)"],
      { env: { TEST_VAR: "x" } },
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("x");
  });

  // ── Secret env filtering ─────────────────────────────────────────────────

  it("strips secret-looking env vars from the child env", async () => {
    // MYA_SECRET_TOKEN matches SECRET_ENV_RE (_SECRET_ and _TOKEN patterns).
    // The child should NOT see it — process.env.MYA_SECRET_TOKEN is undefined.
    const r = await execTempfile(
      "node",
      [
        "-e",
        "process.stdout.write(process.env.MYA_SECRET_TOKEN || 'UNSET')",
      ],
      { env: { MYA_SECRET_TOKEN: "LEAKED" } },
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("UNSET");
  });

  // ── Cleanup ───────────────────────────────────────────────────────────────

  it("cleans up temp files after execution", async () => {
    const before = countTempDirs();
    await execTempfile("node", [
      "-e",
      'process.stdout.write("cleanup-test")',
    ]);
    const after = countTempDirs();
    expect(after).toBe(before);
  });

  // ── Missing command ───────────────────────────────────────────────────────

  it("returns an error result (never throws) for a missing command", async () => {
    const r = await execTempfile("nonexistent-command-xyz-12345", []);
    expect(r.timedOut).toBe(false);
    // Spawn failure: exitCode is null, stderr has a diagnostic message.
    expect(r.exitCode).toBe(null);
    expect(r.stderr.length).toBeGreaterThan(0);
  });

  // ── Large output truncation ───────────────────────────────────────────────

  it("truncates output exceeding maxBufferBytes", async () => {
    // Write ~100 KB of 'A' characters, cap at 1 KB.
    const r = await execTempfile(
      "node",
      ["-e", "process.stdout.write('A'.repeat(100000))"],
      { maxBufferBytes: 1024 },
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout.length).toBeLessThanOrEqual(1024);
  });
});

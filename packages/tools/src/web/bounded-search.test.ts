/**
 * bounded-search.test.ts — Tests for the disposable worker bounded executor.
 *
 * Each test spawns a real child process (no mocks of child_process) and uses
 * mock search modules (no network) to verify:
 * - Successful result parsing
 * - safeLimit honoured by the worker
 * - Error propagation from the worker
 * - "No module configured" error envelope
 * - Timeout when the worker sleeps too long
 * - Interrupt via AbortSignal
 *
 * Constraints: TS strict + noUncheckedIndexedAccess + ESM.
 */
import { describe, it, expect } from "vitest";
import {
  boundedSearch,
  SearchTimeoutError,
  SearchInterruptedError,
} from "./bounded-search.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "__fixtures__");

const mockSuccess = join(fixtures, "mock-success.mjs");
const mockError = join(fixtures, "mock-error.mjs");
const mockSleep = join(fixtures, "mock-sleep.mjs");

describe("boundedSearch", () => {
  // ── Successful search ───────────────────────────────────────────────────

  it("returns parsed results from the worker", async () => {
    const result = await boundedSearch("hello world", 3, {
      searchModule: mockSuccess,
    });

    expect(result.ok).toBe(true);
    expect(result.results).toHaveLength(3);

    const first = result.results?.[0];
    expect(first).toBeDefined();
    expect(first?.position).toBe(1);
    expect(first?.title).toContain("hello world");
    expect(first?.url).toMatch(/^https?:\/\//);
  });

  it("respects safeLimit", async () => {
    const result = await boundedSearch("test query", 2, {
      searchModule: mockSuccess,
    });

    expect(result.ok).toBe(true);
    expect(result.results).toHaveLength(2);
  });

  it("uses default safeLimit of 5 when omitted", async () => {
    const result = await boundedSearch("defaults", undefined, {
      searchModule: mockSuccess,
    });

    expect(result.ok).toBe(true);
    // mock-success caps at 3, so default of 5 yields 3 results.
    expect(result.results).toHaveLength(3);
  });

  // ── Error propagation ────────────────────────────────────────────────────

  it("propagates worker errors as { ok: false }", async () => {
    const result = await boundedSearch("test", 5, {
      searchModule: mockError,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Mock search failure");
    expect(result.error).toContain("TypeError");
  });

  it("returns { ok: false } when no search module is configured", async () => {
    const result = await boundedSearch("test", 5);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("No search module");
  });

  // ── Timeout ───────────────────────────────────────────────────────────────

  it("times out when the worker sleeps too long", async () => {
    await expect(
      boundedSearch("slow query", 3, {
        searchModule: mockSleep,
        timeoutMs: 500,
      }),
    ).rejects.toThrow(SearchTimeoutError);
  });

  // ── Interrupt ─────────────────────────────────────────────────────────────

  it("interrupts via AbortSignal", async () => {
    const controller = new AbortController();
    const promise = boundedSearch("interrupt me", 3, {
      searchModule: mockSleep,
      signal: controller.signal,
      timeoutMs: 30_000, // long — abort should fire first
    });

    // Abort shortly after start (well within the 30s deadline).
    setTimeout(() => controller.abort(), 200);

    await expect(promise).rejects.toThrow(SearchInterruptedError);
  });
});

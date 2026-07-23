import { describe, it, expect, vi, afterEach } from "vitest";
import { exitAfterGracefulShutdown } from "./exit.js";

/**
 * Tests for `exitAfterGracefulShutdown` (deep-dive.md §6.5).
 *
 * `process.exit` is mocked to throw — the real call would terminate vitest.
 */
describe("exitAfterGracefulShutdown", () => {
  const originalExit = process.exit;

  afterEach(() => {
    process.exit = originalExit;
  });

  it("calls all teardown hooks then process.exit", () => {
    const order: string[] = [];
    const removePidFile = vi.fn(() => order.push("removePidFile"));
    const releaseLock = vi.fn(() => order.push("releaseLock"));
    const drainLogQueue = vi.fn((ms: number) => order.push(`drainLogQueue:${ms}`));

    process.exit = vi.fn((() => {
      throw new Error("__MOCK_EXIT__");
    }) as never) as typeof process.exit;

    expect(() =>
      exitAfterGracefulShutdown(0, { removePidFile, releaseLock, drainLogQueue }),
    ).toThrow("__MOCK_EXIT__");

    expect(process.exit).toHaveBeenCalledWith(0);
    expect(removePidFile).toHaveBeenCalledOnce();
    expect(releaseLock).toHaveBeenCalledOnce();
    expect(drainLogQueue).toHaveBeenCalledWith(1000);
  });

  it("releases locks BEFORE draining logs", () => {
    const order: string[] = [];
    const removePidFile = vi.fn(() => order.push("removePidFile"));
    const releaseLock = vi.fn(() => order.push("releaseLock"));
    const drainLogQueue = vi.fn(() => order.push("drainLogQueue"));

    process.exit = vi.fn((() => {
      throw new Error("__MOCK_EXIT__");
    }) as never) as typeof process.exit;

    expect(() =>
      exitAfterGracefulShutdown(1, { removePidFile, releaseLock, drainLogQueue }),
    ).toThrow("__MOCK_EXIT__");

    // removePidFile and releaseLock must come before drainLogQueue.
    expect(order).toEqual(["removePidFile", "releaseLock", "drainLogQueue"]);
  });

  it("works with no options (no hooks)", () => {
    process.exit = vi.fn((() => {
      throw new Error("__MOCK_EXIT__");
    }) as never) as typeof process.exit;

    expect(() => exitAfterGracefulShutdown(2)).toThrow("__MOCK_EXIT__");
    expect(process.exit).toHaveBeenCalledWith(2);
  });

  it("passes the exit code through", () => {
    process.exit = vi.fn((() => {
      throw new Error("__MOCK_EXIT__");
    }) as never) as typeof process.exit;

    for (const code of [0, 1, 42, 130]) {
      expect(() => exitAfterGracefulShutdown(code)).toThrow("__MOCK_EXIT__");
      expect(process.exit).toHaveBeenLastCalledWith(code);
    }
  });
});

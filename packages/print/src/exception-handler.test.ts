/**
 * P7 (shard 07) — process-level exception handler tests.
 *
 * Tests: mock process.on, trigger rejection, verify classification; trigger
 * exception, verify exit behavior.
 */
import { describe, it, expect, vi } from "vitest";
import {
  classifyError,
  installExceptionHandlers,
} from "./exception-handler.js";

describe("[unit] classifyError", () => {
  it("OOM → fatal", () => {
    const c = classifyError(new Error("JavaScript heap out of memory"), "uncaughtException");
    expect(c.severity).toBe("fatal");
  });

  it("allocation failed → fatal", () => {
    const c = classifyError(new Error("memory allocation failed"), "uncaughtException");
    expect(c.severity).toBe("fatal");
  });

  it("max call stack → fatal", () => {
    const c = classifyError(new RangeError("Maximum call stack size exceeded"), "uncaughtException");
    expect(c.severity).toBe("fatal");
  });

  it("explicit fatal flag → fatal", () => {
    const err = Object.assign(new Error("custom"), { fatal: true });
    const c = classifyError(err, "unhandledRejection");
    expect(c.severity).toBe("fatal");
  });

  it("ECONNREFUSED → transient", () => {
    const c = classifyError(new Error("connect ECONNREFUSED 127.0.0.1:443"), "unhandledRejection");
    expect(c.severity).toBe("transient");
  });

  it("ETIMEDOUT → transient", () => {
    const c = classifyError(new Error("connect ETIMEDOUT"), "unhandledRejection");
    expect(c.severity).toBe("transient");
  });

  it("rate limit → transient", () => {
    const c = classifyError(new Error("rate limit exceeded (429)"), "unhandledRejection");
    expect(c.severity).toBe("transient");
  });

  it("timeout → transient", () => {
    const c = classifyError(new Error("request timeout"), "unhandledRejection");
    expect(c.severity).toBe("transient");
  });

  it("default unhandledRejection → transient", () => {
    const c = classifyError(new Error("something weird happened"), "unhandledRejection");
    expect(c.severity).toBe("transient");
  });

  it("default uncaughtException → fatal", () => {
    const c = classifyError(new Error("something weird happened"), "uncaughtException");
    expect(c.severity).toBe("fatal");
  });
});

describe("[unit] installExceptionHandlers", () => {
  it("registers handlers on the process-like object", () => {
    const events: Record<string, ((...a: unknown[]) => void) | undefined> = {};
    const mockProc = {
      on(event: string, listener: (...a: unknown[]) => void) {
        events[event] = listener;
      },
      removeListener(event: string, listener: (...a: unknown[]) => void) {
        if (events[event] === listener) events[event] = undefined;
      },
    };
    const handle = installExceptionHandlers({ proc: mockProc });
    expect(events["unhandledRejection"]).toBeDefined();
    expect(events["uncaughtException"]).toBeDefined();
    handle.dispose();
    expect(events["unhandledRejection"]).toBeUndefined();
    expect(events["uncaughtException"]).toBeUndefined();
  });

  it("transient rejection → logged, NOT exited", () => {
    const transientLogs: string[] = [];
    let exitCalled = false;
    const events: Record<string, ((...a: unknown[]) => void) | undefined> = {};
    const mockProc = {
      on(event: string, listener: (...a: unknown[]) => void) {
        events[event] = listener;
      },
      removeListener() {},
    };
    const handle = installExceptionHandlers({
      proc: mockProc,
      logTransient: (msg) => transientLogs.push(msg),
      exit: () => { exitCalled = true; },
    });
    // Trigger a transient rejection.
    events["unhandledRejection"]?.(new Error("connect ECONNREFUSED"));
    expect(transientLogs.length).toBe(1);
    expect(transientLogs[0]).toContain("transient");
    expect(exitCalled).toBe(false);
    handle.dispose();
  });

  it("fatal rejection → logged + exited", () => {
    const fatalLogs: string[] = [];
    let exitCode: number | null = null;
    const events: Record<string, ((...a: unknown[]) => void) | undefined> = {};
    const mockProc = {
      on(event: string, listener: (...a: unknown[]) => void) {
        events[event] = listener;
      },
      removeListener() {},
    };
    const handle = installExceptionHandlers({
      proc: mockProc,
      logFatal: (msg) => fatalLogs.push(msg),
      exit: (code) => { exitCode = code; },
    });
    // Trigger a fatal rejection (OOM).
    events["unhandledRejection"]?.(new Error("heap out of memory"));
    expect(fatalLogs.length).toBe(1);
    expect(fatalLogs[0]).toContain("FATAL");
    expect(exitCode).toBe(1);
    handle.dispose();
  });

  it("transient uncaughtException → logged, NOT exited", () => {
    const transientLogs: string[] = [];
    let exitCalled = false;
    const events: Record<string, ((...a: unknown[]) => void) | undefined> = {};
    const mockProc = {
      on(event: string, listener: (...a: unknown[]) => void) {
        events[event] = listener;
      },
      removeListener() {},
    };
    const handle = installExceptionHandlers({
      proc: mockProc,
      logTransient: (msg) => transientLogs.push(msg),
      exit: () => { exitCalled = true; },
    });
    // Even an uncaughtException can be transient (ECONNREFUSED).
    events["uncaughtException"]?.(new Error("ECONNREFUSED"));
    expect(transientLogs.length).toBe(1);
    expect(exitCalled).toBe(false);
    handle.dispose();
  });

  it("default uncaughtException → fatal → exited", () => {
    const fatalLogs: string[] = [];
    let exitCode: number | null = null;
    const events: Record<string, ((...a: unknown[]) => void) | undefined> = {};
    const mockProc = {
      on(event: string, listener: (...a: unknown[]) => void) {
        events[event] = listener;
      },
      removeListener() {},
    };
    const handle = installExceptionHandlers({
      proc: mockProc,
      logFatal: (msg) => fatalLogs.push(msg),
      exit: (code) => { exitCode = code; },
    });
    events["uncaughtException"]?.(new Error("unexpected TypeError: undefined.foo"));
    expect(fatalLogs.length).toBe(1);
    expect(exitCode).toBe(1);
    handle.dispose();
  });

  it("classification records are accumulated for observability", () => {
    const events: Record<string, ((...a: unknown[]) => void) | undefined> = {};
    const mockProc = {
      on(event: string, listener: (...a: unknown[]) => void) {
        events[event] = listener;
      },
      removeListener() {},
    };
    const handle = installExceptionHandlers({ proc: mockProc, exit: () => {} });
    events["unhandledRejection"]?.(new Error("timeout"));
    events["unhandledRejection"]?.(new Error("heap out of memory"));
    expect(handle.classifications.length).toBe(2);
    expect(handle.classifications[0]?.severity).toBe("transient");
    expect(handle.classifications[1]?.severity).toBe("fatal");
    handle.dispose();
  });
});

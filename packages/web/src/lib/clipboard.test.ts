// @vitest-environment jsdom
/**
 * Clipboard copy helper unit tests.
 *
 * Covers: secure-context path (Clipboard API), fallback path
 * (execCommand via off-screen textarea), and return-value correctness.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { copyTextToClipboard } from "@/lib/clipboard";

/** Helper: (re)define a read-only-ish configurable property. */
function defineProp<T>(obj: object, key: string, value: T): void {
  Object.defineProperty(obj, key, { value, configurable: true, writable: true });
}

/** jsdom lacks `document.execCommand`, so install a configurable mock. */
function mockExecCommand(impl: (cmd: string) => boolean): ReturnType<typeof vi.fn> {
  const fn = vi.fn(impl);
  defineProp(document, "execCommand", fn);
  return fn;
}

describe("[unit] clipboard — secure-context path", () => {
  const originalClipboard = navigator.clipboard;

  afterEach(() => {
    // Restore clipboard.
    defineProp(navigator, "clipboard", originalClipboard);
    Object.defineProperty(window, "isSecureContext", {
      value: false,
      configurable: true,
    });
  });

  it("uses navigator.clipboard.writeText and returns true", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    defineProp(navigator, "clipboard", { writeText });
    Object.defineProperty(window, "isSecureContext", {
      value: true,
      configurable: true,
    });

    const ok = await copyTextToClipboard("hello");
    expect(ok).toBe(true);
    expect(writeText).toHaveBeenCalledWith("hello");
  });

  it("falls back to execCommand when writeText rejects", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    defineProp(navigator, "clipboard", { writeText });
    Object.defineProperty(window, "isSecureContext", {
      value: true,
      configurable: true,
    });
    const exec = mockExecCommand(() => true);

    const ok = await copyTextToClipboard("hello");
    expect(ok).toBe(true);
    expect(exec).toHaveBeenCalledWith("copy");
  });
});

describe("[unit] clipboard — fallback path", () => {
  beforeEach(() => {
    Object.defineProperty(window, "isSecureContext", {
      value: false,
      configurable: true,
    });
    // No Clipboard API in fallback scenario.
    defineProp(navigator, "clipboard", undefined);
  });

  it("appends a textarea, calls execCommand('copy'), and cleans up", async () => {
    const exec = mockExecCommand(() => true);

    const before = document.querySelectorAll("textarea").length;
    const ok = await copyTextToClipboard("payload");
    const after = document.querySelectorAll("textarea").length;

    expect(ok).toBe(true);
    expect(exec).toHaveBeenCalledWith("copy");
    // textarea is removed after copy (no leftover DOM node)
    expect(after).toBe(before);
  });

  it("returns false when execCommand returns false", async () => {
    mockExecCommand(() => false);
    const ok = await copyTextToClipboard("payload");
    expect(ok).toBe(false);
  });

  it("returns false when execCommand throws", async () => {
    mockExecCommand(() => {
      throw new Error("not implemented");
    });
    const ok = await copyTextToClipboard("payload");
    expect(ok).toBe(false);
  });
});

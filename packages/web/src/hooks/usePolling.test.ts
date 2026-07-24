// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePolling } from "./usePolling";

describe("[unit] usePolling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires the callback immediately on mount (default)", () => {
    const cb = vi.fn();
    renderHook(() => usePolling(cb, 1000));
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("does not fire immediately when immediate=false", async () => {
    const cb = vi.fn();
    renderHook(() => usePolling(cb, 1000, { immediate: false }));
    expect(cb).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("polls repeatedly at the given interval", async () => {
    const cb = vi.fn();
    renderHook(() => usePolling(cb, 1000));
    expect(cb).toHaveBeenCalledTimes(1); // immediate

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(cb).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(cb).toHaveBeenCalledTimes(3);
  });

  it("stops polling after unmount (cleanup)", async () => {
    const cb = vi.fn();
    const { unmount } = renderHook(() => usePolling(cb, 1000));
    expect(cb).toHaveBeenCalledTimes(1);

    unmount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("waits for async callback to settle before scheduling next tick", async () => {
    let resolveFn: (() => void) | null = null;
    const cb = vi.fn(() => {
      return new Promise<void>((resolve) => {
        resolveFn = resolve;
      });
    });

    renderHook(() => usePolling(cb, 500, { immediate: false }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(cb).toHaveBeenCalledTimes(1);

    // While the promise is pending, advancing time should NOT schedule
    // another call (recursive setTimeout waits for resolution).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(cb).toHaveBeenCalledTimes(1);

    // Resolve the pending promise.
    await act(async () => {
      resolveFn?.();
      await vi.runAllTicks();
    });

    // Now the next tick can be scheduled.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it("does not poll when enabled=false", async () => {
    const cb = vi.fn();
    renderHook(() => usePolling(cb, 1000, { enabled: false }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(cb).not.toHaveBeenCalled();
  });

  it("uses the latest callback even if the reference changes", async () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    const { rerender } = renderHook(({ cb }) => usePolling(cb, 1000), {
      initialProps: { cb: cb1 },
    });

    expect(cb1).toHaveBeenCalledTimes(1);

    // Rerender with a new callback — the effect should NOT restart (no double-fire),
    // but the next tick should use the new callback.
    rerender({ cb: cb2 });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(cb1).toHaveBeenCalledTimes(1); // not called again
    expect(cb2).toHaveBeenCalledTimes(1); // new callback used
  });

  it("swallows errors from the callback and keeps polling", async () => {
    const cb = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValue(undefined);
    renderHook(() => usePolling(cb, 500, { immediate: false }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(cb).toHaveBeenCalledTimes(1); // errored

    // Next tick still fires despite the previous error.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(cb).toHaveBeenCalledTimes(2);
  });
});

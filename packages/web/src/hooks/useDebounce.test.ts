// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDebouncedValue } from "./useDebounce";

describe("[unit] useDebouncedValue", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the initial value immediately (no leading delay)", () => {
    const { result } = renderHook(() => useDebouncedValue("init", 300));
    expect(result.current).toBe("init");
  });

  it("does not update until the delay elapses", () => {
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 300), {
      initialProps: { v: "init" },
    });

    rerender({ v: "next" });
    // Still the old value before the timer fires.
    expect(result.current).toBe("init");

    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(result.current).toBe("init");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe("next");
  });

  it("rapid successive changes only emit the last value", () => {
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 300), {
      initialProps: { v: "a" },
    });

    rerender({ v: "b" });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    rerender({ v: "c" });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    rerender({ v: "d" });
    // The delay restarts on each change, so we haven't hit 300ms yet.
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current).toBe("a");

    // Now the full 300ms elapse without further changes.
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current).toBe("d");
  });

  it("clears the pending timeout on unmount (no stale update)", () => {
    const { result, unmount, rerender } = renderHook(
      ({ v }) => useDebouncedValue(v, 300),
      { initialProps: { v: "init" } },
    );

    rerender({ v: "next" });
    // Debounced value is still the old one — the timer hasn't fired.
    expect(result.current).toBe("init");
    unmount();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    // No state update ran after unmount — the value never became "next".
    expect(result.current).toBe("init");
  });

  it("updates immediately when delay is 0", () => {
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 0), {
      initialProps: { v: "a" },
    });

    rerender({ v: "b" });
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(result.current).toBe("b");
  });

  it("re-debounces when the delay changes", () => {
    const { result, rerender } = renderHook(
      ({ v, d }) => useDebouncedValue(v, d),
      { initialProps: { v: "a", d: 300 } },
    );

    rerender({ v: "b", d: 300 });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    // Change the delay — the timer resets for the new interval.
    rerender({ v: "b", d: 500 });
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(result.current).toBe("a");

    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current).toBe("b");
  });
});

// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useAsync } from "./useAsync.js";

describe("[unit] useAsync hook", () => {
  it("starts loading + resolves data", async () => {
    const { result } = renderHook(() => useAsync(async () => "hello"));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBe("hello");
    expect(result.current.error).toBeNull();
  });

  it("captures errors", async () => {
    const { result } = renderHook(() => useAsync(async () => { throw new Error("boom"); }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("boom");
    expect(result.current.data).toBeNull();
  });

  it("reload re-fetches", async () => {
    let callCount = 0;
    const { result } = renderHook(() => useAsync(async () => { callCount++; return callCount; }));
    await waitFor(() => expect(result.current.data).toBe(1));
    result.current.reload();
    await waitFor(() => expect(result.current.data).toBe(2));
  });

  it("deps change triggers refetch", async () => {
    const { result, rerender } = renderHook(({ id }) => useAsync(async () => id, [id]), { initialProps: { id: "a" } });
    await waitFor(() => expect(result.current.data).toBe("a"));
    rerender({ id: "b" });
    await waitFor(() => expect(result.current.data).toBe("b"));
  });
});

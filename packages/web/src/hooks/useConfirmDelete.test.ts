// @vitest-environment jsdom
/**
 * useConfirmDelete — request/cancel/confirm flow, isOpen state, type safety.
 */
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useConfirmDelete } from "./useConfirmDelete";

describe("[unit] useConfirmDelete", () => {
  it("starts closed with a null target", () => {
    const { result } = renderHook(() => useConfirmDelete<string>());
    expect(result.current.deleteTarget).toBeNull();
    expect(result.current.isOpen).toBe(false);
  });

  it("requestDelete stages the target and opens the dialog", () => {
    const { result } = renderHook(() => useConfirmDelete<string>());
    act(() => {
      result.current.requestDelete("srv-1");
    });
    expect(result.current.deleteTarget).toBe("srv-1");
    expect(result.current.isOpen).toBe(true);
  });

  it("confirmDelete returns the staged target and closes", () => {
    const { result } = renderHook(() => useConfirmDelete<number>());
    act(() => {
      result.current.requestDelete(42);
    });
    let confirmed: number | null = null;
    act(() => {
      confirmed = result.current.confirmDelete();
    });
    expect(confirmed).toBe(42);
    expect(result.current.deleteTarget).toBeNull();
    expect(result.current.isOpen).toBe(false);
  });

  it("confirmDelete returns null when nothing is staged", () => {
    const { result } = renderHook(() => useConfirmDelete<string>());
    let confirmed: string | null = "untouched";
    act(() => {
      confirmed = result.current.confirmDelete();
    });
    expect(confirmed).toBeNull();
    expect(result.current.isOpen).toBe(false);
  });

  it("cancelDelete discards the target without confirming", () => {
    const { result } = renderHook(() => useConfirmDelete<string>());
    act(() => {
      result.current.requestDelete("to-discard");
    });
    expect(result.current.isOpen).toBe(true);
    act(() => {
      result.current.cancelDelete();
    });
    expect(result.current.deleteTarget).toBeNull();
    expect(result.current.isOpen).toBe(false);
  });

  it("requestDelete replaces a previously staged target", () => {
    const { result } = renderHook(() => useConfirmDelete<string>());
    act(() => {
      result.current.requestDelete("first");
    });
    act(() => {
      result.current.requestDelete("second");
    });
    expect(result.current.deleteTarget).toBe("second");
    let confirmed: string | null = null;
    act(() => {
      confirmed = result.current.confirmDelete();
    });
    expect(confirmed).toBe("second");
  });

  it("preserves full object targets (type safety over entities)", () => {
    interface Row {
      id: string;
      name: string;
    }
    const { result } = renderHook(() => useConfirmDelete<Row>());
    const row: Row = { id: "abc", name: "My Job" };
    act(() => {
      result.current.requestDelete(row);
    });
    expect(result.current.deleteTarget).toEqual(row);
    let confirmed: Row | null = null;
    act(() => {
      confirmed = result.current.confirmDelete();
    });
    expect(confirmed).toEqual(row);
    expect(result.current.deleteTarget).toBeNull();
  });

  it("confirmDelete then cancelDelete is a safe no-op sequence", () => {
    const { result } = renderHook(() => useConfirmDelete<string>());
    act(() => {
      result.current.requestDelete("x");
    });
    act(() => {
      result.current.confirmDelete();
    });
    // Already cleared — cancelling again must not throw or re-open.
    act(() => {
      result.current.cancelDelete();
    });
    expect(result.current.isOpen).toBe(false);
    expect(result.current.deleteTarget).toBeNull();
  });
});

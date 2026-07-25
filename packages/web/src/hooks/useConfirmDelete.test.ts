// @vitest-environment jsdom
/**
 * useConfirmDelete — centralized pending-delete + async lifecycle.
 *
 * Tests: request/cancel/confirm flow, isOpen state, isDeleting loading state,
 * throw-keeps-dialog-open error handling, type safety.
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useConfirmDelete } from "./useConfirmDelete";

describe("[unit] useConfirmDelete", () => {
  it("starts closed with a null target", () => {
    const { result } = renderHook(() =>
      useConfirmDelete<string>({ onDelete: vi.fn() }),
    );
    expect(result.current.deleteTarget).toBeNull();
    expect(result.current.isOpen).toBe(false);
    expect(result.current.isDeleting).toBe(false);
  });

  it("requestDelete stages the target and opens the dialog", () => {
    const { result } = renderHook(() =>
      useConfirmDelete<string>({ onDelete: vi.fn() }),
    );
    act(() => {
      result.current.requestDelete("srv-1");
    });
    expect(result.current.deleteTarget).toBe("srv-1");
    expect(result.current.isOpen).toBe(true);
  });

  it("confirmDelete calls onDelete and closes on success", async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useConfirmDelete<string>({ onDelete }),
    );
    act(() => result.current.requestDelete("target-1"));
    await act(async () => {
      await result.current.confirmDelete();
    });
    expect(onDelete).toHaveBeenCalledWith("target-1");
    expect(result.current.deleteTarget).toBeNull();
    expect(result.current.isOpen).toBe(false);
    expect(result.current.isDeleting).toBe(false);
  });

  it("confirmDelete is a no-op when nothing is staged", async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useConfirmDelete<string>({ onDelete }),
    );
    await act(async () => {
      await result.current.confirmDelete();
    });
    expect(onDelete).not.toHaveBeenCalled();
    expect(result.current.isOpen).toBe(false);
  });

  it("isDeleting is true during onDelete, false after", async () => {
    let resolveFn: (() => void) | null = null;
    const onDelete = vi.fn().mockImplementation(
      () => new Promise<void>((resolve) => { resolveFn = resolve; }),
    );
    const { result } = renderHook(() =>
      useConfirmDelete<string>({ onDelete }),
    );
    act(() => result.current.requestDelete("x"));
    let confirmPromise!: Promise<void>;
    act(() => { confirmPromise = result.current.confirmDelete(); });
    expect(result.current.isDeleting).toBe(true);
    await act(async () => {
      resolveFn!();
      await confirmPromise;
    });
    expect(result.current.isDeleting).toBe(false);
  });

  it("throw in onDelete keeps dialog open (retry possible)", async () => {
    const onDelete = vi.fn().mockRejectedValue(new Error("network"));
    const { result } = renderHook(() =>
      useConfirmDelete<string>({ onDelete }),
    );
    act(() => result.current.requestDelete("doomed"));
    await act(async () => {
      await result.current.confirmDelete().catch(() => {});
    });
    expect(onDelete).toHaveBeenCalledWith("doomed");
    expect(result.current.deleteTarget).toBe("doomed");
    expect(result.current.isOpen).toBe(true);
    expect(result.current.isDeleting).toBe(false);
  });

  it("cancelDelete discards the target without confirming", () => {
    const { result } = renderHook(() =>
      useConfirmDelete<string>({ onDelete: vi.fn() }),
    );
    act(() => result.current.requestDelete("to-discard"));
    expect(result.current.isOpen).toBe(true);
    act(() => result.current.cancelDelete());
    expect(result.current.deleteTarget).toBeNull();
    expect(result.current.isOpen).toBe(false);
  });

  it("cancelDelete is blocked while deleting", () => {
    let resolveFn: (() => void) | null = null;
    const onDelete = vi.fn().mockImplementation(
      () => new Promise<void>((resolve) => { resolveFn = resolve; }),
    );
    const { result } = renderHook(() =>
      useConfirmDelete<string>({ onDelete }),
    );
    act(() => result.current.requestDelete("x"));
    act(() => { void result.current.confirmDelete(); });
    expect(result.current.isDeleting).toBe(true);
    act(() => result.current.cancelDelete());
    // Still open — cancel blocked during deletion
    expect(result.current.isOpen).toBe(true);
    // Cleanup
    act(() => resolveFn!());
  });

  it("requestDelete replaces a previously staged target", () => {
    const { result } = renderHook(() =>
      useConfirmDelete<string>({ onDelete: vi.fn() }),
    );
    act(() => result.current.requestDelete("first"));
    act(() => result.current.requestDelete("second"));
    expect(result.current.deleteTarget).toBe("second");
  });

  it("preserves full object targets (type safety over entities)", () => {
    interface Row { id: string; name: string }
    const row: Row = { id: "abc", name: "My Job" };
    const { result } = renderHook(() =>
      useConfirmDelete<Row>({ onDelete: vi.fn() }),
    );
    act(() => result.current.requestDelete(row));
    expect(result.current.deleteTarget).toEqual(row);
  });
});

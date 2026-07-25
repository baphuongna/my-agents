/**
 * useConfirmDelete — centralize pending-delete state + dialog open/close.
 *
 * Port of Hermes's `useConfirmDelete` pattern (CronPage / WebhooksPage /
 * SystemPage): instead of each page declaring its own ad-hoc
 * `pendingDelete`/`confirmDelete`/`deleteConfirm` boolean-or-id state, this
 * hook owns the pending target and exposes a uniform request/cancel/confirm
 * surface.
 *
 * Semantics:
 * - `requestDelete(target)` stages a target and opens the dialog (`isOpen`).
 * - `confirmDelete()` returns the staged target (or `null` if none) and
 *   clears the pending state — the caller performs the actual destructive
 *   work with the returned value.
 * - `cancelDelete()` discards the pending target without side effects.
 *
 * Generic over `T` so each page can bind the target to its own row type
 * (id string, full entity, etc.) with full type safety.
 */
import { useCallback, useState } from "react";

export interface UseConfirmDeleteResult<T> {
  /** The currently staged deletion target, or `null` when the dialog is closed. */
  deleteTarget: T | null;
  /** Stage `target` for deletion and open the confirm dialog. */
  requestDelete: (target: T) => void;
  /** Discard the staged target and close the dialog. */
  cancelDelete: () => void;
  /** Return the staged target (or `null`) and clear pending state. */
  confirmDelete: () => T | null;
  /** `true` while a target is staged (dialog should be open). */
  isOpen: boolean;
}

export function useConfirmDelete<T>(): UseConfirmDeleteResult<T> {
  const [deleteTarget, setDeleteTarget] = useState<T | null>(null);

  const requestDelete = useCallback((target: T) => {
    setDeleteTarget(target);
  }, []);

  const cancelDelete = useCallback(() => {
    setDeleteTarget(null);
  }, []);

  const confirmDelete = useCallback((): T | null => {
    const target = deleteTarget;
    setDeleteTarget(null);
    return target;
  }, [deleteTarget]);

  return {
    deleteTarget,
    requestDelete,
    cancelDelete,
    confirmDelete,
    isOpen: deleteTarget !== null,
  };
}

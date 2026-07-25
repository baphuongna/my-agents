/**
 * useConfirmDelete — centralized pending-delete state + async deletion lifecycle.
 *
 * Port of Hermes's `useConfirmDelete` pattern: the hook owns the pending
 * target, the confirm/cancel flow, AND the async deletion lifecycle (loading
 * state + error-preserves-dialog). This eliminates per-page ad-hoc
 * `pendingDelete`/`deleting`/`isDeleting` boilerplate.
 *
 * Semantics:
 * - `requestDelete(target)` stages a target and opens the dialog (`isOpen`).
 * - `confirmDelete()` calls `onDelete(target)`:
 *   - On success → clears pending state, dialog closes.
 *   - On throw → keeps dialog open (`isDeleting` resets to false) so the user
 *     can retry or cancel. The error propagates to the caller for toast display.
 * - `cancelDelete()` discards the pending target without side effects.
 * - `isDeleting` is `true` while `onDelete` is in-flight (disable buttons).
 *
 * Generic over `T` so each page can bind the target to its own row type
 * (id string, full entity, Set of ids, etc.) with full type safety.
 */
import { useCallback, useRef, useState } from "react";

export interface UseConfirmDeleteOptions<T> {
  /** Async deletion handler. Throwing keeps the dialog open for retry. */
  onDelete: (target: T) => Promise<void>;
}

export interface UseConfirmDeleteResult<T> {
  /** The currently staged deletion target, or `null` when the dialog is closed. */
  deleteTarget: T | null;
  /** Stage `target` for deletion and open the confirm dialog. */
  requestDelete: (target: T) => void;
  /** Discard the staged target and close the dialog. */
  cancelDelete: () => void;
  /** Call `onDelete(target)`. On success closes dialog; on throw keeps it open. */
  confirmDelete: () => Promise<void>;
  /** `true` while a target is staged (dialog should be open). */
  isOpen: boolean;
  /** `true` while `onDelete` is in-flight (disable confirm/cancel buttons). */
  isDeleting: boolean;
}

export function useConfirmDelete<T>(options: UseConfirmDeleteOptions<T>): UseConfirmDeleteResult<T> {
  const onDeleteRef = useRef(options.onDelete);
  onDeleteRef.current = options.onDelete;

  const [deleteTarget, setDeleteTarget] = useState<T | null>(null);
  const [isDeleting, setDeleting] = useState(false);

  const requestDelete = useCallback((target: T) => {
    setDeleteTarget(target);
  }, []);

  const cancelDelete = useCallback(() => {
    if (!isDeleting) setDeleteTarget(null);
  }, [isDeleting]);

  const confirmDelete = useCallback(async (): Promise<void> => {
    const target = deleteTarget;
    if (target === null) return;
    setDeleting(true);
    try {
      await onDeleteRef.current(target);
      setDeleteTarget(null); // success → close dialog
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget]);

  return {
    deleteTarget,
    requestDelete,
    cancelDelete,
    confirmDelete,
    isOpen: deleteTarget !== null,
    isDeleting,
  };
}

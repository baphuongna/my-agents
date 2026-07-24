/**
 * DeleteConfirmDialog — thin wrapper on ConfirmDialog preconfigured for
 * destructive delete actions: `destructive` is forced on, with sensible
 * default labels ("Delete" / "Cancel"). All other ConfirmDialog props pass
 * through unchanged.
 *
 * Port of Hermes DeleteConfirmDialog (minus the i18n dependency — mya uses
 * static defaults here).
 */
import { type ReactNode } from "react";
import { ConfirmDialog } from "./ConfirmDialog";

export interface DeleteConfirmDialogProps {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DeleteConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  loading = false,
  onConfirm,
  onCancel,
}: DeleteConfirmDialogProps) {
  return (
    <ConfirmDialog
      open={open}
      title={title}
      description={description}
      confirmLabel={confirmLabel}
      cancelLabel={cancelLabel}
      destructive
      loading={loading}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}

/**
 * ConfirmDialog — portal modal for confirmation flows.
 *
 * Full-featured companion to the lightweight `ConfirmDialog` in `lib/modal.tsx`:
 * this variant adds a `loading` state (async confirm), a dedicated `onCancel`
 * handler, and a configurable cancel label, so the parent keeps full control of
 * open/close lifecycle (e.g. keep the dialog mounted while a request is in
 * flight, then close it once the promise resolves). Shared modal behavior
 * (Escape, scroll lock, focus restore + trap) is delegated to `useModalBehavior`
 * from `@/lib/modal`.
 *
 * Port of Hermes ConfirmDialog — adapted to mya's glass/dark aesthetic + button
 * classes (`btn-primary` / `btn-danger` / `btn-secondary`).
 */
import { type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle } from "lucide-react";
import { useModalBehavior } from "@/lib/modal";
import { MODAL_BACKDROP, MODAL_PANEL } from "@/lib/modal-constants";
import { cn, themedFont } from "@/lib/utils";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  // Escape / scroll-lock / focus-restore handled centrally by the hook.
  // `onCancel` is the dismiss path for both Escape and backdrop clicks.
  const containerRef = useModalBehavior(open, onCancel);

  if (!open) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      aria-describedby={description ? "confirm-dialog-desc" : undefined}
      className={MODAL_BACKDROP}
      onClick={(e) => {
        // Backdrop click (the overlay itself, not its children) dismisses.
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        ref={containerRef}
        className={cn(MODAL_PANEL, "max-w-sm p-5")}
      >
        <div className="flex items-start gap-3">
          {destructive && (
            <div className="w-8 h-8 rounded-full bg-danger/10 flex items-center justify-center shrink-0">
              <AlertTriangle size={16} className="text-danger" />
            </div>
          )}
          <div className="flex-1 min-w-0 flex flex-col gap-1">
            <h2 id="confirm-dialog-title" className={cn("text-sm font-semibold text-fg", themedFont)}>
              {title}
            </h2>
            {description && (
              <p
                id="confirm-dialog-desc"
                className="text-xs text-fg-muted leading-relaxed whitespace-pre-line"
              >
                {description}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 mt-5">
          <button
            type="button"
            className="btn-secondary"
            onClick={onCancel}
            disabled={loading}
            data-cancel
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            data-confirm
            className={cn(destructive ? "btn-danger" : "btn-primary")}
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? "…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

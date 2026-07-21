/**
 * Modal/Dialog system — portal-based with escape/scroll-lock/focus-restore.
 * Port of Hermes useModalBehavior + ConfirmDialog patterns.
 */
import {
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, X } from "lucide-react";
import { cn } from "./utils";

/** Shared hook: escape key, scroll lock, focus management. */
export function useModalBehavior(open: boolean, onClose: () => void) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const prevActive = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      prevActive?.focus?.();
    };
  }, [open, onClose]);

  return containerRef;
}

/** Full modal dialog — backdrop + centered panel. */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  maxWidth = "max-w-lg",
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
  maxWidth?: string;
}) {
  useModalBehavior(open, onClose);
  if (!open) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={cn(
          "w-full bg-bg-surface border border-border rounded-xl shadow-2xl flex flex-col max-h-[85vh]",
          maxWidth,
        )}
      >
        {title && (
          <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
            <h2 className="text-sm font-semibold text-fg">{title}</h2>
            <button
              onClick={onClose}
              className="text-fg-muted hover:text-fg p-1 rounded hover:bg-bg-elevated"
            >
              <X size={16} />
            </button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** Confirm dialog — for destructive actions. */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Confirm",
  destructive = false,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  destructive?: boolean;
}) {
  useModalBehavior(open, onClose);
  if (!open) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-sm bg-bg-surface border border-border rounded-xl shadow-2xl p-5">
        <div className="flex items-start gap-3">
          {destructive && (
            <div className="w-8 h-8 rounded-full bg-danger/10 flex items-center justify-center shrink-0">
              <AlertTriangle size={16} className="text-danger" />
            </div>
          )}
          <div className="flex-1">
            <h2 className="text-sm font-semibold text-fg mb-1">{title}</h2>
            {description && <p className="text-xs text-fg-muted">{description}</p>}
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 mt-5">
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className={destructive ? "btn-danger" : "btn-primary"}
            onClick={() => {
              onConfirm();
              onClose();
            }}
            data-confirm
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

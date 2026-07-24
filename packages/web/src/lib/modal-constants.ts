/**
 * Shared modal CSS class constants.
 *
 * Port of Hermes `lib/dashboard-modal-shell.ts`. Centralises the backdrop and
 * panel classes used by portal modals (ConfirmDialog, ConsoleModal, etc.) so
 * that z-index, background opacity, and panel styling stay consistent across
 * every dialog. Extracted here to avoid copy-pasted class strings drifting
 * apart as new modals are added.
 *
 * Callers must `createPortal(..., document.body)` — `z-[300]` alone cannot
 * escape a parent's stacking context.
 */

/** Backdrop overlay: full-screen, centered, dark scrim with blur. */
export const MODAL_BACKDROP =
  "fixed inset-0 z-[300] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4";

/** Modal panel: opaque surface card with border and shadow. */
export const MODAL_PANEL =
  "w-full bg-bg-surface border border-border rounded-xl shadow-2xl";

/**
 * Whether an outer modal should close on Escape when a nested picker is open.
 * When the picker owns Escape, the outer modal must defer.
 */
export function shouldCloseOuterModalOnEscape(
  nestedPickerOpen: boolean,
): boolean {
  return !nestedPickerOpen;
}

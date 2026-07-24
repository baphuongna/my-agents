/**
 * ModelReloadConfirm — confirm + full-page reload after a model change.
 *
 * Changing the main model persists to config, but the running chat keeps its
 * model until its session is rebuilt. A full reload (fresh session that boots
 * from the just-saved config) is the reliable way to apply it. We confirm
 * first because the reload starts a fresh chat (the current one stays
 * resumable in Sessions and the agent's memory is kept).
 *
 * `model` is the short model name awaiting confirmation, or null when the
 * dialog is closed.
 *
 * Port of Hermes ModelReloadConfirm.
 */
import { type ReactNode } from "react";
import { ConfirmDialog } from "./ConfirmDialog";

export interface ModelReloadConfirmProps {
  model: string | null;
  /** Override the default body copy. */
  description?: ReactNode;
  onCancel: () => void;
}

export function ModelReloadConfirm({
  model,
  description,
  onCancel,
}: ModelReloadConfirmProps) {
  return (
    <ConfirmDialog
      open={model !== null}
      title="Switch model?"
      description={
        description ??
        `Switching to ${model ?? ""} starts a fresh chat. Your current chat stays in your Sessions list and the agent's memory is kept. Reload now to apply it?`
      }
      confirmLabel="Reload"
      onConfirm={() => window.location.reload()}
      onCancel={onCancel}
    />
  );
}

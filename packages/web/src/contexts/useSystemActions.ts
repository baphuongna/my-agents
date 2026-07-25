/**
 * useSystemActions — consumer hook for the SystemActions context.
 *
 * Throws if used outside a SystemActionsProvider (fail-fast guard, matching
 * mya's useToast / usePolling conventions).
 */
import { useContext } from "react";
import { SystemActionsContext, type SystemActionsState } from "./system-actions-context";

export function useSystemActions(): SystemActionsState {
  const ctx = useContext(SystemActionsContext);
  if (!ctx) {
    throw new Error("useSystemActions must be used within a SystemActionsProvider");
  }
  return ctx;
}

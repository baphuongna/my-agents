/**
 * SystemActions context — Action Polling with Trigger-Counter (Hermes M7).
 *
 * Port of Hermes `web/src/contexts/SystemActions.tsx`, split into the canonical
 * 3-file context shape (context / provider / consumer hook). The provider
 * drives spawn-based admin actions (gateway restart, doctor, backup, audit)
 * with recursive-setTimeout status polling and a `cancelled` guard.
 */
import { createContext } from "react";
import type { ActionStatusResponse } from "@/lib/api";

/** The set of pollable admin actions exposed through this context. */
export type SystemAction = "restart" | "update" | "backup" | "audit";

export interface SystemActionsState {
  /** Action currently being dispatched (awaiting the spawn ack). */
  pendingAction: SystemAction | null;
  /** Action whose status is being polled. */
  activeAction: SystemAction | null;
  /** Latest polled status for `activeAction`. */
  actionStatus: ActionStatusResponse | null;
  /** True while dispatching OR while the active action is still running. */
  isBusy: boolean;
  /** True only while the active action is genuinely running. */
  isRunning: boolean;
  /** Kick off an action: dispatches it, then begins polling its status. */
  runAction: (action: SystemAction) => Promise<void>;
  /** Clear the active action + status (dismiss the log viewer). */
  dismissLog: () => void;
}

export const SystemActionsContext = createContext<SystemActionsState | null>(
  null,
);

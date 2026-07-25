/**
 * SystemActionsProvider — drives spawn-based admin actions with recursive
 * polling (Hermes M7 / SystemActions.tsx).
 *
 * Polling engine: `usePolling` (recursive setTimeout — never overlaps, unlike
 * setInterval). The hook owns the timer + internal cancellation, but we keep
 * an explicit `cancelledRef` as belt-and-suspenders (Hermes's original guard)
 * so a slow in-flight fetch can't mutate state after unmount.
 *
 * Trigger-counter: each `runAction` bumps `trigger`. This marks a fresh poll
 * cycle (clears stale status) and, because `poll` closes over `trigger`, the
 * next tick reads the latest action — even when the same action is re-fired.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { usePolling } from "@/hooks/usePolling";
import {
  SystemActionsContext,
  type SystemAction,
  type SystemActionsState,
} from "./system-actions-context";

/** Polling cadence — Hermes uses 1500ms; mya runs slightly faster. */
const POLL_INTERVAL_MS = 1200;

/** Maps a SystemAction to its backend action name (for getActionStatus). */
const ACTION_NAMES: Record<SystemAction, string> = {
  restart: "gateway-restart",
  update: "doctor",
  backup: "backup",
  audit: "security-audit",
};

/** Human label used in toast messages. */
const ACTION_LABELS: Record<SystemAction, string> = {
  restart: "Gateway restart",
  update: "Doctor",
  backup: "Backup",
  audit: "Security audit",
};

/** Dispatch the spawn endpoint for a given action. */
async function dispatchAction(action: SystemAction): Promise<void> {
  switch (action) {
    case "restart":
      await api.restartGateway();
      return;
    case "update":
      await api.runDoctor();
      return;
    case "backup":
      await api.runBackup();
      return;
    case "audit":
      await api.runSecurityAudit();
      return;
  }
}

export function SystemActionsProvider({ children }: { children: ReactNode }) {
  const [pendingAction, setPendingAction] = useState<SystemAction | null>(null);
  const [activeAction, setActiveAction] = useState<SystemAction | null>(null);
  const [actionStatus, setActionStatus] = useState<
    SystemActionsState["actionStatus"]
  >(null);
  /** Whether the recursive poll loop is currently scheduled. */
  const [polling, setPolling] = useState(false);
  /** Trigger-counter: bumps on each runAction to mark a fresh poll cycle. */
  const [trigger, setTrigger] = useState(0);

  const { toast } = useToast();

  // Belt-and-suspenders cancelled flag. usePolling already guards its own
  // effect cleanup, but we mirror Hermes's explicit guard so a slow in-flight
  // fetch cannot touch state after unmount.
  const cancelledRef = useRef(false);
  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  // Recursive-setTimeout poll callback. `activeAction` + `trigger` are closed
  // over so each tick reads the freshest action, even on re-fire.
  const poll = useCallback(async () => {
    const action = activeAction;
    if (!action) return;
    const name = ACTION_NAMES[action];
    try {
      const resp = await api.getActionStatus(name);
      if (cancelledRef.current) return;
      setActionStatus(resp);
      if (!resp.running) {
        // Stop the loop — the action has exited.
        setPolling(false);
        const ok = resp.exit_code === 0;
        toast(
          ok
            ? `${ACTION_LABELS[action]} finished`
            : `${ACTION_LABELS[action]} failed (exit ${resp.exit_code ?? "?"})`,
          ok ? "success" : "error",
        );
      }
    } catch {
      // Transient fetch error — keep polling (usePolling swallows + reschedules).
    }
  }, [activeAction, trigger, toast]);

  // Drive the recursive setTimeout. Active only while an action is in flight.
  usePolling(poll, POLL_INTERVAL_MS, { enabled: polling });

  const runAction = useCallback(
    async (action: SystemAction) => {
      setPendingAction(action);
      setActionStatus(null);
      setTrigger((n) => n + 1);
      try {
        await dispatchAction(action);
        // Begin polling the spawned action's status.
        setActiveAction(action);
        setPolling(true);
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        toast(`${ACTION_LABELS[action]} failed: ${detail}`, "error");
      } finally {
        setPendingAction(null);
      }
    },
    [toast],
  );

  const dismissLog = useCallback(() => {
    setPolling(false);
    setActiveAction(null);
    setActionStatus(null);
  }, []);

  const isRunning =
    activeAction !== null && actionStatus?.running !== false;
  const isBusy = pendingAction !== null || isRunning;

  const value = useMemo<SystemActionsState>(
    () => ({
      pendingAction,
      activeAction,
      actionStatus,
      isBusy,
      isRunning,
      runAction,
      dismissLog,
    }),
    [pendingAction, activeAction, actionStatus, isBusy, isRunning, runAction, dismissLog],
  );

  return (
    <SystemActionsContext.Provider value={value}>
      {children}
    </SystemActionsContext.Provider>
  );
}

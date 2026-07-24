/**
 * ChatSessionList — session switcher panel.
 *
 * Lists recent sessions (title, relative time, message count), lets the user
 * switch between them via `onPick`, and start a fresh chat via `onNewChat`.
 *
 * A monotonic request token guards against stale fetches: if a newer load is
 * in flight (e.g. a Refresh spam), the older response is discarded so the list
 * never lands out of order.
 *
 * Port of Hermes ChatSessionList, adapted to mya's `api.sessions()` surface
 * and decoupled from the router (navigation is delegated to callbacks).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, MessageSquare, Plus, RefreshCw } from "lucide-react";
import { api, type SessionInfo } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface ChatSessionListProps {
  /** Session currently shown (highlighted). */
  activeSessionId?: string | null;
  /** Fired when a row is picked. */
  onPick?: (id: string) => void;
  /** Fired when "New chat" is clicked. */
  onNewChat?: () => void;
  className?: string;
}

function rowLabel(s: SessionInfo): string {
  const title = s.title?.trim();
  if (title) return title;
  return "Untitled";
}

export function ChatSessionList({
  activeSessionId = null,
  onPick,
  onNewChat,
  className,
}: ChatSessionListProps) {
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Monotonic request token: only the most recent fetch may commit state.
  const reqRef = useRef(0);

  const load = useCallback(() => {
    const myReq = ++reqRef.current;
    setLoading(true);
    setError(null);
    api
      .sessions()
      .then((res) => {
        if (reqRef.current !== myReq) return; // stale — discard
        setSessions(res);
      })
      .catch((e: unknown) => {
        if (reqRef.current !== myReq) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (reqRef.current === myReq) setLoading(false);
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <aside
      className={cn(
        "flex h-full w-full min-w-0 shrink-0 flex-col overflow-hidden",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2 px-2 pb-2">
        <span className="text-xs tracking-wider text-fg-subtle">Sessions</span>
        <button
          className="btn-ghost p-1.5"
          onClick={load}
          aria-label="Refresh"
          title="Refresh"
        >
          <RefreshCw size={14} className={cn(loading && "animate-spin")} />
        </button>
      </div>

      <button
        className="btn-secondary mx-2 mb-2 justify-center gap-1.5"
        onClick={() => onNewChat?.()}
      >
        <Plus size={14} /> New chat
      </button>

      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-1">
        {loading && sessions === null && (
          <div className="px-2 py-6 text-center text-xs text-fg-muted">Loading…</div>
        )}

        {error && (
          <div className="flex flex-col items-start gap-2 px-2 py-4 text-xs">
            <div className="flex items-start gap-2 text-danger">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
            <button className="btn-secondary" onClick={load}>
              Retry
            </button>
          </div>
        )}

        {!error && !loading && sessions !== null && sessions.length === 0 && (
          <div className="px-2 py-6 text-center text-xs text-fg-muted">No sessions yet</div>
        )}

        {sessions && sessions.length > 0 && (
          <div className="flex flex-col gap-0.5">
            {sessions.map((s) => {
              const isActive = s.id === activeSessionId;
              return (
                <button
                  key={s.id}
                  onClick={() => onPick?.(s.id)}
                  aria-current={isActive ? "true" : undefined}
                  data-session-id={s.id}
                  className={cn(
                    "flex flex-col items-start gap-0.5 rounded px-2 py-1.5 text-left transition-colors",
                    isActive
                      ? "bg-accent/10 text-fg border-l-2 border-accent"
                      : "text-fg-muted hover:bg-bg-elevated/50 hover:text-fg",
                  )}
                >
                  <span className="flex w-full items-center gap-1.5 truncate text-sm font-medium">
                    <MessageSquare size={12} className="shrink-0 opacity-60" />
                    <span className="truncate">{rowLabel(s)}</span>
                  </span>
                  <span className="flex w-full items-center gap-1.5 text-[11px] text-fg-subtle">
                    <span>{timeAgo(s.updatedAt ?? s.createdAt)}</span>
                    {s.messageCount != null && s.messageCount > 0 && (
                      <>
                        <span aria-hidden>·</span>
                        <span>{s.messageCount} msgs</span>
                      </>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}

/**
 * SessionsPage — list + detail panel with message transcript.
 * Port of Hermes SessionsPage pattern: source icons, message counts,
 * detail view, bulk selection (shift-click range select), bulk delete,
 * and silent refresh when a new session appears from another process.
 */
import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { api, type SessionInfo } from "@/lib/api";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  PageHeader,
  LoadingSpinner,
  ErrorBox,
  EmptyState,
  RefreshButton,
} from "@/components/PageBits";
import {
  MessageSquare,
  Plus,
  Search,
  Terminal,
  Clock,
  Cpu,
  Trash2,
  ChevronRight,
  MessageCircle,
  Phone,
  type LucideIcon,
} from "lucide-react";
import { timeAgo, truncate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "@/lib/modal";
import { useToast } from "@/lib/toast";
import { usePolling } from "@/hooks/usePolling";
import { useConfirmDelete } from "@/hooks/useConfirmDelete";
import { useDebouncedValue } from "@/hooks/useDebounce";
import { shouldRefreshSessions } from "@/lib/session-refresh";
import { PluginSlot } from "@/components/PluginSlot";

// ── Source icon mapping ──────────────────────────────────────────────
// Each session origin channel renders with a distinct icon + colour so
// the list reads at a glance. Unknown sources fall back to the default
// (Terminal / accent), matching Hermes's SOURCE_CONFIG pattern.
const SOURCE_CONFIG: Record<string, { icon: LucideIcon; color: string }> = {
  cli: { icon: Terminal, color: "text-blue-400" },
  telegram: { icon: MessageCircle, color: "text-cyan-400" },
  discord: { icon: MessageSquare, color: "text-indigo-400" },
  whatsapp: { icon: Phone, color: "text-green-400" },
  cron: { icon: Clock, color: "text-amber-400" },
};

const DEFAULT_SOURCE_CONFIG: { icon: LucideIcon; color: string } = {
  icon: Terminal,
  color: "text-accent",
};

/** Resolve the icon/colour for a session source, with a safe fallback. */
function sourceConfig(source?: string): { icon: LucideIcon; color: string } {
  if (source && SOURCE_CONFIG[source]) return SOURCE_CONFIG[source]!;
  return DEFAULT_SOURCE_CONFIG;
}

export function SessionsPage() {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<SessionInfo | null>(null);

  // Bulk selection state (shift-click range select).
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const lastClickedIndexRef = useRef<number | null>(null);

  // Bulk delete confirmation (centralized hook — target is the selected-id set).
  const bulkDel = useConfirmDelete<Set<string>>({
    onDelete: async (target) => {
      const ids = Array.from(target);
      const deleted = new Set<string>();
      try {
        for (const id of ids) {
          await api.deleteSession(id);
          deleted.add(id);
        }
        setSessions((prev) => prev.filter((s) => !deleted.has(s.id)));
        if (selected && deleted.has(selected.id)) setSelected(null);
        clearSelection();
        toast(`Deleted ${ids.length} session${ids.length === 1 ? "" : "s"}`, "success");
      } catch (e) {
        if (deleted.size > 0) {
          setSessions((prev) => prev.filter((s) => !deleted.has(s.id)));
          if (selected && deleted.has(selected.id)) setSelected(null);
          setSelectedIds((prev) => {
            const next = new Set(prev);
            for (const d of deleted) next.delete(d);
            return next;
          });
        }
        toast(`Failed: ${e instanceof Error ? e.message : e}`, "error");
        throw e; // keep dialog open for retry
      }
    },
  });

  const { toast } = useToast();

  // Ref tracking the newest session id seen so far. The overview poll
  // compares against this to detect sessions created in another process
  // (e.g. a CLI) and trigger a silent refresh. Starts null so the very
  // first contact only establishes a baseline — no spurious reload.
  const newestSeenRef = useRef<string | null>(null);

  async function loadSessions(silent = false) {
    if (!silent) setLoading(true);
    try {
      const data = await api.sessions();
      setSessions(data);
      newestSeenRef.current = data[0]?.id ?? null;
      setError(null);
    } catch (e) {
      if (!silent) {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }

  // Initial load on mount.
  useEffect(() => {
    void loadSessions(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Overview poll every 5s. When the head of the newest-sessions list
  // changes (a session was created elsewhere), silently refresh the list
  // — no loading spinner, no scroll reset. Recursive setTimeout via
  // usePolling guarantees ticks never overlap.
  usePolling(
    async () => {
      try {
        const data = await api.sessions();
        const newest = data[0]?.id ?? null;
        if (shouldRefreshSessions(newestSeenRef.current, newest)) {
          setSessions(data);
          newestSeenRef.current = newest;
        }
      } catch {
        // Swallow — transient errors must not break the polling loop.
      }
    },
    5000,
    { immediate: false },
  );

  /** Clear the bulk selection + reset the shift-click anchor. */
  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    lastClickedIndexRef.current = null;
  }, []);

  // Debounce the search term so the (JSON.stringify-based) filter only
  // recomputes once typing settles — port of Hermes's 300ms debounced
  // search pattern (SessionsPage.tsx:851-872).
  const debouncedSearch = useDebouncedValue(search, 300);
  const filtered = debouncedSearch
    ? sessions.filter((s) =>
        JSON.stringify(s).toLowerCase().includes(debouncedSearch.toLowerCase()),
      )
    : sessions;

  /** Search input change also clears bulk selection — carrying a
   *  selection across a search would arm rows the user can no longer
   *  see for deletion. */
  const updateSearch = useCallback(
    (value: string) => {
      setSearch(value);
      clearSelection();
    },
    [clearSelection],
  );

  async function delSession(id: string) {
    try {
      await api.deleteSession(id);
      setSessions((prev) => prev.filter((s) => s.id !== id));
      if (selected?.id === id) setSelected(null);
      // Drop the deleted id from any active bulk set.
      setSelectedIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      toast("Session deleted", "success");
    } catch (e) {
      toast(`Failed: ${e instanceof Error ? e.message : e}`, "error");
    }
  }

  /** Toggle one row's selection. With shift+click (and a previous
   *  anchor), select every row between the anchor and the current index
   *  inclusive — Gmail/file-explorer semantics. */
  const handleSelectClick = useCallback(
    (event: MouseEvent, index: number, visibleList: SessionInfo[]) => {
      const id = visibleList[index]?.id;
      if (!id) return;
      // Capture modifier + anchor as primitives BEFORE the state updater:
      // the updater may run in a deferred render pass where the pooled /
      // recycled synthetic event no longer carries reliable values.
      const shiftKey = event.shiftKey;
      const anchor = lastClickedIndexRef.current;
      setSelectedIds((prev) => {
        const next = new Set(prev);
        const wasSelected = next.has(id);
        const willSelect = !wasSelected;
        if (
          shiftKey &&
          anchor !== null &&
          anchor < visibleList.length
        ) {
          const [lo, hi] =
            anchor <= index ? [anchor, index] : [index, anchor];
          for (let i = lo; i <= hi; i++) {
            const rowId = visibleList[i]?.id;
            if (!rowId) continue;
            if (willSelect) next.add(rowId);
            else next.delete(rowId);
          }
        } else if (willSelect) {
          next.add(id);
        } else {
          next.delete(id);
        }
        return next;
      });
      lastClickedIndexRef.current = index;
    },
    [],
  );

  /** Bulk delete every selected session. Deletion runs sequentially so a
   *  partial failure leaves a consistent list (deleted ids are removed
   *  only on success). */
  return (
    <div className="flex h-full">
      {/* Session list */}
      <div
        className={cn(
          "flex-1 min-w-0 p-4 space-y-3 overflow-y-auto",
          selected && "hidden md:flex-none md:w-80 md:shrink-0",
        )}
      >
        {/* Plugin injection seam — top of sessions. */}
        <PluginSlot name="sessions:top" />

        <PageHeader
          title="Sessions"
          icon={MessageSquare}
          actions={
            <>
              {selectedIds.size > 0 && (
                <Button
                  size="sm"
                  variant="danger"
                  disabled={bulkDel.isDeleting}
                  onClick={() => bulkDel.requestDelete(selectedIds)}
                >
                  <Trash2 size={13} />{" "}
                  {bulkDel.isDeleting
                    ? "Deleting…"
                    : `Delete selected (${selectedIds.size})`}
                </Button>
              )}
              <div className="relative">
                <Search
                  size={13}
                  className="absolute left-2 top-1/2 -translate-y-1/2 text-fg-subtle"
                />
                <input
                  className="input pl-7 text-xs w-36"
                  placeholder="Search…"
                  value={search}
                  onChange={(e) => updateSearch(e.target.value)}
                />
              </div>
              <RefreshButton onClick={() => loadSessions(false)} />
              <Button size="sm" variant="primary">
                <Plus size={13} /> New
              </Button>
            </>
          }
        />

        {loading && sessions.length === 0 && (
          <LoadingSpinner label="Loading sessions…" />
        )}
        {error && <ErrorBox message={error} />}
        {!loading && !error && filtered.length === 0 && (
          <EmptyState
            icon={MessageSquare}
            title="No sessions yet"
            description="Start one with: mya 'your prompt'"
          />
        )}

        <div className="space-y-1.5">
          {filtered.map((s, i) => (
            <SessionRow
              key={s.id}
              style={{ animationDelay: `${Math.min(i * 40, 320)}ms` }}
              className="animate-fade-in-up"
              session={s}
              selected={selected?.id === s.id}
              checked={selectedIds.has(s.id)}
              onClick={() => setSelected(s)}
              onSelect={(e) => handleSelectClick(e, i, filtered)}
            />
          ))}
        </div>

        {/* Plugin injection seam — bottom of sessions. */}
        <PluginSlot name="sessions:bottom" />
      </div>

      {/* Detail panel */}
      {selected && (
        <div className="flex-1 border-l border-border overflow-y-auto">
          <SessionDetail
            session={selected}
            onBack={() => setSelected(null)}
            onDelete={() => delSession(selected.id)}
          />
        </div>
      )}

      {/* Bulk delete confirmation */}
      <ConfirmDialog
        open={bulkDel.isOpen}
        onClose={() => bulkDel.cancelDelete()}
        onConfirm={() => void bulkDel.confirmDelete()}
        title={`Delete ${bulkDel.deleteTarget?.size ?? 0} session${
          (bulkDel.deleteTarget?.size ?? 0) === 1 ? "" : "s"
        }?`}
        description="This action cannot be undone."
        confirmLabel="Delete"
        destructive
      />
    </div>
  );
}

function SessionRow({
  session,
  selected,
  checked,
  onClick,
  onSelect,
  style,
  className,
}: {
  session: SessionInfo;
  selected: boolean;
  checked: boolean;
  onClick: () => void;
  onSelect: (e: MouseEvent) => void;
  style?: React.CSSProperties;
  className?: string;
}) {
  const cfg = sourceConfig(session.source);
  const Icon = cfg.icon;
  // For tests/UI: the test id reflects the *resolved* source, so unknown
  // or missing sources all surface as the default. The icon itself comes
  // from sourceConfig (which already returns the fallback).
  const isKnown =
    session.source != null && session.source in SOURCE_CONFIG;
  const sourceKey = isKnown ? session.source! : "default";
  return (
    <div
      style={style}
      className={cn(
        "card hover:border-accent transition-colors flex items-center gap-1.5",
        selected && "border-accent bg-accent/5",
        checked && "ring-1 ring-accent",
        className,
      )}
    >
      <input
        type="checkbox"
        className="shrink-0 ml-2 accent-accent"
        checked={checked}
        // Controlled via the click handler below so shift-click can drive
        // range selection. The no-op onChange silences the controlled-
        // input warning.
        onChange={() => {}}
        onClick={onSelect}
        aria-label={`Select session ${session.id}`}
        data-testid={`session-checkbox-${session.id}`}
      />
      <button
        onClick={onClick}
        className="flex-1 min-w-0 text-left py-2 pr-2"
        data-testid={`session-row-${session.id}`}
      >
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-0.5">
              <Icon
                size={12}
                className={cn("shrink-0", cfg.color)}
                data-testid={`source-icon-${sourceKey}`}
                aria-hidden
              />
              <span className="text-fg font-medium text-[13px] truncate">
                {session.title || truncate(session.id, 30)}
              </span>
            </div>
            <div className="flex items-center gap-2 text-[10px] text-fg-muted">
              {session.model && (
                <span className="flex items-center gap-0.5">
                  <Cpu size={9} /> {session.model}
                </span>
              )}
              {session.messageCount != null && (
                <Badge color="gray">{session.messageCount} msgs</Badge>
              )}
              <span className="flex items-center gap-0.5">
                <Clock size={9} /> {timeAgo(session.updatedAt)}
              </span>
            </div>
          </div>
          <ChevronRight size={14} className="text-fg-subtle shrink-0" />
        </div>
      </button>
    </div>
  );
}

function SessionDetail({
  session,
  onBack,
  onDelete,
}: {
  session: SessionInfo;
  onBack: () => void;
  onDelete: () => void;
}) {
  const del = useConfirmDelete<SessionInfo>({
    onDelete: async () => { onDelete(); },
  });
  const [messages, setMessages] = useState<unknown[]>([]);
  const [loadingMsgs, setLoadingMsgs] = useState(false);

  useEffect(() => {
    setLoadingMsgs(true);
    fetch(`/sessions/${session.id}`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        setMessages(d.messages ?? d.history ?? []);
      })
      .catch(() => setMessages([]))
      .finally(() => setLoadingMsgs(false));
  }, [session.id]);

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-2">
        <button className="btn-ghost md:hidden" onClick={onBack}>
          ← Back
        </button>
        <h2 className="text-base font-semibold text-fg flex-1 truncate">
          {session.title || session.id}
        </h2>
        <button className="btn-danger" onClick={() => del.requestDelete(session)}>
          <Trash2 size={13} /> Delete
        </button>
      </div>

      {/* Metadata */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <DetailField label="Session ID" value={session.id} mono />
        <DetailField label="Model" value={session.model || "—"} />
        <DetailField label="Provider" value={session.provider || "—"} />
        <DetailField label="Messages" value={String(session.messageCount ?? 0)} />
        <DetailField label="Created" value={timeAgo(session.createdAt)} />
        <DetailField label="Updated" value={timeAgo(session.updatedAt)} />
      </div>

      {session.cwd && <DetailField label="Working Dir" value={session.cwd} mono />}

      {/* Transcript */}
      <div>
        <h3 className="text-xs uppercase tracking-wide text-fg-muted mb-2">
          Transcript
        </h3>
        {loadingMsgs ? (
          <LoadingSpinner label="Loading messages…" />
        ) : messages.length === 0 ? (
          <p className="text-fg-subtle text-xs text-center py-4">
            No messages available
          </p>
        ) : (
          <div className="space-y-2">
            {messages.map((msg, i) => (
              <MessageBubble key={i} msg={msg} />
            ))}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={del.isOpen}
        onClose={() => del.cancelDelete()}
        onConfirm={() => void del.confirmDelete()}
        title="Delete session?"
        description="This action cannot be undone."
        confirmLabel="Delete"
        destructive
      />
    </div>
  );
}

function MessageBubble({ msg }: { msg: unknown }) {
  const m = msg as { role?: string; content?: string; text?: string };
  const role = m.role ?? "unknown";
  const content = m.content ?? m.text ?? "";
  const isUser = role === "user";
  const isAssistant = role === "assistant";

  return (
    <div
      className={cn(
        "rounded-lg p-2.5 text-[13px]",
        isUser && "bg-accent/10 border-l-2 border-accent",
        isAssistant && "bg-bg-surface border border-border",
        !isUser && !isAssistant && "bg-bg-input text-fg-muted",
      )}
    >
      <div className="text-[10px] uppercase tracking-wide text-fg-subtle mb-1">
        {role}
      </div>
      <div className="text-fg whitespace-pre-wrap break-words">{content}</div>
    </div>
  );
}

function DetailField({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="card py-2 px-3">
      <div className="text-[10px] uppercase tracking-wide text-fg-subtle">
        {label}
      </div>
      <div className={cn("text-xs text-fg mt-0.5 truncate", mono && "font-mono")}>
        {value}
      </div>
    </div>
  );
}

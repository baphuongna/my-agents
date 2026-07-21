/**
 * SessionsPage — list + detail panel with message transcript.
 * Port of Hermes SessionsPage pattern: source icons, message counts, detail view.
 */
import { useEffect, useState } from "react";
import { api, type SessionInfo } from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { PageHeader, LoadingSpinner, ErrorBox, EmptyState, RefreshButton } from "@/components/PageBits";
import { MessageSquare, Plus, Search, Terminal, Clock, Cpu, Trash2, ChevronRight } from "lucide-react";
import { timeAgo, truncate, formatTokenCount } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "@/lib/modal";
import { useToast } from "@/lib/toast";

export function SessionsPage() {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<SessionInfo | null>(null);
  const { toast } = useToast();

  async function reload() {
    setLoading(true);
    try {
      const data = await api.sessions();
      setSessions(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
    const timer = setInterval(reload, 10000);
    return () => clearInterval(timer);
  }, []);

  const filtered = search
    ? sessions.filter((s) =>
        JSON.stringify(s).toLowerCase().includes(search.toLowerCase()),
      )
    : sessions;

  async function delSession(id: string) {
    try {
      await fetch(`/sessions/${id}`, { method: "DELETE", credentials: "include" });
      setSessions((prev) => prev.filter((s) => s.id !== id));
      if (selected?.id === id) setSelected(null);
      toast("Session deleted", "success");
    } catch (e) {
      toast(`Failed: ${e instanceof Error ? e.message : e}`, "error");
    }
  }

  return (
    <div className="flex h-full">
      {/* Session list */}
      <div className={cn("flex-1 min-w-0 p-4 space-y-3 overflow-y-auto", selected && "hidden md:flex-none md:w-80 md:shrink-0")}>
        <PageHeader
          title="Sessions"
          icon={MessageSquare}
          actions={
            <>
              <div className="relative">
                <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-fg-subtle" />
                <input
                  className="input pl-7 text-xs w-36"
                  placeholder="Search…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <RefreshButton onClick={reload} />
              <Button size="sm" variant="primary">
                <Plus size={13} /> New
              </Button>
            </>
          }
        />

        {loading && sessions.length === 0 && <LoadingSpinner label="Loading sessions…" />}
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
              key={s.id} style={{ animationDelay: `${Math.min(i * 40, 320)}ms` }} className="animate-fade-in-up"
              session={s}
              selected={selected?.id === s.id}
              onClick={() => setSelected(s)}
            />
          ))}
        </div>
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
    </div>
  );
}

function SessionRow({
  session,
  selected,
  onClick,
}: {
  session: SessionInfo;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left card hover:border-accent transition-colors",
        selected && "border-accent bg-accent/5",
      )}
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <Terminal size={12} className="text-accent shrink-0" />
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
  const [confirmDel, setConfirmDel] = useState(false);
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
        <button className="btn-danger" onClick={() => setConfirmDel(true)}>
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
        <h3 className="text-xs uppercase tracking-wide text-fg-muted mb-2">Transcript</h3>
        {loadingMsgs ? (
          <LoadingSpinner label="Loading messages…" />
        ) : messages.length === 0 ? (
          <p className="text-fg-subtle text-xs text-center py-4">No messages available</p>
        ) : (
          <div className="space-y-2">
            {messages.map((msg, i) => (
              <MessageBubble key={i} msg={msg} />
            ))}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmDel}
        onClose={() => setConfirmDel(false)}
        onConfirm={onDelete}
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
      <div className="text-[10px] uppercase tracking-wide text-fg-subtle mb-1">{role}</div>
      <div className="text-fg whitespace-pre-wrap break-words">{content}</div>
    </div>
  );
}

function DetailField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="card py-2 px-3">
      <div className="text-[10px] uppercase tracking-wide text-fg-subtle">{label}</div>
      <div className={cn("text-xs text-fg mt-0.5 truncate", mono && "font-mono")}>{value}</div>
    </div>
  );
}

import { useAsync } from "@/hooks/useAsync";
import { api, type SessionInfo } from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { MessageSquare, Plus, RefreshCw } from "lucide-react";
import { timeAgo, truncate } from "@/lib/utils";

export function SessionsPage() {
  const { data: sessions, loading, error, reload } = useAsync(
    () => api.sessions(),
    [],
    5000,
  );

  return (
    <div className="p-4 space-y-4">
      <PageHeader
        title="Sessions"
        icon={MessageSquare}
        actions={
          <>
            <Button size="sm" variant="ghost" onClick={reload}>
              <RefreshCw size={13} /> Refresh
            </Button>
            <Button size="sm" variant="primary">
              <Plus size={13} /> New
            </Button>
          </>
        }
      />

      {loading && !sessions && <LoadingSpinner />}
      {error && <ErrorBox message={error} />}

      {sessions && sessions.length === 0 && (
        <Card>
          <p className="text-fg-muted text-sm text-center py-8">
            No sessions yet. Start one with <code className="text-accent">mya "your prompt"</code>
          </p>
        </Card>
      )}

      {sessions && sessions.length > 0 && (
        <div className="grid gap-2">
          {sessions.map((s) => (
            <SessionRow key={s.id} session={s} />
          ))}
        </div>
      )}
    </div>
  );
}

function SessionRow({ session }: { session: SessionInfo }) {
  return (
    <Card className="hover:border-accent transition-colors cursor-pointer">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-fg font-medium text-sm truncate">
              {session.title || session.id}
            </span>
            {session.model && <Badge color="blue">{session.model}</Badge>}
          </div>
          <div className="flex items-center gap-3 text-[11px] text-fg-muted">
            <span className="font-mono">{session.id.slice(0, 12)}</span>
            {session.messageCount != null && <span>{session.messageCount} msgs</span>}
            {session.provider && <span>{session.provider}</span>}
            <span>updated {timeAgo(session.updatedAt)}</span>
          </div>
          {session.cwd && (
            <div className="text-[11px] text-fg-subtle font-mono mt-1 truncate">
              {session.cwd}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

// ── Shared components ──────────────────────────────────────────────────

export function PageHeader({
  title,
  icon: Icon,
  actions,
}: {
  title: string;
  icon: typeof MessageSquare;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon size={18} className="text-accent" />
      <h1 className="text-lg font-semibold text-fg">{title}</h1>
      <div className="flex-1" />
      {actions}
    </div>
  );
}

export function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center py-12">
      <RefreshCw size={20} className="text-fg-muted animate-spin" />
    </div>
  );
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <Card className="border-danger">
      <div className="text-danger text-sm">
        <strong>Error:</strong> {message}
      </div>
    </Card>
  );
}
